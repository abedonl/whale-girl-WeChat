'use strict';

/**
 * 微信桥接进程管理：从桌面端一键拉起 examples/wechatauto_bridge.py。
 *
 * 使用前提：
 *   - 本机装有 Python 3.10+（py 或 python 任一可用）
 *   - 已 pip install wechatauto-replica
 *   - 微信 Windows 版已登录
 *
 * 桥接通过环境变量 WHALE_BOT_URL 回调本服务的 /webhook/wechat。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

let child = null;
let startedAt = 0;
let lastError = '';
let recentLog = []; // 最近 50 行输出，方便前端展示

function pushLog(line) {
  const s = String(line || '').trimEnd();
  if (!s) return;
  recentLog.push(s);
  if (recentLog.length > 50) recentLog.shift();
}

function findPython() {
  // 优先用项目自带的 runtime（如果将来打包进去），否则用系统 python
  const candidates = [
    path.join(process.cwd(), 'runtime', 'python.exe'),
    'py',
    'python',
  ];
  return candidates;
}

function status() {
  return {
    running: !!child && !child.killed,
    pid: child ? child.pid : 0,
    startedAt,
    lastError,
    log: recentLog.slice(-20),
  };
}

async function detectPython() {
  const { execFile } = require('node:child_process');
  for (const cmd of findPython()) {
    const ok = await new Promise((resolve) => {
      execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) return resolve(false);
        const v = String(stdout || stderr || '').trim();
        resolve(/^Python 3\./.test(v));
      });
    });
    if (ok) return cmd;
  }
  return null;
}

async function start({ root, port, logger }) {
  if (child && !child.killed) {
    return { ok: true, already: true, status: status() };
  }
  const script = path.join(root, 'examples', 'wechatauto_bridge.py');
  if (!fs.existsSync(script)) {
    lastError = '找不到 examples/wechatauto_bridge.py';
    return { ok: false, error: lastError };
  }
  const py = await detectPython();
  if (!py) {
    lastError = '未检测到 Python 3，请先安装 Python 3.10+ 并加入 PATH';
    return { ok: false, error: lastError };
  }
  const args = py === 'py' ? ['-3', script] : [script];
  const env = {
    ...process.env,
    WHALE_BOT_URL: `http://127.0.0.1:${port}/webhook/wechat`,
    PYTHONUNBUFFERED: '1',
  };
  recentLog = [];
  lastError = '';
  try {
    child = spawn(py, args, { cwd: root, env, windowsHide: true });
  } catch (err) {
    lastError = '启动失败：' + (err && err.message);
    return { ok: false, error: lastError };
  }
  startedAt = Date.now();
  child.stdout.on('data', (d) => pushLog(d.toString('utf8')));
  child.stderr.on('data', (d) => pushLog('[err] ' + d.toString('utf8')));
  child.on('exit', (code) => {
    pushLog(`桥接退出 code=${code}`);
    if (logger) logger.warn(`微信桥接退出 code=${code}`);
    child = null;
  });
  child.on('error', (err) => {
    lastError = err && err.message || String(err);
    pushLog('[error] ' + lastError);
    child = null;
  });
  if (logger) logger.info(`微信桥接已启动 pid=${child.pid}`);
  return { ok: true, status: status() };
}

function stop({ logger }) {
  if (!child) return { ok: true, already: true };
  try {
    child.kill();
    if (logger) logger.info(`微信桥接已停止 pid=${child.pid}`);
  } catch (err) {
    lastError = err && err.message || String(err);
  }
  child = null;
  return { ok: true };
}

module.exports = { start, stop, status };
