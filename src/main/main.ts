import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRefactorPlan,
  buildDiffPreview,
  buildRefactorPlan,
  listRollbackManifests,
  rollbackFromManifestFile,
  scanProject,
  type RefactorOperation,
  type RefactorPlan,
} from '../core/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: 'File Refactor Engine',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    void mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc(): void {
  ipcMain.handle('project:select', async () => {
    const options: OpenDialogOptions = {
      title: 'Select project root',
      properties: ['openDirectory'],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('project:scan', async (_event, rootPath: string) => scanProject(rootPath));
  ipcMain.handle('refactor:plan', async (_event, rootPath: string, operation: RefactorOperation) => buildRefactorPlan(rootPath, operation));
  ipcMain.handle('refactor:diff', async (_event, plan: RefactorPlan) => buildDiffPreview(plan));
  ipcMain.handle('refactor:apply', async (_event, plan: RefactorPlan) => applyRefactorPlan(plan));
  ipcMain.handle('rollback:list', async (_event, rootPath: string) => listRollbackManifests(rootPath));
  ipcMain.handle('rollback:run', async (_event, manifestPath: string) => rollbackFromManifestFile(manifestPath));
}
