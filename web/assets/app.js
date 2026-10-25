'use strict';

/* =========================================================
   大肥鱼 · 前端逻辑（原生 JS，无依赖）
   ========================================================= */

const $ = (id) => document.getElementById(id);
const chatEl = $('chat');
const inputEl = $('input');
const sendBtn = $('send');
const typingEl = $('typing');

const GROUP_MEMBERS = [
  { name: '阿螈', emoji: '🐟' },
  { name: '海胆酱', emoji: '🦔' },
  { name: '小丑鱼', emoji: '🐠' },
  { name: '你自己', emoji: '🙋' },
];

const state = {
  sessionId: localStorage.getItem('whale.sessionId') || '',
  mode: localStorage.getItem('whale.mode') || 'private',
  userName: localStorage.getItem('whale.userName') || '',
  streaming: false,
  status: null,
  settings: null,
};

if (!state.sessionId) {
  state.sessionId = 'w' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  localStorage.setItem('whale.sessionId', state.sessionId);
}

/* ---------------- 背景气泡 ---------------- */
function makeBubbles() {
  const host = $('bubbles');
  if (!host) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 26; i++) {
    const b = document.createElement('span');
    const size = 4 + Math.random() * 16;
    b.style.width = b.style.height = size + 'px';
    b.style.left = Math.random() * 100 + '%';
    b.style.animationDuration = 12 + Math.random() * 20 + 's';
    b.style.animationDelay = -Math.random() * 26 + 's';
    b.style.setProperty('--drift', Math.round((Math.random() - 0.5) * 90) + 'px');
    b.style.opacity = String(0.2 + Math.random() * 0.5);
    frag.appendChild(b);
  }
  host.appendChild(frag);
}

/* ---------------- 工具 ---------------- */
function nowLabel(d = new Date()) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function scrollToBottom(smooth = true) {
  chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

function escapeTime(ts) {
  const d = new Date(ts || Date.now());
  return isNaN(d.getTime()) ? '' : nowLabel(d);
}

function memberEmoji(name) {
  const m = GROUP_MEMBERS.find((x) => x.name === name);
  return m ? m.emoji : (name || '你').slice(0, 1);
}

/* ---------------- 消息渲染 ---------------- */
function addMessage({ role, name, text, time, error, caret }) {
  if (role === 'system') {
    const line = document.createElement('div');
    line.className = 'system-line';
    line.textContent = text;
    chatEl.appendChild(line);
    scrollToBottom();
    return line;
  }

  const row = document.createElement('div');
  row.className = 'msg ' + (role === 'bot' ? 'bot' : 'user');

  const avatar = document.createElement('div');
  avatar.className = 'mini-avatar';
  if (role === 'bot') {
    const img = document.createElement('img');
    img.src = '/assets/avatar.jpg';
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;border-radius:50%;display:block';
    avatar.appendChild(img);
  } else {
    avatar.textContent = memberEmoji(name);
  }
  avatar.style.display = 'grid';
  avatar.style.placeItems = 'center';
  avatar.style.fontSize = '14px';

  const body = document.createElement('div');
  body.className = 'body';

  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = role === 'bot' ? '大肥鱼' : name || '你';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (error) bubble.style.borderColor = 'rgba(255,120,140,.45)';
  const textNode = document.createElement('span');
  textNode.className = 'bubble-text';
  textNode.textContent = text || '';
  bubble.appendChild(textNode);

  let caretEl = null;
  if (caret) {
    caretEl = document.createElement('span');
    caretEl.className = 'caret';
    bubble.appendChild(caretEl);
  }

  const timeEl = document.createElement('div');
  timeEl.className = 'time';
  timeEl.textContent = time || nowLabel();

  body.appendChild(nameEl);
  body.appendChild(bubble);
  body.appendChild(timeEl);
  row.appendChild(avatar);
  row.appendChild(body);
  chatEl.appendChild(row);
  scrollToBottom();
  return { row, bubble, textNode, caretEl };
}

function setText(node, text) {
  node.textContent = text;
}

/** 把一条长回复拆成几条气泡（更接近真实群聊） */
function expandBubbles(msgEl, bubbles) {
  if (!bubbles || bubbles.length <= 1) return;
  msgEl.row.remove();
  let delay = 0;
  for (const b of bubbles) {
    setTimeout(() => {
      addMessage({ role: 'bot', text: b, time: nowLabel() });
    }, delay);
    delay += 260;
  }
}

function showTyping(show) {
  typingEl.hidden = !show;
  if (show) scrollToBottom();
}

/* ---------------- 状态刷新 ---------------- */
async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.status = data;
    const dot = $('dot');
    dot.className = 'dot';
    if (data.mock) dot.classList.add('mock');
    if (data.mock) {
      $('statusText').textContent = '演示模式 · 内置台词';
    } else {
      $('statusText').textContent = `${data.providerLabel || '模型'} · ${data.model} · 在线`;
    }
    $('hint').textContent = data.mock
      ? data.hasKey
        ? '⚠️ 已保存 API Key，但「演示模式」开着，现在只会说内置台词。去设置里关掉它，就是真模型了。'
        : '演示模式：还没配置模型，用的是内置台词。点右上角「设置」选一个免费模型（智谱 GLM-4-Flash / 本地 Ollama）就能真聊。'
      : `已接入 ${data.providerLabel || '模型'}（${data.model}）。记忆存在本机，共 ${data.memory.sessions} 个聊天。`;
    const gws = data.gateways || [];
    $('gatewayState').textContent = gws
      .map((g) => `${g.platform}：${g.enabled ? (g.outboundConfigured ? '已启用，可发消息' : '已启用，但没配 outboundUrl（只会打印到控制台）') : '未启用'}${g.received ? ` · 收到 ${g.received} 条` : ''}`)
      .join('　｜　');
    updateWebhookCodes();
  } catch (err) {
    $('dot').className = 'dot off';
    $('statusText').textContent = '连不上本地服务…';
  }
}

