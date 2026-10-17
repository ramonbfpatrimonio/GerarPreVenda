// Atualização automática pela nuvem (GitHub Releases).
// Ao publicar uma versão nova com `npm run release`, todos os computadores
// baixam em segundo plano e oferecem "Reiniciar e atualizar".
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

export type EstadoAtualizacao =
  | { tipo: 'verificando' }
  | { tipo: 'disponivel'; versao: string }
  | { tipo: 'baixando'; percentual: number }
  | { tipo: 'pronta'; versao: string }
  | { tipo: 'atualizado' }
  | { tipo: 'erro'; mensagem: string }

export function configurarAtualizacao(janela: () => BrowserWindow | null) {
  const enviar = (e: EstadoAtualizacao) => janela()?.webContents.send('atualizacao:estado', e)

  ipcMain.handle('atualizacao:versao', () => app.getVersion())
  ipcMain.handle('atualizacao:instalar', () => autoUpdater.quitAndInstall(false, true))
  ipcMain.handle('atualizacao:verificar', async () => {
    if (!app.isPackaged) return { ok: false, erro: 'Atualização só funciona no programa instalado.' }
    await autoUpdater.checkForUpdates().catch(() => undefined)
    return { ok: true }
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => enviar({ tipo: 'verificando' }))
  autoUpdater.on('update-available', (i) => enviar({ tipo: 'disponivel', versao: i.version }))
  autoUpdater.on('update-not-available', () => enviar({ tipo: 'atualizado' }))
  autoUpdater.on('download-progress', (p) => enviar({ tipo: 'baixando', percentual: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => enviar({ tipo: 'pronta', versao: i.version }))
  autoUpdater.on('error', (e) => enviar({ tipo: 'erro', mensagem: e?.message ?? String(e) }))

  const verificar = () => autoUpdater.checkForUpdates().catch(() => undefined)
  setTimeout(verificar, 5000)
  setInterval(verificar, 4 * 60 * 60 * 1000) // a cada 4 horas
}
