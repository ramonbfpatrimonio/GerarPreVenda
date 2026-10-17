import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from './api'

async function chamar<T>(canal: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(canal, ...args)) as { ok: true; dados: T } | { ok: false; erro: string }
  if (!r.ok) throw new Error(r.erro)
  return r.dados
}

const api: Api = {
  conexoes: {
    listar: () => chamar('conexoes:listar'),
    salvar: (perfil, senha) => chamar('conexoes:salvar', perfil, senha),
    excluir: (id) => chamar('conexoes:excluir', id),
    testar: (perfil, senha) => chamar('conexoes:testar', perfil, senha),
    nativoDisponivel: () => chamar('conexoes:nativoDisponivel'),
    exportar: (ids, senha) => chamar('conexoes:exportar', ids, senha),
    importar: (senha) => chamar('conexoes:importar', senha)
  },
  pdf: {
    abrir: () => chamar('pdf:abrir'),
    lerArquivo: (arquivo) => chamar('pdf:ler', webUtils.getPathForFile(arquivo))
  },
  erp: {
    produtos: (id, codigos) => chamar('erp:produtos', id, codigos),
    cliente: (id, cnpj) => chamar('erp:cliente', id, cnpj),
    verificarPedido: (id, cliente, pedido) => chamar('erp:verificarPedido', id, cliente, pedido),
    limitePedido: (id) => chamar('erp:limitePedido', id),
    status: (id) => chamar('erp:status', id),
    gerar: (id, envio) => chamar('erp:gerar', id, envio)
  },
  sistema: {
    estacao: () => chamar('sistema:estacao')
  },
  atualizacao: {
    versao: () => ipcRenderer.invoke('atualizacao:versao'),
    instalar: () => ipcRenderer.invoke('atualizacao:instalar'),
    verificar: () => ipcRenderer.invoke('atualizacao:verificar'),
    aoMudar: (fn) => {
      const ouvinte = (_: unknown, estado: Parameters<typeof fn>[0]) => fn(estado)
      ipcRenderer.on('atualizacao:estado', ouvinte)
      return () => ipcRenderer.removeListener('atualizacao:estado', ouvinte)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