function updateWebhookCodes() {
  const origin = location.origin;
  $('whWechat').textContent = origin + '/webhook/wechat';
  $('whDouyin').textContent = origin + '/webhook/douyin';
}

/* ---------------- 模式 / 快捷按钮 ---------------- */
const CHIPS = {
  private: [
    { t: '你是谁呀' },
    { t: '讲个冷笑话' },
    { t: '深海小知识' },
    { t: '安慰我一下' },
    { t: '晚安' },
  ],
  group: [
    { t: '在吗', at: true },
    { t: '今天加班好累啊' },
    { t: '哈哈哈哈哈哈' },
    { t: '大肥鱼你说呢' },
    { t: '晚上吃啥' },
  ],
};

function renderChips() {
  const host = $('chips');
  host.textContent = '';
  for (const c of CHIPS[state.mode]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = c.at ? '@大肥鱼 ' + c.t : c.t;
    btn.addEventListener('click', () => {
      if (state.mode === 'group') {
        sendMessage(c.at ? '@大肥鱼 ' + c.t : c.t);
      } else {
        sendMessage(c.t);
      }
    });
    host.appendChild(btn);
  }
}

function applyMode() {
  const isGroup = state.mode === 'group';
  $('groupBar').hidden = !isGroup;
  $('senderSel').hidden = !isGroup;
  $('btnAt').hidden = !isGroup;
  $('btnMode').classList.toggle('active', isGroup);
  $('btnMode').querySelector('em').textContent = isGroup ? '私聊' : '群聊';
  inputEl.placeholder = isGroup
    ? '以群友身份说点什么…（打「大肥鱼」或点 @ 才会被接话）'
    : '跟大肥鱼说点什么…（Enter 发送 / Shift+Enter 换行）';
  renderChips();
}

