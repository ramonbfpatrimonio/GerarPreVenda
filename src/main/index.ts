import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registrarIpc } from './ipc'
import { configurarAtualizacao } from './atualizacao'
import { fecharTodos } from './db'

let janela: BrowserWindow | null = null

function criarJanela() {
  janela = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'Gerar Pré-Venda',
    backgroundColor: '#f4f5f7',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  janela.on('ready-to-show', () => janela?.maximize())
  janela.once('ready-to-show', () => janela?.show())
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void janela.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void janela.loadFile(join(__dirname, '../renderer/index.html'))
  }
  janela.on('closed', () => (janela = null))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore()
      janela.focus()
    }
  })
  app.whenReady().then(() => {
    app.setAppUserModelId('br.com.ramon.gerarprevenda')
    registrarIpc(() => janela)
    configurarAtualizacao(() => janela)
    criarJanela()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanela()
    })
  })
  app.on('window-all-closed', async () => {
    await fecharTodos()
    if (process.platform !== 'darwin') app.quit()
  })
}
