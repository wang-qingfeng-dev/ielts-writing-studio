import { app, BrowserWindow, Menu, shell } from 'electron';
import { createServer } from '../server.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4318);
let server;
let windowRef;

// 从 .cmd 双击启动时，父进程可能提前关闭输出管道；吞掉 EPIPE，避免把桌面程序变成错误弹窗。
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => {});
function reportStartupError(error) {
  try {
    if (process.stderr?.writable && !process.stderr.destroyed) process.stderr.write(`${error?.stack || error}\n`);
  } catch { /* 启动器没有可用输出管道时不影响应用退出。 */ }
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: '句进 · 雅思写作工作台',
    backgroundColor: '#f6f5ef',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  windowRef.webContents.setWindowOpenHandler(({url}) => {
    if (/^https:\/\//i.test(url)) { void shell.openExternal(url); }
    return {action:'deny'};
  });
  void windowRef.loadURL(`http://127.0.0.1:${port}/`).catch(reportStartupError);
  windowRef.on('closed', () => { windowRef = null; });
}

app.whenReady().then(async () => {
  // Windows/Linux 桌面版不显示 Electron 默认的 File / Edit / View / Help 菜单。
  // 软件内的练习记录、复习库和更新入口都放在可见的中文工具栏中。
  Menu.setApplicationMenu(null);
  server = createServer({shutdown: () => app.quit()});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { reportStartupError(error); app.quit(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (server) server.close(); });