/* ---------------- 发送 ---------------- */
async function sendMessage(rawText) {
  if (state.streaming) return;
  const text = String(rawText ?? inputEl.value).trim();
  if (!text) return;
  if (rawText === undefined) {
    inputEl.value = '';
    autoGrow();
  }

  const isGroup = state.mode === 'group';
  const senderName = isGroup ? $('senderSel').value : state.userName || '你';
  addMessage({ role: 'user', name: senderName, text });
  showTyping(true);
  state.streaming = true;
  sendBtn.disabled = true;

  let streamMsg = null;
  let full = '';
  let gotAny = false;

  const payload = {
    text,
    mode: state.mode,
    sessionId: state.sessionId,
    senderName,
    msgId: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ct = res.headers.get('content-type') || '';

    if (!ct.includes('text/event-stream')) {
      const data = await res.json().catch(() => ({}));
      showTyping(false);
      if (data.action === 'ignore') {
        addMessage({ role: 'system', text: ignoreReasonText(data.reason) });
      } else if (data.error) {
        addMessage({ role: 'bot', text: data.error, error: true });
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const handleEvent = (evt) => {
      if (evt.type === 'meta') {
        gotAny = true;
        return;
      }
      if (evt.type === 'delta') {
        if (!streamMsg) {
          showTyping(false);
          streamMsg = addMessage({ role: 'bot', text: '', caret: true });
        }
        full += evt.text || '';
        setText(streamMsg.textNode, full);
        scrollToBottom(false);
        return;
      }
      if (evt.type === 'done') {
        if (!streamMsg) {
          showTyping(false);
          streamMsg = addMessage({ role: 'bot', text: evt.text || full, error: evt.error });
        } else {
          if (streamMsg.caretEl) streamMsg.caretEl.remove();
          setText(streamMsg.textNode, evt.text || full);
        }
        if (evt.error) {
          streamMsg.bubble.style.borderColor = 'rgba(255,120,140,.45)';
          toast('DeepSeek 没接上，先看看控制台日志或检查 API Key');
        }
        if (evt.bubbles && evt.bubbles.length > 1 && !evt.error) {
          expandBubbles(streamMsg, evt.bubbles);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()));
          } catch {
            /* ignore malformed */
          }
        }
      }
    }

    if (!gotAny && !full) {
      showTyping(false);
      addMessage({ role: 'system', text: '（大肥鱼没有回应，可能是网络或接口问题）' });
    }
  } catch (err) {
    showTyping(false);
    addMessage({ role: 'system', text: '（连不上本地服务，确认 server 还开着：node server.js）' });
    console.error(err);
  } finally {
    state.streaming = false;
    sendBtn.disabled = false;
    showTyping(false);
    if (streamMsg && streamMsg.caretEl) streamMsg.caretEl.remove();
    setTimeout(() => scrollToBottom(false), 60);
  }
}

function ignoreReasonText(reason) {
  const map = {
    not_addressed: '（大肥鱼没被叫到，只在旁边冒了个泡）',
    duplicate: '（重复消息，大肥鱼跳过了）',
    muted: '（大肥鱼闭麦中…@ 她试试）',
    cooldown: '（大肥鱼刚说完，先歇一下）',
    rate_limited: '（大肥鱼今天话有点多，先歇一下）',
    no_text: '（没有文字内容）',
  };
  return map[reason] || `（大肥鱼没有接话：${reason}）`;
}

/* ---------------- 群友自动串门 ---------------- */
const AUTO_SCRIPT = [
  { from: '阿螈', text: '今天加班到十点，人已经麻了' },
  { from: '海胆酱', text: '@大肥鱼 你说人为什么要上班啊', at: true },
  { from: '小丑鱼', text: '哈哈哈哈哈哈哈' },
  { from: '阿螈', text: '大肥鱼，安慰我一下' },
];

let autoRunning = false;
async function runAutoGroup() {
  if (autoRunning || state.streaming) return;
  autoRunning = true;
  const btn = $('btnAutoGroup');
  btn.disabled = true;
  for (const step of AUTO_SCRIPT) {
    $('senderSel').value = step.from;
    await streamForGroup(step.text, step.from);
    await new Promise((r) => setTimeout(r, 700));
  }
  btn.disabled = false;
  autoRunning = false;
}

async function streamForGroup(text, sender) {
  // 复用 sendMessage 的渲染与流式逻辑，但固定发送者
  const prevMode = state.mode;
  state.mode = 'group';
  const prevVal = $('senderSel').value;
  $('senderSel').value = sender;
  const isAt = /^@/.test(text);
  if (!isAt) {
    // 非 @ 消息也走一次接口，让大肥鱼"旁听"（会被忽略）
    const payload = {
      text,
      mode: 'group',
      sessionId: state.sessionId,
      senderName: sender,
      msgId: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    };
    addMessage({ role: 'user', name: sender, text });
    showTyping(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('text/event-stream')) {
        const data = await res.json().catch(() => ({}));
        showTyping(false);
        if (data.action === 'ignore') addMessage({ role: 'system', text: ignoreReasonText(data.reason) });
      } else {
        // 少见：随机接话，直接读取完整流
        showTyping(false);
        await consumeStreamSimple(res);
      }
    } catch {
      showTyping(false);
    }
    state.mode = prevMode;
    $('senderSel').value = prevVal;
    return;
  }
  await sendMessage(text);
  state.mode = prevMode;
  $('senderSel').value = prevVal;
}

