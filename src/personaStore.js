'use strict';

/**
 * 主人通过微信「魔咒」调整的人设/能力，持久化在 data/persona.json。
 * 启动时合并进 config，改完立即生效，重启也保留。
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'persona.json';

function fileFor(config) {
  try {
    return path.join(config.paths.dataDir, FILE_NAME);
  } catch {
    return '';
  }
}

function load(config) {
  const file = fileFor(config);
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) || {};
  } catch {
    return {};
  }
}

function save(config, patch) {
  const file = fileFor(config);
  // 以当前生效值为底，避免“只改了一半”把别的设置冲掉（也兼容没有写文件权限的环境）
  const base = {
    preset: config.persona && config.persona.stylePreset,
    text: config.persona && config.persona.styleText,
    emoji: config.persona && config.persona.emojiLevel,
    privateMaxChars: config.chat && config.chat.privateMaxChars,
    groupMaxChars: config.chat && config.chat.groupMaxChars,
    links: config.links ? config.links.enabled !== false : undefined,
    freeChat: config.group ? Boolean(config.group.freeChat) : undefined,
    mutedGroups: config.group && Array.isArray(config.group.mutedGroups) ? config.group.mutedGroups : undefined,
    historyTurns: config.chat ? config.chat.historyTurns : undefined,
    groupHistoryTurns: config.chat ? config.chat.groupHistoryTurns : undefined,
    emotions: config.persona ? config.persona.emotions !== false : undefined,
    proactive: config.persona ? config.persona.proactive !== false : undefined,
    opinions: config.persona ? config.persona.opinions !== false : undefined,
    masterRoast: config.persona ? Boolean(config.persona.masterRoast) : undefined,
    name: config.persona ? config.persona.name : undefined,
    appearance: config.persona ? config.persona.appearance : undefined,
    personality: config.persona ? config.persona.personality : undefined,
    background: config.persona ? config.persona.background : undefined,
    customPrompt: config.persona ? config.persona.customPrompt : undefined,
    // 原调试台独有项，并入调教页
    aliases: config.persona && Array.isArray(config.persona.aliases) ? config.persona.aliases : undefined,
    requireAt: config.group ? Boolean(config.group.requireAt) : undefined,
    maxBubbles: config.chat ? config.chat.maxBubbles : undefined,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  const next = { ...base, ...load(config), ...patch };
  // 清掉空值，保持文件干净
  for (const [k, v] of Object.entries(next)) {
    if (v === '' || v === null || v === undefined) delete next[k];
  }
  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    } catch {
      /* 测试环境可能没有目录权限，忽略 */
    }
  }
  apply(config, next);
  return next;
}

const DEFAULTS = {
  preset: '',
  text: '',
  emoji: '正常',
  privateMaxChars: 140,
  groupMaxChars: 70,
  historyTurns: 200,
  groupHistoryTurns: 150,
  links: true,
  freeChat: false,
  mutedGroups: [],
  emotions: true,
  proactive: true,
  opinions: true,
  name: '大肥鱼',
  appearance: '深蓝色长卷发，头发上别着一枚鲸尾发夹，常穿深蓝色水手领裙子，怀里或包里总有一只软乎乎的蓝鲸玩偶（你叫它小蓝鲸）。',
  personality: '温柔但有点小倔，嘴硬心软，慢热；熟了话很多，会害羞、会怼人、会犯懒、偶尔 emo。',
  background: '因为头像和玩偶全是鲸鱼，朋友开玩笑叫你「鲸鱼娘」，你也就认了。',
};

function clear(config) {
  const file = fileFor(config);
  if (file) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
  apply(config, { ...DEFAULTS });
  return {};
}

/** 把存档合并进 config（提示词 / 长度 / 能力开关都从这里读） */
function apply(config, data) {
  data = data || {};
  if (!config.persona) config.persona = {};
  config.persona.stylePreset = data.preset || '';
  config.persona.styleText = data.text || '';
  config.persona.emojiLevel = data.emoji || '';

  if (!config.chat) config.chat = {};
  config.chat.privateMaxChars = Number(data.privateMaxChars) || 140;
  config.chat.groupMaxChars = Number(data.groupMaxChars) || 70;

  if (!config.links) config.links = {};
  config.links.enabled = data.links === undefined ? true : Boolean(data.links);

  if (!config.group) config.group = {};
  if (data.freeChat !== undefined) config.group.freeChat = Boolean(data.freeChat);
  config.group.mutedGroups = Array.isArray(data.mutedGroups) ? data.mutedGroups.slice() : [];
  const ht = Number(data.historyTurns);
  config.chat.historyTurns = ht > 0 ? Math.max(4, Math.min(400, ht)) : 200;
  const ght = Number(data.groupHistoryTurns);
  config.chat.groupHistoryTurns = ght > 0 ? Math.max(2, Math.min(300, ght)) : 150;
  // 保存条数必须覆盖模型窗口及本轮输入/回复，避免面板设了 100 实际只剩 40。
  if (!config.memory) config.memory = {};
  config.memory.maxMessages = Math.min(500, Math.max(Number(config.memory.maxMessages) || 160, config.chat.historyTurns + 2, config.chat.groupHistoryTurns + 2));
  config.persona.emotions = data.emotions !== false;
  // 主人被骂时她能不能还嘴（默认关；开了就允许毒舌互怼，但不许真脏字）
  if (data.masterRoast !== undefined) config.persona.masterRoast = Boolean(data.masterRoast);
  config.persona.proactive = data.proactive !== false;
  config.persona.opinions = data.opinions !== false;
  for (const k of ['name', 'appearance', 'personality', 'background']) {
    if (data[k] !== undefined) config.persona[k] = String(data[k] || '');
  }
  if (data.customPrompt !== undefined) config.persona.customPrompt = String(data.customPrompt || '');
  // 原调试台独有项，并入调教页
  if (data.aliases !== undefined) {
    config.persona.aliases = Array.isArray(data.aliases) ? data.aliases.map((s) => String(s).trim()).filter(Boolean).slice(0, 20) : [];
  }
  if (data.requireAt !== undefined) config.group.requireAt = Boolean(data.requireAt);
  if (data.maxBubbles !== undefined) config.chat.maxBubbles = Math.max(1, Math.min(6, Number(data.maxBubbles) || 2));
  return config;
}

function summary(config) {
  return {
    preset: config.persona.stylePreset || '',
    text: config.persona.styleText || '',
    emoji: config.persona.emojiLevel || '正常',
    privateMaxChars: config.chat.privateMaxChars,
    groupMaxChars: config.chat.groupMaxChars,
    links: config.links.enabled !== false,
    freeChat: Boolean(config.group.freeChat),
    mutedGroups: Array.isArray(config.group.mutedGroups) ? config.group.mutedGroups.slice() : [],
    historyTurns: config.chat.historyTurns,
    groupHistoryTurns: config.chat.groupHistoryTurns,
    emotions: config.persona.emotions !== false,
    proactive: config.persona.proactive !== false,
    opinions: config.persona.opinions !== false,
    masterRoast: Boolean(config.persona.masterRoast),
    name: config.persona.name,
    appearance: config.persona.appearance,
    personality: config.persona.personality,
    background: config.persona.background,
    customPrompt: config.persona.customPrompt || '',
    aliases: Array.isArray(config.persona.aliases) ? config.persona.aliases.slice() : [],
    requireAt: config.group ? config.group.requireAt !== false : true,
    maxBubbles: config.chat ? Number(config.chat.maxBubbles) || 2 : 2,
  };
}

module.exports = { load, save, clear, apply, summary };
