'use strict';

/**
 * 主动消息：对方沉默一段时间后，由 LLM 基于人设 + 记忆现场生成一条消息，
 * 通过微信桥接的本地回环 HTTP 接口发出去（仅微信端）。
 *
 * 阈值按「目标对象」分开：proactive.targets 里每个对象一套；
 * 没列出的对象走 proactive.defaults（默认不启用）。
 * 面板设置（data/settings.json 的 proactive 字段）覆盖 config.json。
 *
 * 退避（snooze）：对方说「别烦我 / 在忙 / 晚安」这类话时，bot.js 调
 * observeIncoming() 按关键词规则更新该会话 state.proactive.snoozeUntil，
 * 退避期内不给这个会话发主动消息。规则匹配，不调 LLM，省钱可靠。
 */

const http = require('node:http');
const { URL } = require('node:url');
const { loadSettings, deepMerge } = require('./config');
const { buildSystem } = require('./persona');

// 退避规则：从上到下匹配，先中先用。ms = 退避时长；next8 = 到次日早 8 点；clear = 解除
const SNOOZE_RULES = [
  { re: /(恢复正常|可以说话了|可以找我|理我一下)/, kind: 'clear', label: '解除退避' },
  { re: /(别主动找我|不用主动|别主动发|别主动说话|别自己找我)/, kind: 'ms', ms: 24 * 3600e3, label: '24 小时' },
  { re: /(别烦我|你先别说话|先别说话|别说话了|闭嘴|烦死了|滚开|滚)/, kind: 'ms', ms: 4 * 3600e3, label: '4 小时' },
  { re: /(晚安|去睡了|睡觉了|睡了|睡了晚安)/, kind: 'next8', label: '到明早 8 点' },
  { re: /(一会再说|一会儿再说|等下聊|等会儿聊|在忙|有点忙|晚点说|待会说|待会聊|现在没空)/, kind: 'ms', ms: 30 * 60e3, label: '30 分钟' },
];