async function consumeStreamSimple(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  let msg = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (evt.type === 'delta') {
          if (!msg) msg = addMessage({ role: 'bot', text: '', caret: true });
          full += evt.text || '';
          setText(msg.textNode, full);
          scrollToBottom(false);
        } else if (evt.type === 'done') {
          if (!msg) msg = addMessage({ role: 'bot', text: evt.text || full });
          else {
            if (msg.caretEl) msg.caretEl.remove();
            setText(msg.textNode, evt.text || full);
          }
          if (evt.bubbles && evt.bubbles.length > 1) expandBubbles(msg, evt.bubbles);
        }
      }
    }
  }
}

/* ---------------- 设置 ---------------- */
function providerMeta() {
  return (state.settings && state.settings.providers) || {};
}

function fillProviderFields(provider, { keepValues = false } = {}) {
  const meta = providerMeta()[provider] || {};
  $('providerHint').textContent = meta.hint || '';
  const list = $('modelList');
  list.textContent = '';
  for (const m of meta.models || []) {
    const opt = document.createElement('option');
    opt.value = m;
    list.appendChild(opt);
  }
  if (!keepValues) {
    $('baseUrl').value = meta.baseUrl || '';
    $('model').value = meta.model || '';
  }
  const needsKey = meta.needsKey !== false;
  $('apiKey').placeholder = needsKey ? 'sk-…（这个服务需要 Key）' : '本地模型不需要 Key，留空即可';
  $('keyState').textContent = !needsKey
    ? '（不需要）'
    : state.settings && state.settings.hasKey
      ? '已保存 ' + state.settings.keyMasked
      : '';
}

async function openSettings() {
  $('settingsModal').hidden = false;
  $('userName').value = state.userName || '';
  $('testResult').textContent = '';
  $('testResult').className = 'test-result';
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    state.settings = data;
    // 称呼保存在服务端 data/settings.json（以前只存浏览器里，换设备/清缓存就没了）
    if (data.userName) {
      state.userName = data.userName;
      $('userName').value = data.userName;
    }
    const sel = $('provider');
    sel.textContent = '';
    for (const [key, meta] of Object.entries(data.providers || {})) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = meta.label || key;
      sel.appendChild(opt);
    }
    sel.value = data.provider || 'deepseek';
    $('baseUrl').value = data.baseUrl || '';
    $('model').value = data.model || '';
    fillProviderFields(sel.value, { keepValues: true });
    $('keyState').textContent = data.hasKey
      ? '已保存 ' + data.keyMasked
      : data.needsKey
        ? ''
        : '（不需要）';
    $('mockMode').checked = Boolean(data.mock);
    $('temperature').value = data.temperature ?? 1.25;
    if (data.hasKey && data.mock) {
      $('keyHelp').textContent = '⚠️ 已经保存了 API Key，但「演示模式」是开着的 —— 打开它只会说内置台词，不会调用模型。要真正聊天请把演示模式关掉。';
    }
    $('tempVal').textContent = Number(data.temperature ?? 1.25).toFixed(2).replace(/0$/, '');
    $('apiKey').value = '';
    $('keyHelp').textContent = 'Key 只保存在本机 data/settings.json；不会发给除你选的模型服务以外的任何地方。';
    $('requireAt').checked = data.group.requireAt;
    $('freeChat').checked = data.group.freeChat;
    $('freeChance').value = Math.round((data.group.freeChatChance || 0) * 100);
    $('chanceVal').textContent = Math.round((data.group.freeChatChance || 0) * 100) + '%';
    // 主动消息：按对象阈值
    const pro = data.proactive || {};
    if ($('proEnabled')) {
      $('proEnabled').checked = Boolean(pro.enabled);
      $('proQuietStart').value = pro.quietStart || '23:00';
      $('proQuietEnd').value = pro.quietEnd || '08:00';
      $('proPrompt').value = pro.prompt || '';
      renderProTargets(Array.isArray(pro.targets) ? pro.targets : []);
      $('proResult').textContent = '';
      $('proResult').className = 'test-result';
      // 真实微信会话下拉：选「指定会话」时直接挑，不用手打名字
      try {
        const sres = await fetch('/api/proactive/sessions');
        const sdata = await sres.json();
        const dl = $('proSessionList');
        if (dl && sdata.ok) {
          dl.textContent = '';
          for (const s of sdata.sessions || []) {
            const opt = document.createElement('option');
            opt.value = s.title;
            opt.textContent = (s.chatType === 'group' ? '群：' : '私聊：') + s.title;
            dl.appendChild(opt);
          }
        }
      } catch { /* 会话列表拉不到就手填，不影响 */ }
    }
    // 看图 Key 的状态：能看出「配没配、配的是哪一把」，输入框永远不回显明文
    if ($('visionApiKey')) $('visionApiKey').value = '';
    if ($('visionState')) {
      const v = data.vision || {};
      $('visionState').textContent = v.configured ? '已保存 ' + (v.keyMasked || '') : '（未配置）';
    }
    if ($('visionHelp') && data.vision && data.vision.configured && data.vision.model) {
      $('visionHelp').textContent = '当前看图模型：' + data.vision.model + '；留空 = 不改。想换 Key 直接填新的。';
    }
    if ($('visionResult')) {
      $('visionResult').textContent = '';
      $('visionResult').className = 'test-result';
    }
    updateWebhookCodes();
    await refreshStatus();
  } catch {
    toast('读取设置失败，服务还在吗？');
  }
}

