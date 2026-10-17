// Tipos compartilhados entre o processo principal (banco/PDF) e a interface.

// ---------------------------------------------------------------------------
// Conexões
// ---------------------------------------------------------------------------

export type Autenticacao = 'sql' | 'windows'
export type DriverSql = 'auto' | 'tedious' | 'msnodesqlv8'

/** Regras que na planilha eram fixas no código e agora variam por conexão. */
export interface RegrasConexao {
  equipe: string // Prevendas.Equipe  (planilha: '1')
  vendedor: string // Prevendas.Vendedor (planilha: '001')
  setorPadrao: string // usado quando o cliente não tem VendedorX (planilha: '001')
  setorPelasColunasVendedor: boolean // busca o setor em Clientes.Vendedor1..5
  digitosCodigoProduto: number // planilha: 6 (zeros à esquerda)
  digitosSetor: number // planilha: 3
  cstsComST: string[] // planilha: ['10', '70']
  registrarEvento: boolean // grava em dbo.EventosSistema
  tipoEvento: string // planilha: 'P'
}

export const REGRAS_PADRAO: RegrasConexao = {
  equipe: '1',
  vendedor: '001',
  setorPadrao: '001',
  setorPelasColunasVendedor: true,
  digitosCodigoProduto: 6,
  digitosSetor: 3,
  cstsComST: ['10', '70'],
  registrarEvento: true,
  tipoEvento: 'P'
}

/** Perfil de conexão como a interface enxerga (nunca contém a senha). */
export interface PerfilConexao {
  id: string
  cliente: string // ex.: "Hage"
  nome: string // ex.: "COMERCIO"
  cor: string // cor de identificação na barra superior
  servidor: string // ex.: "THIAGO-DELL", "localhost", "192.168.0.10"
  instancia: string // ex.: "SQLEXPRESS" (vazio = instância padrão)
  porta: number | null // vazio = 1433 ou descoberta pela instância
  autenticacao: Autenticacao
  usuario: string
  temSenha: boolean
  banco: string
  driver: DriverSql
  criptografar: boolean
  cnpjsEmpresa: string[] // CNPJs da empresa dona do banco (alerta se o PDF for de outro fornecedor)
  regras: RegrasConexao
  atualizadoEm: string
}

export interface DiagnosticoItem {
  ok: boolean
  aviso?: boolean
  titulo: string
  detalhe?: string
}

export interface ResultadoTeste {
  ok: boolean
  driverUsado?: string
  versao?: string
  bancos?: string[]
  itens: DiagnosticoItem[]
  erro?: string
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export interface ItemPdf {
  linha: number // ordem no pedido (1..n)
  pagina: number
  codigoInterno: string // código do cliente (Bluesoft)
  gtin: string
  descricao: string
  ref: string // referência do fornecedor (quando o comprador informa)
  embalagem: string // ex.: "CX 15.0"
  fatorEmbalagem: number // ex.: 15
  quantidade: number // em embalagens (caixas)
  custoBase: number // preço da embalagem
  descontoPerc: number
  icmsStPerc: number
  icmsSt: number
  icmsPerc: string // texto, pode ter redução: "20,00% - Red. 65,00%"
  valorUnitario: number // por unidade, já com ST
  total: number
}

export interface PedidoPdf {
  numero: string // formato igual ao da planilha: "153331- 017"
  numeroLimpo: string // "153331-017"
  comprador: string // razão social do cliente (ex.: SUPERMERCADOS DB LTDA)
  loja: string // ex.: "17 - HIPER BOA VISTA"
  cnpjLoja: string // só dígitos, 14
  cnpjFornecedor: string // só dígitos
  fornecedor: string
  emitidoEm: string
  entregaPrevista: string
  paginas: number[]
  itens: ItemPdf[]
  totalPdf: number | null // "Total" do quadro Totais
  mercadoriasPdf: number | null // "Valor de Mercadorias" do quadro Totais
  avisos: string[]
}

export interface ResultadoPdf {
  arquivo: string
  pedidos: PedidoPdf[]
  avisos: string[]
}

// ---------------------------------------------------------------------------
// ERP
// ---------------------------------------------------------------------------

export interface ProdutoErp {
  codigo: string
  codBarras: string
  descricao: string
  unid: string // G (UNID VENDA)
  unidades: number // H
  qtUndFor: number // I (UND FORNEC)
  precoVenda: number
  sitTrib: string
  aliqIcmsN: number
  aliqIcmsF: number
  percAgrega: number
  percRed: number
}

export interface ClienteErp {
  codigo: string
  nome: string
  setor: string
}

export interface PreVendaExistente {
  ano: string
  numero: string
  data: string
}

export type FiltroST = 'TODOS' | 'ST' | 'SEM_ST'

export interface ItemEnvio {
  codigo: string
  quantidade: number // B
  quantidadeUnid: number // C
  preco: number // D
}

export interface PedidoEnvio {
  cnpj: string
  pedidoCompra: string
  filtro: FiltroST
  itens: ItemEnvio[]
  usuario: string
}

export interface ResultadoGeracao {
  ano: string
  numero: string
  clienteCodigo: string
  clienteNome: string
  setor: string
  qtdItens: number
  total: number
  totalComST: number
}
