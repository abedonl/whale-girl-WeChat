'use strict';

/**
 * 微信桥接进程管理：从桌面端一键拉起 bridge/wechatauto_bridge.py。
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

function findPython(root) {
  // 优先用项目自带的 runtime\python\python.exe（已预装 wechatauto 等依赖）；
  // root 由调用方传入（项目根目录），避免依赖 process.cwd()（打包后不可靠）
  const candidates = [];
  if (root) {
    // 开发模式：root 就是项目根
    candidates.push(path.join(root, 'runtime', 'python', 'python.exe'));
    candidates.push(path.join(root, 'runtime', 'python.exe'));
    // Electron 打包模式：root = resources/app，runtime 被复制到 exe 同级目录
    // 即 root/../../runtime/python/python.exe
    candidates.push(path.join(root, '..', '..', 'runtime', 'python', 'python.exe'));
    candidates.push(path.join(root, '..', '..', 'runtime', 'python.exe'));
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, '..', 'runtime', 'python', 'python.exe'));
  }
  candidates.push('py', 'python');
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

async function detectPython(root) {
  const { execFile } = require('node:child_process');
  for (const cmd of findPython(root)) {
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

/** 启动前预检：检查 Python 与必需依赖是否就位。返回可操作的诊断结果。 */
async function precheck(root) {
  const { execFile } = require('node:child_process');
  const py = await detectPython(root);
  const result = { python: null, deps: {}, pathWarning: '', ready: false, hint: '' };
  if (!py) {
    result.hint = '未检测到 Python 3。请先安装 Python 3.10+ 并勾选「Add to PATH」。';
    return result;
  }
  result.python = py;
  // 检查必需依赖
  const checkDep = (mod) => new Promise((resolve) => {
    const args = py === 'py' ? ['-3', '-c', `import ${mod}`] : ['-c', `import ${mod}`];
    execFile(py, args, { timeout: 8000 }, (err) => resolve(!err));
  });
  result.deps.requests = await checkDep('requests');
  // pip 包名是 wechatauto-replica，import 名是 wechatauto
  result.deps.wechatauto = await checkDep('wechatauto');
  const missing = [];
  if (!result.deps.requests) missing.push('requests');
  if (!result.deps.wechatauto) missing.push('wechatauto-replica');
  if (missing.length) {
    result.hint = `缺少依赖：${missing.join('、')}。请先运行：${py} -m pip install ${missing.join(' ')}`;
    return result;
  }
  result.ready = true;
  result.hint = `环境就绪（${py}），可以启动桥接。`;
  return result;
}

async function start({ root, port, logger }) {
  if (child && !child.killed) {
    return { ok: true, already: true, status: status() };
  }
  const script = path.join(root, 'bridge', 'wechatauto_bridge.py');
  if (!fs.existsSync(script)) {
    lastError = '找不到 bridge/wechatauto_bridge.py';
    return { ok: false, error: lastError };
  }
  const py = await detectPython(root);
  if (!py) {
    lastError = '未检测到 Python 3，请先安装 Python 3.10+ 并加入 PATH';
    return { ok: false, error: lastError };
  }
  const args = py === 'py' ? ['-3', script] : [script];
  const env = {
    ...process.env,
    WHALE_BOT_URL: `http://127.0.0.1:${port}/webhook/wechat`,
    PYTHONUNBUFFERED: '1',
    // 强制 Python 用 UTF-8 输出，否则 Windows 默认 GBK 会导致前端日志乱码
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
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

module.exports = { start, stop, status, precheck };