function renderProTargets(list) {
  const box = $('proTargets');
  if (!box) return;
  box.textContent = '';
  if (!list.length) list = [{ type: 'master', name: '', enabled: true, silentMinutes: 60, maxPerHour: 2, maxPerDay: 10 }];
  for (const t of list) box.appendChild(proTargetRow(t));
}

function proTargetRow(t) {
  const row = document.createElement('div');
  row.className = 'pro-target';
  row.innerHTML =
    '<div class="pro-target-top">' +
    '<select class="pro-type"><option value="master">主人</option><option value="chat">指定会话</option></select>' +
    '<input class="pro-name" type="text" list="proSessionList" placeholder="备注名/群名" maxlength="60" />' +
    '<label class="check pro-on"><input type="checkbox" class="pro-enabled" /> 启用</label>' +
    '<button class="mini-btn pro-del" type="button">删</button>' +
    '</div>' +
    '<div class="pro-target-vals">' +
    '沉默 <input class="pro-silent" type="number" min="5" max="1440" /> 分钟后找她 · ' +
    '每小时最多 <input class="pro-hour" type="number" min="1" max="30" /> 条 · ' +
    '每天最多 <input class="pro-day" type="number" min="1" max="100" /> 条' +
    '</div>';
  row.querySelector('.pro-type').value = t.type === 'master' ? 'master' : 'chat';
  row.querySelector('.pro-name').value = t.name || '';
  row.querySelector('.pro-enabled').checked = t.enabled !== false;
  row.querySelector('.pro-silent').value = Number(t.silentMinutes) || 60;
  row.querySelector('.pro-hour').value = Number(t.maxPerHour) || 2;
  row.querySelector('.pro-day').value = Number(t.maxPerDay) || 10;
  const syncName = () => {
    row.querySelector('.pro-name').style.display = row.querySelector('.pro-type').value === 'chat' ? '' : 'none';
  };
  row.querySelector('.pro-type').addEventListener('change', syncName);
  syncName();
  row.querySelector('.pro-del').addEventListener('click', () => row.remove());
  return row;
}

function collectProTargets() {
  const box = $('proTargets');
  if (!box) return [];
  return [...box.querySelectorAll('.pro-target')].map((row) => ({
    type: row.querySelector('.pro-type').value,
    name: row.querySelector('.pro-name').value.trim(),
    enabled: row.querySelector('.pro-enabled').checked,
    silentMinutes: Number(row.querySelector('.pro-silent').value) || 60,
    maxPerHour: Number(row.querySelector('.pro-hour').value) || 2,
    maxPerDay: Number(row.querySelector('.pro-day').value) || 10,
  })).filter((t) => t.type === 'master' || t.name);
}

