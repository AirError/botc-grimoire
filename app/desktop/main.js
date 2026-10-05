// Настольная обёртка «Гримуара»: одно окно с тем же приложением, что и на телефоне.
// Игра хранится локально (localStorage в профиле приложения), без облака claude.ai.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 520, height: 920, minWidth: 360, minHeight: 600,
    title: 'Гримуар рассказчика', backgroundColor: '#0F121B', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  // внешние ссылки — в обычном браузере
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
