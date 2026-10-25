'use strict';

/**
 * 发布前自检：打 zip 之前跑一遍，防止「代码改了但没进包」。
 *
 * 起因：3.0.3 的包里 web/index.html 还是旧的，导致「设置里找不到看图 API」，
 * 而源目录 D: 里明明是好的 —— 因为打包时从一份没同步全的副本取的。
 *
 * 用法：node scripts/release-check.js [目录，默认项目根]
 * 退出码：0 通过 / 1 有问题
 */
const fs = require('node:fs');
const path = require('node:path');

// 参数：第一个非 -- 开头的值是目录；--release 表示「这是发布树，不该有 data/config/runtime」
const argv = process.argv.slice(2);
const dirArg = argv.find((a) => !a.startsWith('--'));
const root = path.resolve(dirArg || path.join(__dirname, '..'));
const problems = [];
const rows = [];

function read(rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return '';
  }
}

function check(name, ok, detail = '') {
  rows.push({ name, ok, detail });
  if (!ok) problems.push(name + (detail ? '：' + detail : ''));
}

function mustInclude(rel, needles) {
  const text = read(rel);
  if (!text) {
    check(rel + ' 存在', false, '文件不存在');
    return;
  }
  for (const [label, needle] of needles) {
    check(`${rel} 含「${label}」`, text.includes(needle));
  }
}

// 1) 看图（图片识别）这条链路
mustInclude('web/index.html', [
  ['看图 API Key', 'visionApiKey'],
  ['测试看图按钮', 'btnVisionTest'],
]);
mustInclude('web/assets/app.js', [
  ['调用测试接口', '/api/vision/test'],
  ['提交 visionApiKey', 'visionApiKey'],
]);
mustInclude('server.js', [
  ['看图测试接口', "/api/vision/test"],
  ['返回 vision 状态', 'vision.status(config)'],
]);
mustInclude('src/vision.js', [
  ['Key 兜底解析', 'resolveKey'],
  ['按文件头判格式', 'sniffMime'],
  ['wxgf 提示', 'wxgf'],
]);

// 2) 主人识别
mustInclude('src/master.js', [['判定函数', 'matchMaster']]);
mustInclude('src/bot.js', [['剔除身份争执', 'stripMasterDispute']]);

// 3) UIA 可诊断
mustInclude('bridge/wechatauto_bridge.py', [
  ['ffmpeg 自检', 'ensure_ffmpeg_env'],
  ['wxgf 转码', '_wxgf_to_jpg'],
  ['失败原因解释', 'explain_uia_failure'],
  ['中文路径提醒', '路径里有中文'],
]);
check('tools/uia-diag.py 存在', fs.existsSync(path.join(root, 'tools/uia-diag.py')));

// 4) 包里不该有隐私/运行数据（只有 --release 时才检查；在开发目录里这些本来就有）
const release = argv.includes('--release');
if (release) {
  check('没有 data/ 目录', !fs.existsSync(path.join(root, 'data')), '打包时要把 data/ 排除');
  check('没有 config.json', !fs.existsSync(path.join(root, 'config.json')), '用户自己的配置不该进包');
  check('没有 runtime/', !fs.existsSync(path.join(root, 'runtime')), '源码包不带运行时');
  check('没有 wechatauto_db/', !fs.existsSync(path.join(root, 'wechatauto_db')), '微信数据库快照不该进包');
} else {
  console.log('（开发目录模式：跳过 data/、config.json、runtime/ 的检查；打包前加 --release 再跑）\n');
}

// 5) 版本号与 CHANGELOG 首条一致
try {
  const pkg = JSON.parse(read('package.json'));
  const cl = read('CHANGELOG.md');
  const m = cl.match(/^##\s*([0-9]+\.[0-9]+\.[0-9]+)/m);
  check('package.json 版本 = CHANGELOG 最新条目', Boolean(m) && m[1] === pkg.version,
    `package=${pkg.version} changelog=${m ? m[1] : '没找到'}`);
} catch (e) {
  check('package.json 可解析', false, e.message);
}

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
console.log(`发布自检：${root}\n`);
for (const r of rows) {
  console.log(`${r.ok ? '✓' : '✗'} ${pad(r.name, 46)}${r.detail || ''}`);
}
console.log('');
if (problems.length) {
  console.error(`发现 ${problems.length} 个问题，先修再打包：`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`全部通过（${rows.length} 项）`);