async function showProStatus() {
  const out = $('proResult');
  out.className = 'test-result';
  out.textContent = '读取中…';
  try {
    const res = await fetch('/api/proactive/status');
    const data = await res.json();
    const p = data.proactive || {};
    const lines = (p.targets || []).map((t) => {
      const bits = [];
      if (t.silentForMinutes !== null) bits.push('已沉默 ' + t.silentForMinutes + ' 分钟');
      if (t.snoozeUntil && t.snoozeUntil > Date.now()) bits.push('退避到 ' + new Date(t.snoozeUntil).toLocaleTimeString('zh-CN', { hour12: false }));
      bits.push('今天已发 ' + t.sentToday + ' 条');
      bits.push(t.ready ? '✅ 下一轮可发' : '暂不触发');
      return `${t.title}（${t.type === 'master' ? '主人' : '会话'}）：` + bits.join('，');
    });
    const head =
      (p.enabled ? (p.running ? '运行中' : '已启用但未运行') : '未启用') +
      (p.inQuietHours ? ' · 现在是静默时段' : '');
    const parts = [head];
    if (p.reason) parts.push('⚠ ' + p.reason);
    if (lines.length) parts.push(lines.join('\n'));
    else if (!p.reason) parts.push('（没有匹配到任何微信会话）');
    out.textContent = parts.join('\n');
  } catch (err) {
    out.textContent = '状态读取失败：' + err.message;
  }
}

function settingsPayload() {
  const payload = {
    provider: $('provider').value,
    baseUrl: $('baseUrl').value.trim(),
    model: $('model').value.trim(),
    mock: $('mockMode').checked,
    temperature: Number($('temperature').value),
    userName: $('userName').value.trim(),
    group: {
      requireAt: $('requireAt').checked,
      freeChat: $('freeChat').checked,
      freeChatChance: Number($('freeChance').value) / 100,
    },
  };
  // 主动消息：字段存在才提交（旧页面没有这一块）
  if ($('proEnabled')) {
    payload.proactive = {
      enabled: $('proEnabled').checked,
      quietStart: $('proQuietStart').value.trim(),
      quietEnd: $('proQuietEnd').value.trim(),
      prompt: $('proPrompt').value.trim(),
      targets: collectProTargets(),
    };
  }
  const key = $('apiKey').value.trim();
  if (key) {
    payload.apiKey = key;
    payload.mock = false; // 填了 Key 就关掉演示模式
  }
  // 看图 Key：留空表示不改（和主 Key 一样，不覆盖已存的）
  const vkey = $('visionApiKey') ? $('visionApiKey').value.trim() : '';
  if (vkey) payload.visionApiKey = vkey;
  return payload;
}

async function saveSettings() {
  const btn = $('saveSettings');
  btn.disabled = true;
  btn.textContent = '正在唤醒…';
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsPayload()),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '保存失败');
    state.userName = $('userName').value.trim();
    localStorage.setItem('whale.userName', state.userName);
    $('settingsModal').hidden = true;
    await refreshStatus();
    if (data.settings && data.settings.vision) {
      state.vision = data.settings.vision;
    }
    if (state.status && !state.status.mock) {
      addMessage({ role: 'system', text: `（大肥鱼浮上水面吸了口气：接下来用 ${data.settings.providerLabel || '新模型'} 说话啦）` });
      toast('已接入 ' + (data.settings.providerLabel || '模型') + '，跟她说句话试试~');
    } else {
      toast('已保存（当前是演示模式）');
    }
  } catch (err) {
    toast('保存失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存并唤醒大肥鱼';
  }
}

