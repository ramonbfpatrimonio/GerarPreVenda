import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import type { PedidoEnvio, PerfilConexao } from '@shared/tipos'
import * as conexoes from './conexoes'
import * as db from './db'
import * as erp from './erp'
import { lerPdf } from './pdf'

type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: string }

/** Registra um handler que devolve {ok, dados|erro} (mensagens limpas na tela). */
function handle<A extends unknown[], T>(canal: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(canal, async (_e, ...args: unknown[]): Promise<Resposta<T>> => {
    try {
      return { ok: true, dados: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, erro: db.mensagemAmigavel((e as Error)?.message ?? String(e)) }
    }
  })
}

async function perfilESenha(id: string) {
  return conexoes.obterPerfil(id)
}

export function registrarIpc(janela: () => BrowserWindow | null) {
  // ---------------- conexões ----------------
  handle('conexoes:listar', () => conexoes.listarPerfis())
  handle('conexoes:salvar', async (perfil: PerfilConexao, senha?: string) => {
    const salvo = await conexoes.salvarPerfil(perfil, senha)
    await db.fecharPool(salvo.id)
    return salvo
  })
  handle('conexoes:excluir', async (id: string) => {
    await db.fecharPool(id)
    await conexoes.excluirPerfil(id)
  })
  handle('conexoes:testar', async (perfil: PerfilConexao, senha?: string) => {
    return db.testar(perfil, await conexoes.senhaParaTeste(perfil, senha))
  })
  handle('conexoes:nativoDisponivel', () => db.nativoDisponivel())
  handle('conexoes:exportar', async (ids: string[], senhaArquivo: string) => {
    const conteudo = await conexoes.exportar(ids, senhaArquivo)
    const r = await dialog.showSaveDialog(janela()!, {
      title: 'Exportar conexões',
      defaultPath: 'conexoes.gpvconn',
      filters: [{ name: 'Conexões Gerar Pré-Venda', extensions: ['gpvconn'] }]
    })
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, conteudo, 'utf8')
    return true
  })
  handle('conexoes:importar', async (senhaArquivo: string) => {
    const r = await dialog.showOpenDialog(janela()!, {
      title: 'Importar conexões',
      properties: ['openFile'],
      filters: [{ name: 'Conexões Gerar Pré-Venda', extensions: ['gpvconn'] }]
    })
    if (r.canceled || !r.filePaths[0]) return 0
    return conexoes.importar(await readFile(r.filePaths[0], 'utf8'), senhaArquivo)
  })

  // ---------------- PDF ----------------
  handle('pdf:abrir', async () => {
    const r = await dialog.showOpenDialog(janela()!, {
      title: 'Abrir pedido de compra (PDF)',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return lerPdf(r.filePaths[0])
  })
  handle('pdf:ler', (caminho: string) => lerPdf(caminho))

  // ---------------- ERP ----------------
  handle('erp:produtos', async (id: string, codigos: string[]) => {
    const { perfil, senha } = await perfilESenha(id)
    return erp.buscarProdutos(perfil, senha, codigos)
  })
  handle('erp:cliente', async (id: string, cnpj: string) => {
    const { perfil, senha } = await perfilESenha(id)
    return erp.buscarCliente(perfil, senha, cnpj)
  })
  handle('erp:verificarPedido', async (id: string, cliente: string, pedido: string) => {
    const { perfil, senha } = await perfilESenha(id)
    return erp.verificarPedido(perfil, senha, cliente, pedido)
  })
  handle('erp:limitePedido', async (id: string) => {
    const { perfil, senha } = await perfilESenha(id)
    return erp.limitePedidoCompra(perfil, senha)
  })
  handle('erp:status', async (id: string) => {
    const { perfil, senha } = await perfilESenha(id)
    const c = await db.obterConexao(perfil, senha)
    await c.pool.request().query('SELECT 1 AS ok')
    return c.driver
  })
  handle('erp:gerar', async (id: string, envio: PedidoEnvio) => {
    const { perfil, senha } = await perfilESenha(id)
    return erp.gerarPreVenda(perfil, senha, envio)
  })
  handle('sistema:estacao', () => erp.estacao())
}
