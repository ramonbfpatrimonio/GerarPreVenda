import type {
  ClienteErp, PedidoEnvio, PerfilConexao, PreVendaExistente, ProdutoErp, ResultadoGeracao, ResultadoPdf, ResultadoTeste
} from '../shared/tipos'

export type EstadoAtualizacao =
  | { tipo: 'verificando' }
  | { tipo: 'disponivel'; versao: string }
  | { tipo: 'baixando'; percentual: number }
  | { tipo: 'pronta'; versao: string }
  | { tipo: 'atualizado' }
  | { tipo: 'erro'; mensagem: string }

export interface Api {
  conexoes: {
    listar(): Promise<PerfilConexao[]>
    salvar(perfil: PerfilConexao, senha?: string): Promise<PerfilConexao>
    excluir(id: string): Promise<void>
    testar(perfil: PerfilConexao, senha?: string): Promise<ResultadoTeste>
    nativoDisponivel(): Promise<boolean>
    exportar(ids: string[], senhaArquivo: string): Promise<boolean>
    importar(senhaArquivo: string): Promise<number>
  }
  pdf: {
    abrir(): Promise<ResultadoPdf | null>
    lerArquivo(arquivo: File): Promise<ResultadoPdf>
  }
  erp: {
    produtos(conexaoId: string, codigos: string[]): Promise<Record<string, ProdutoErp | null>>
    cliente(conexaoId: string, cnpj: string): Promise<ClienteErp | null>
    verificarPedido(conexaoId: string, clienteCodigo: string, pedido: string): Promise<PreVendaExistente[]>
    limitePedido(conexaoId: string): Promise<number>
    status(conexaoId: string): Promise<string>
    gerar(conexaoId: string, envio: PedidoEnvio): Promise<ResultadoGeracao>
  }
  sistema: {
    estacao(): Promise<string>
  }
  atualizacao: {
    versao(): Promise<string>
    instalar(): Promise<void>
    verificar(): Promise<{ ok: boolean; erro?: string }>
    aoMudar(fn: (estado: EstadoAtualizacao) => void): () => void
  }
}

declare global {
  interface Window {
    api: Api
  }
}