async function testConnection() {
  const btn = $('btnTest');
  const out = $('testResult');
  btn.disabled = true;
  out.className = 'test-result';
  out.textContent = '正在连接…';
  try {
    const res = await fetch('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsPayload()),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '连接失败');
    const p = data.probe || {};
    if (p.ok) {
      out.className = 'test-result ok';
      out.textContent = `✅ ${p.providerLabel || p.provider} · ${p.model}：连上了（${p.ms}ms）「${p.sample || ''}」`;
      await refreshStatus();
      toast('连接成功！现在可以真的聊天了');
    } else {
      out.className = 'test-result fail';
      out.textContent = '❌ ' + (p.message || '连接失败');
    }
  } catch (err) {
    out.className = 'test-result fail';
    out.textContent = '❌ ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

/** 测试看图：可以先用输入框里没保存的 Key 试，通了再保存 */
async function testVision() {
  const btn = $('btnVisionTest');
  const out = $('visionResult');
  if (!btn || !out) return;
  btn.disabled = true;
  out.className = 'test-result';
  out.textContent = '正在把测试图发给视觉模型…';
  try {
    const typed = $('visionApiKey') ? $('visionApiKey').value.trim() : '';
    const res = await fetch('/api/vision/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typed ? { apiKey: typed } : {}),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '看图失败');
    out.className = 'test-result ok';
    out.textContent = '✅ 看图可用' + (data.sample ? '：「' + data.sample + '」' : '');
    if (data.vision) {
      $('visionState').textContent = data.vision.configured ? '已保存 ' + (data.vision.keyMasked || '') : '（未配置）';
    }
    if (typed && $('visionState')) {
      out.textContent += '（记得点「保存并唤醒大肥鱼」把 Key 存下来）';
    }
    toast('看图通了');
  } catch (err) {
    out.className = 'test-result fail';
    out.textContent = '❌ ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- 微信桥接 ---------------- */
let wechatLogTimer = null;

async function openWechat() {
  $('wechatModal').hidden = false;
  await refreshWechatStatus();
  await refreshWechatPrecheck();
  // 弹窗开着时每 2 秒拉一次日志，实现实时滚动
  clearInterval(wechatLogTimer);
  wechatLogTimer = setInterval(() => {
    if ($('wechatModal').hidden) { clearInterval(wechatLogTimer); wechatLogTimer = null; return; }
    refreshWechatStatus();
  }, 2000);
}

async function refreshWechatPrecheck() {
  const el = $('wechatPrecheck');
  if (!el) return;
  el.textContent = '正在检测 Python 环境…';
  el.style.color = '#9ab';
  try {
    const res = await fetch('/api/wechat/precheck');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '预检失败');
    const p = data.precheck || {};
    if (p.ready) {
      el.textContent = '✅ ' + (p.hint || '环境就绪');
      el.style.color = '#7ddba8';
    } else {
      el.textContent = '⚠️ ' + (p.hint || '环境未就绪');
      el.style.color = '#ffb86c';
    }
  } catch (err) {
    el.textContent = '🔴 预检失败：' + err.message;
    el.style.color = '#ff7a7a';
  }
}

async function refreshWechatStatus() {
  const stateEl = $('wechatState');
  const logEl = $('wechatLog');
  try {
    const res = await fetch('/api/wechat/status');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '状态接口异常');
    const b = data.bridge || {};
    if (b.running) {
      const secs = b.startedAt ? Math.max(0, Math.floor((Date.now() - b.startedAt) / 1000)) : 0;
      stateEl.textContent = `🟢 运行中（pid=${b.pid}，已 ${secs}s）`;
      stateEl.style.color = '#7ddba8';
    } else {
      stateEl.textContent = '⚪ 未运行';
      stateEl.style.color = '#9ab';
    }
    if (b.lastError) stateEl.textContent += ' · 错误：' + b.lastError;
    logEl.textContent = (b.log && b.log.length) ? b.log.join('\n') : '（暂无输出）';
    logEl.scrollTop = logEl.scrollHeight;
  } catch (err) {
    stateEl.textContent = '🔴 查询失败：' + err.message;
    stateEl.style.color = '#ff7a7a';
  }
}

async function wechatAction(action) {
  const stateEl = $('wechatState');
  stateEl.textContent = action === 'start' ? '启动中…' : '停止中…';
  try {
    const res = await fetch(`/api/wechat/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      // 启动失败：把预检提示完整显示出来
      const msg = data.error || '操作失败';
      stateEl.textContent = '🔴 ' + msg;
      stateEl.style.color = '#ff7a7a';
      toast(msg, 6000);
      await refreshWechatPrecheck();
      return;
    }
    toast(action === 'start' ? '桥接已启动' : '桥接已停止');
  } catch (err) {
    const msg = (action === 'start' ? '启动失败：' : '停止失败：') + err.message;
    stateEl.textContent = '🔴 ' + msg;
    stateEl.style.color = '#ff7a7a';
    toast(msg, 6000);
  } finally {
    // 启动后立刻刷一次，3 秒后再刷一次（桥接可能秒退）
    setTimeout(refreshWechatStatus, 500);
    setTimeout(refreshWechatStatus, 3000);
  }
}

/* ---------------- 输入框 ---------------- */
function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(128, inputEl.scrollHeight) + 'px';
}

function bindEvents() {
  sendBtn.addEventListener('click', () => sendMessage());

  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  $('btnMode').addEventListener('click', () => {
    state.mode = state.mode === 'group' ? 'private' : 'group';
    localStorage.setItem('whale.mode', state.mode);
    applyMode();
    addMessage({
      role: 'system',
      text: state.mode === 'group' ? '（切到群聊：深海鱼塘，选一个群友身份说话吧）' : '（切回私聊：只有你和大肥鱼）',
    });
  });

  $('btnSettings').addEventListener('click', openSettings);
  $('btnWechat').addEventListener('click', openWechat);
  $('btnWechatStart').addEventListener('click', () => wechatAction('start'));
  $('btnWechatStop').addEventListener('click', () => wechatAction('stop'));
  $('btnWechatRefresh').addEventListener('click', refreshWechatStatus);
  $('saveSettings').addEventListener('click', saveSettings);
  if ($('btnProAddTarget')) $('btnProAddTarget').addEventListener('click', () => {
    $('proTargets').appendChild(proTargetRow({ type: 'chat', name: '', enabled: true, silentMinutes: 120, maxPerHour: 1, maxPerDay: 5 }));
  });
  if ($('btnProStatus')) $('btnProStatus').addEventListener('click', showProStatus);
  $('btnAutoGroup').addEventListener('click', runAutoGroup);
  $('btnTest').addEventListener('click', testConnection);
  const vBtn = $('btnVisionTest');
  if (vBtn) vBtn.addEventListener('click', testVision);

  // 填了 Key 就自动关掉演示模式（否则会一直用内置台词）
  $('apiKey').addEventListener('input', () => {
    if ($('apiKey').value.trim()) $('mockMode').checked = false;
  });

  // 切换模型服务：自动填好该服务的默认地址和模型
  $('provider').addEventListener('change', () => {
    fillProviderFields($('provider').value);
    $('testResult').textContent = '';
    $('testResult').className = 'test-result';
  });

  // 点头像看名片（完整立绘）
  const aboutBtn = $('btnAbout');
  const openAbout = () => { $('aboutModal').hidden = false; };
  aboutBtn.addEventListener('click', openAbout);
  aboutBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAbout();
    }
  });

  $('btnAt').addEventListener('click', () => {
    const prefix = '@大肥鱼 ';
    if (!inputEl.value.includes(prefix)) inputEl.value = prefix + inputEl.value;
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    autoGrow();
  });

  $('temperature').addEventListener('input', (e) => {
    $('tempVal').textContent = Number(e.target.value).toFixed(2).replace(/0$/, '');
  });
  $('freeChance').addEventListener('input', (e) => {
    $('chanceVal').textContent = e.target.value + '%';
  });

  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      $(id).hidden = true;
    });
  }
  for (const modal of document.querySelectorAll('.modal')) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const modal of document.querySelectorAll('.modal')) modal.hidden = true;
    }
  });

  for (const btn of document.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', async () => {
      const text = $(btn.getAttribute('data-copy')).textContent;
      try {
        await navigator.clipboard.writeText(text);
        toast('已复制：' + text);
      } catch {
        toast('复制失败，手动选中吧：' + text);
      }
    });
  }
}

/* ---------------- 启动 ---------------- */
async function boot() {
  makeBubbles();
  bindEvents();
  applyMode();
  await refreshStatus();
  updateWebhookCodes();

  addMessage({
    role: 'bot',
    text: '在，咋啦？\n有啥想说的就说呗，我今天有点闲',
  });

  if (state.mode === 'group') {
    addMessage({ role: 'system', text: '（深海鱼塘：点「让群友来串门」看看她在群里怎么接话）' });
  } else {
    addMessage({ role: 'system', text: '（提示：被叫「大肥鱼」她就会理你；说「记住：…」她会记在小本本上）' });
  }

  setInterval(() => refreshStatus().catch(() => {}), 30000);
}

boot();