function nextMorning8(nowMs) {
  const d = new Date(nowMs);
  d.setHours(8, 0, 0, 0);
  if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** 「23:00」「08:00」形式的 HH:mm 转分钟数；非法返回 null */
function parseHm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function inQuietHours(cfg, nowMs) {
  const start = parseHm(cfg.quietStart);
  const end = parseHm(cfg.quietEnd);
  if (start === null || end === null || start === end) return false;
  const d = new Date(nowMs);
  const t = d.getHours() * 60 + d.getMinutes();
  // 跨零点（如 23:00~08:00）：t >= start 或 t <= end 都算静默
  if (start > end) return t >= start || t <= end;
  return t >= start && t <= end;
}

/** 会话的展示名：群聊用群名；私聊桥接不传标题，从联系人档案里取昵称，再没有才回退 wxid */
function targetDisplayName(sess, botName) {
  if (sess.title) return sess.title;
  for (const p of Object.values(sess.profiles || {})) {
    const n = (p && (p.nickname || p.name)) || '';
    if (n && n !== botName) return n;
  }
  return sess.chatId;
}

class ProactiveManager {
  constructor({ config, store, llm, logger }) {
    this.config = config;
    this.store = store;
    this.llm = llm;
    this.logger = logger;
    this.timer = null;
    this.sending = false; // 串行发送，避免两条主动消息同时抢微信窗口
  }

  /** 面板设置 > config.json，得到最终生效的 proactive 配置 */
  effective() {
    const base = this.config.proactive || {};
    let patch = {};
    try {
      patch = loadSettings(this.config).proactive || {};
    } catch {
      patch = {};
    }
    const merged = deepMerge(base, patch);
    // targets 是数组：deepMerge 会整体替换；settings 里没有就沿用 config.json 的
    if (Array.isArray(patch.targets)) merged.targets = patch.targets;
    return merged;
  }

  start() {
    this.stop();
    const cfg = this.effective();
    if (!cfg.enabled) {
      this.logger && this.logger.info('[proactive] 未启用（proactive.enabled=false）');
      return;
    }
    const sec = Math.max(15, Number(cfg.checkIntervalSec) || 60);
    this.timer = setInterval(() => this.tick().catch((err) => {
      this.logger && this.logger.warn('[proactive] 检查出错：' + err.message);
    }), sec * 1000);
    if (this.timer.unref) this.timer.unref();
    this.logger && this.logger.info(`[proactive] 已启动，每 ${sec}s 检查一次`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 设置面板保存后调用，立即生效 */
  reload() {
    const wasRunning = Boolean(this.timer);
    this.stop();
    if (wasRunning || this.effective().enabled) this.start();
  }

  /**
   * 找「目标对象 → 会话」的配对。返回 [{ sess, eff }] ，eff 是该对象最终生效的阈值。
   */
  resolveTargets(cfg) {
    const master = (this.config.persona && this.config.persona.master) || {};
    const wxids = new Set((master.wxids || []).map((x) => String(x)));
    const names = (master.names || []).map((n) => String(n).toLowerCase()).filter(Boolean);
    const out = [];
    for (const sess of this.store.sessions.values()) {
      if (sess.platform !== 'wechat') continue;
      let hit = null;
      for (const t of cfg.targets || []) {
        if (!t || t.enabled === false) continue;
        if (t.type === 'master') {
          if (sess.chatType !== 'private') continue;
          const idHit = wxids.size > 0 &&
            (wxids.has(sess.chatId) || Object.keys(sess.profiles || {}).some((u) => wxids.has(u)));
          const nameHit = !idHit && names.length > 0 && (() => {
            const title = String(sess.title || '').toLowerCase();
            const profNames = Object.values(sess.profiles || {}).map((p) => String(p.name || '').toLowerCase());
            return names.some((n) => (title && title.includes(n)) || profNames.some((pn) => pn && pn.includes(n)));
          })();
          if (idHit || nameHit) { hit = t; break; }
        } else if (t.type === 'chat' && t.name) {
          const want = String(t.name).trim().toLowerCase();
          const display = String(targetDisplayName(sess, (this.config.persona || {}).name)).toLowerCase();
          if ((display && display === want) || sess.chatId === String(t.name).trim()) { hit = t; break; }
        }
      }
      if (!hit) {
        const d = cfg.defaults || {};
        if (d.enabled) hit = { ...d, type: 'default', name: '' };
        else continue;
      }
      out.push({ sess, eff: { ...(cfg.defaults || {}), ...hit } });
    }
    return out;
  }

  /**
   * 收消息时调用：识别退避关键词，更新该会话的 snoozeUntil。
   * 返回匹配的退避信息（用于调试日志），没匹配返回 null。
   */
  observeIncoming(msg) {
    if (!msg || !msg.text) return null;
    if (msg.platform !== 'wechat') return null;
    // 群里只对「@她 / 引用她」的话生效，免得路人一句「晚安」把群退避了
    if (msg.chatType === 'group' && !msg.atMe && !msg.replyToBot) return null;
    const text = String(msg.text).trim();
    if (text.length > 30) return null; // 长文本不误判
    const rule = SNOOZE_RULES.find((r) => r.re.test(text));
    if (!rule) return null;
    const key = `${msg.platform}:${msg.chatType === 'group' ? 'g' : 'u'}:${msg.chatId}`;
    const state = this.store.getState(key);
    if (!state.proactive) state.proactive = { snoozeUntil: 0, sentTimes: [] };
    const now = Date.now();
    if (rule.kind === 'clear') {
      state.proactive.snoozeUntil = 0;
    } else if (rule.kind === 'next8') {
      state.proactive.snoozeUntil = nextMorning8(now);
    } else {
      state.proactive.snoozeUntil = now + rule.ms;
    }
    this.store.markDirty();
    this.logger && this.logger.info(
      `[proactive] 「${text.slice(0, 12)}」→ 会话 ${key} 退避：${rule.kind === 'clear' ? '解除' : rule.label}`
    );
    return { key, label: rule.label, until: state.proactive.snoozeUntil };
  }

  /** 单个会话是否该发：返回 null = 不发；{ minutes } = 发，对方已沉默 minutes 分钟 */
  shouldSend(sess, eff, cfg, now) {
    if (eff.enabled === false) return null;
    if (inQuietHours(cfg, now)) return null;
    const st = sess.state.proactive || { snoozeUntil: 0, sentTimes: [] };
    if (st.snoozeUntil && now < st.snoozeUntil) return null;
    const silentMs = Math.max(5, Number(eff.silentMinutes) || 60) * 60e3;
    let lastUserTs = 0;
    let lastAssistantTs = 0;
    for (let i = sess.messages.length - 1; i >= 0; i--) {
      const m = sess.messages[i];
      if (!lastUserTs && m.role === 'user') lastUserTs = m.ts;
      if (!lastAssistantTs && m.role === 'assistant' && !m.error) lastAssistantTs = m.ts;
      if (lastUserTs && lastAssistantTs) break;
    }
    if (!lastUserTs) return null; // 从没说过话，不主动
    // 沉默从「对方最后一句 / 她最后一句」两者较晚者算起：她刚回过就不连发
    const base = Math.max(lastUserTs, lastAssistantTs);
    const silentFor = now - base;
    if (silentFor < silentMs) return null;
    // 频率上限：按这个对象已发出的主动消息计数
    const sent = (st.sentTimes || []).filter((t) => now - t < 24 * 3600e3);
    const perHour = Math.max(1, Number(eff.maxPerHour) || 1);
    const perDay = Math.max(1, Number(eff.maxPerDay) || 5);
    if (sent.filter((t) => now - t < 3600e3).length >= perHour) return null;
    if (sent.length >= perDay) return null;
    return { minutes: Math.floor(silentFor / 60e3) };
  }

  /** 调 LLM 现场生成主动消息 */
  async generate(sess, eff, cfg, minutes) {
    const now = new Date();
    const targetName = targetDisplayName(sess, (this.config.persona || {}).name) || '你';
    const isMasterTarget = eff.type === 'master' || eff.type === 'default';
    // 私聊场景：对方就是聊天对象本人；群聊场景：在群里说话
    const msg = {
      platform: 'wechat',
      chatType: sess.chatType,
      chatTitle: sess.title || '',
      senderName: targetName,
      senderId: sess.chatType === 'private' ? sess.chatId : '',
      isMaster: isMasterTarget && sess.chatType === 'private',
      text: '',
    };
    const system = buildSystem({
      config: this.config,
      msg,
      profile: null,
      notes: this.store.listNotes(sess.key),
      now,
    });
    const history = sess.messages.slice(-12).map((m) => ({
      role: m.role,
      content: m.name && sess.chatType === 'group' ? `${m.name}：${m.text}` : m.text,
    }));
    const instruction =
      `[系统提示] ${targetName} 已经 ${minutes} 分钟没理你了。${String(cfg.prompt || '').trim()}\n` +
      `直接输出你要发给${sess.chatType === 'group' ? '群里' : ' TA '}的消息本身：` +
      `1~3 句，像平时说话一样自然；不要加引号、不要解释、不要提「系统提示」、不要复述这条指令。`;
    const text = await this.llm.complete({
      system,
      turns: [...history, { role: 'user', content: instruction }],
      maxTokens: 150,
    });
    return String(text || '').trim().replace(/^["「『]+|["」』]+$/g, '').slice(0, 300);
  }

  /** 经微信桥接的本地回环接口发出去 */
  sendViaBridge(cfg, chat, text) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(String(cfg.bridgeUrl || 'http://127.0.0.1:8788').replace(/\/+$/, '') + '/send');
      } catch {
        return reject(new Error('bridgeUrl 无效：' + cfg.bridgeUrl));
      }
      const body = JSON.stringify({ chat, text });
      const req = http.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: 8000,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`桥接返回 HTTP ${res.statusCode}：${raw.slice(0, 120)}`));
            let j = {};
            try { j = JSON.parse(raw); } catch { /* 空响应也算成功 */ }
            if (j.ok === false) return reject(new Error(j.error || '桥接发送失败'));
            resolve(j);
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('桥接 /send 超时（8s）')));
      req.on('error', reject);
      req.end(body);
    });
  }

  /** 生成并发送一条主动消息；返回 { text } 或抛出错误 */
  async fire(sess, eff, cfg, minutes) {
    const text = await this.generate(sess, eff, cfg, minutes);
    if (!text) throw new Error('LLM 生成了空消息');
    const chatName = targetDisplayName(sess, (this.config.persona || {}).name);
    await this.sendViaBridge(cfg, chatName, text);
    const now = Date.now();
    this.store.appendMessage(sess.key, { role: 'assistant', name: (this.config.persona || {}).name || '大肥鱼', text, ts: now });
    const st = this.store.getState(sess.key);
    if (!st.proactive) st.proactive = { snoozeUntil: 0, sentTimes: [] };
    st.proactive.sentTimes.push(now);
    if (st.proactive.sentTimes.length > 200) st.proactive.sentTimes = st.proactive.sentTimes.slice(-200);
    this.store.markDirty();
    this.logger && this.logger.info(`[proactive] → ${chatName}：${text.slice(0, 50)}`);
    return { text };
  }

  async tick() {
    if (this.sending) return;
    const cfg = this.effective();
    if (!cfg.enabled) return;
    if (this.llm.isMock) return; // 没 Key 的演示模式不浪费桥接
    const now = Date.now();
    for (const { sess, eff } of this.resolveTargets(cfg)) {
      const r = this.shouldSend(sess, eff, cfg, now);
      if (!r) continue;
      this.sending = true;
      try {
        await this.fire(sess, eff, cfg, r.minutes);
      } catch (err) {
        this.logger && this.logger.warn(`[proactive] 发给 ${sess.title || sess.key} 失败：${err.message}`);
      } finally {
        this.sending = false;
      }
      break; // 每轮最多发一条，避免一口气打扰所有人
    }
  }

  /** 状态面板用：顺带告诉用户卡在哪一环（没开总开关/没配对象/名字没匹配上） */
  status() {
    const cfg = this.effective();
    const now = Date.now();
    const targets = this.resolveTargets(cfg).map(({ sess, eff }) => {
      const st = sess.state.proactive || { snoozeUntil: 0, sentTimes: [] };
      let lastUserTs = 0;
      for (let i = sess.messages.length - 1; i >= 0; i--) {
        if (sess.messages[i].role === 'user') { lastUserTs = sess.messages[i].ts; break; }
      }
      const check = this.shouldSend(sess, eff, cfg, now);
      return {
        key: sess.key,
        title: targetDisplayName(sess, (this.config.persona || {}).name),
        chatType: sess.chatType,
        type: eff.type || 'chat',
        enabled: eff.enabled !== false,
        silentMinutes: Number(eff.silentMinutes) || 0,
        maxPerHour: Number(eff.maxPerHour) || 0,
        maxPerDay: Number(eff.maxPerDay) || 0,
        silentForMinutes: lastUserTs ? Math.floor((now - lastUserTs) / 60e3) : null,
        snoozeUntil: st.snoozeUntil || 0,
        sentLastHour: (st.sentTimes || []).filter((t) => now - t < 3600e3).length,
        sentToday: (st.sentTimes || []).filter((t) => now - t < 24 * 3600e3).length,
        ready: Boolean(check),
      };
    });
    // 诊断信息
    const wechatCount = [...this.store.sessions.values()].filter((s) => s.platform === 'wechat' && s.messages.length).length;
    const savedTargets = Array.isArray(cfg.targets) ? cfg.targets : [];
    let reason = '';
    if (!cfg.enabled) reason = '总开关未启用：勾选「启用主动消息」后点保存';
    else if (!savedTargets.length && !(cfg.defaults || {}).enabled) reason = '还没有任何对象：点「+ 添加对象」并保存';
    else if (!targets.length && !wechatCount) reason = '还没有微信会话记录：先用微信聊几句，或确认桥接已连上';
    else if (!targets.length) reason = `有 ${wechatCount} 个微信会话但都没匹配上：对象名要和会话昵称完全一致（改完点保存）`;
    return {
      enabled: Boolean(cfg.enabled),
      running: Boolean(this.timer),
      quietStart: cfg.quietStart,
      quietEnd: cfg.quietEnd,
      inQuietHours: inQuietHours(cfg, now),
      bridgeUrl: cfg.bridgeUrl,
      targets,
      reason,
    };
  }
}

module.exports = { ProactiveManager, SNOOZE_RULES, inQuietHours, nextMorning8 };
