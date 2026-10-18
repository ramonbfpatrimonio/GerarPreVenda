// Backups locais e cache da aparência (fundo/logo da tela de login).
//
// Backup local: cópia dos arquivos de configuração deste computador
// (conexões com as senhas cifradas, fila offline, aparência) para
// Documentos\Gerar Pre-Venda\Backups\AAAA-MM-DD_HHMMSS. Um automático por dia,
// ao abrir o programa; ficam os 30 mais recentes.
// As senhas continuam cifradas pelo Windows: o backup só é restaurável neste
// mesmo usuário do Windows (para levar a outro PC use Exportar conexões).

import { app, dialog, shell, type BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile, rename } from 'fs/promises'

const ARQUIVOS = ['conexoes.json', 'fila-historico.dat', 'aparencia.json']
const MANTER = 30

export const pastaBackups = () => join(app.getPath('documents'), 'Gerar Pre-Venda', 'Backups')
const dados = (nome: string) => join(app.getPath('userData'), nome)

export interface InfoBackup {
  nome: string
  criadoEm: string
  automatico: boolean
  arquivos: string[]
  tamanho: number
}

function carimbo(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export async function fazerBackup(automatico = false, sufixo = ''): Promise<InfoBackup> {
  // nunca reaproveita uma pasta existente (dois backups no mesmo segundo)
  const raiz = carimbo() + (automatico ? '_auto' : '') + sufixo
  let nome = raiz
  for (let i = 2; existsSync(join(pastaBackups(), nome)); i++) nome = `${raiz}_${i}`
  const destino = join(pastaBackups(), nome)
  await mkdir(destino, { recursive: true })
  const copiados: string[] = []
  let tamanho = 0
  for (const a of ARQUIVOS) {
    if (!existsSync(dados(a))) continue
    await copyFile(dados(a), join(destino, a))
    copiados.push(a)
    tamanho += (await stat(dados(a))).size
  }
  const info: InfoBackup = { nome, criadoEm: new Date().toISOString(), automatico, arquivos: copiados, tamanho }
  await writeFile(join(destino, 'backup.json'), JSON.stringify({ ...info, versao: app.getVersion() }, null, 2))
  await limparAntigos()
  return info
}

export async function listarBackups(): Promise<InfoBackup[]> {
  if (!existsSync(pastaBackups())) return []
  const lista: InfoBackup[] = []
  for (const nome of await readdir(pastaBackups())) {
    try {
      const info = JSON.parse(await readFile(join(pastaBackups(), nome, 'backup.json'), 'utf8')) as InfoBackup
      lista.push({ ...info, nome })
    } catch {
      /* pasta que não é backup */
    }
  }
  return lista.sort((a, b) => b.nome.localeCompare(a.nome))
}

async function limparAntigos() {
  const lista = await listarBackups()
  for (const b of lista.slice(MANTER)) await rm(join(pastaBackups(), b.nome), { recursive: true, force: true })
}

/** Backup automático: no máximo um por dia. */
export async function backupDiario(): Promise<void> {
  try {
    const hoje = carimbo().slice(0, 10)
    const lista = await listarBackups()
    if (lista.some((b) => b.nome.startsWith(hoje))) return
    if (!ARQUIVOS.some((a) => existsSync(dados(a)))) return
    await fazerBackup(true)
  } catch {
    /* backup automático nunca impede o programa de abrir */
  }
}

export async function restaurar(nome: string): Promise<string[]> {
  const origem = join(pastaBackups(), nome)
  if (!existsSync(join(origem, 'backup.json'))) throw new Error('Backup não encontrado.')
  await fazerBackup(false, '_antes-de-restaurar') // guarda o estado atual antes de restaurar
  const restaurados: string[] = []
  for (const a of ARQUIVOS) {
    if (!existsSync(join(origem, a))) continue
    const tmp = dados(a) + '.restaurando'
    await copyFile(join(origem, a), tmp)
    await rename(tmp, dados(a))
    restaurados.push(a)
  }
  return restaurados
}

export async function abrirPasta(): Promise<void> {
  await mkdir(pastaBackups(), { recursive: true })
  await shell.openPath(pastaBackups())
}

/** Salva um arquivo escolhido pelo usuário (backup da nuvem, exportações). */
export async function salvarArquivo(janela: BrowserWindow | null, nomeSugerido: string, conteudo: string): Promise<string | null> {
  const r = await dialog.showSaveDialog(janela!, {
    title: 'Salvar backup',
    defaultPath: join(pastaBackups(), nomeSugerido),
    filters: [{ name: 'Backup (JSON)', extensions: ['json'] }]
  })
  if (r.canceled || !r.filePath) return null
  await mkdir(pastaBackups(), { recursive: true }).catch(() => undefined)
  await writeFile(r.filePath, conteudo, 'utf8')
  return r.filePath
}

// ---------------------------------------------------------------- aparência (cache para a tela de login)
export interface Aparencia {
  empresaId: string
  empresaNome: string
  fundo: string | null
  logo: string | null
  atualizadoEm: string
}

export async function lerAparencia(): Promise<Aparencia | null> {
  try {
    return JSON.parse(await readFile(dados('aparencia.json'), 'utf8')) as Aparencia
  } catch {
    return null
  }
}

export async function salvarAparencia(a: Aparencia | null): Promise<void> {
  if (!a) {
    await rm(dados('aparencia.json'), { force: true })
    return
  }
  const tmp = dados('aparencia.json') + '.tmp'
  await writeFile(tmp, JSON.stringify(a), 'utf8')
  await rename(tmp, dados('aparencia.json'))
}
