'use strict';

/**
 * 大肥鱼桌面壳：用 Electron 把网页聊天界面包成一个独立窗口。
 *
 * 启动流程：
 *   1. app.ready → 启动内嵌的 server.js（HTTP + SSE）
 *   2. server 监听成功 → 创建 BrowserWindow 加载 http://127.0.0.1:<port>
 *   3. 窗口全部关闭 → 停掉 server → 退出 app
 *
 * 用法（开发）：npx electron .
 * 打包：见 package.json 的 dist 脚本（electron-builder）
 */
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');

// 项目根目录：开发态是仓库根，打包后是 resources/app
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(__dirname, '..');

let serverInstance = null;
let mainWindow = null;

async function startEmbeddedServer() {
  const { startServer } = require(path.join(ROOT, 'server.js'));
  // openBrowser:false → 不调用系统默认浏览器，由我们自己建窗口
  return startServer({ root: ROOT, openBrowser: false });
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    title: '大肥鱼 · 深海聊天机器人',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(url);

  // 同源内链（调教、调试等 /persona /debug）在 Electron 内开新窗口；
  // 真正的外链（http(s) 且非本服务）才交给系统浏览器
  const serverOrigin = new URL(url).origin;
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    try {
      const target = new URL(u);
      if (target.origin === serverOrigin) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 980,
            height: 720,
            autoHideMenuBar: true,
            title: '大肥鱼 · ' + (target.pathname.replace(/^\//, '') || '页面'),
          },
        };
      }
    } catch (_) {
      // URL 解析失败也走外链
    }
    shell.openExternal(u);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

app.whenReady().then(async () => {
  try {
    serverInstance = await startEmbeddedServer();
  } catch (err) {
    console.error('启动内嵌服务失败：', err);
    app.exit(1);
    return;
  }
  mainWindow = createWindow(serverInstance.url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(serverInstance.url);
    }
  });
});

app.on('window-all-closed', async () => {
  try {
    if (serverInstance && typeof serverInstance.close === 'function') {
      await serverInstance.close();
    }
  } catch (_) {
    // ignore
  }
  if (process.platform !== 'darwin') app.quit();
});
