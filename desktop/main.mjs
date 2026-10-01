import { app, BrowserWindow, shell } from 'electron';
import { createServer } from '../server.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4318);
let server;
let windowRef;

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
  void windowRef.loadURL(`http://127.0.0.1:${port}/`);
  windowRef.on('closed', () => { windowRef = null; });
}

app.whenReady().then(async () => {
  server = createServer({shutdown: () => app.quit()});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { console.error(error); app.quit(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (server) server.close(); });
