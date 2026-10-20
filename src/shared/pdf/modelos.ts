// Catálogo dos modelos de pedido em PDF que o programa sabe ler.
// Cada PDF novo estudado vira um leitor (src/shared/pdf/<leitor>.ts) e uma
// entrada aqui, que aparece na aba "Modelos de Pedido".
// Os exemplos são ilustrativos (mostram a disposição das colunas).

export interface ColunaModelo {
  nome: string // como aparece no PDF
  uso?: string // para que o programa usa (vazio = coluna ignorada)
}

export interface ModeloPedido {
  id: string
  nome: string
  emitidoPor: string // sistema/relatório que gera o PDF
  reconhece: string // como o programa identifica este modelo
  descricao: string
  unidade: string // em que unidade vêm quantidade e preço
  conversao: string // conversão que normalmente se usa
  cabecalho: { campo: string; onde: string }[] // dados do pedido
  colunas: ColunaModelo[] // colunas da tabela de itens, na ordem do PDF
  exemplo: string[][] // linhas de exemplo (mesma ordem das colunas)
  observacoes: string[]
  adicionadoEm: string
}

export const MODELOS: ModeloPedido[] = [
  {
    id: 'bluesoft',
    nome: 'Modelo Supermercado DB',
    emitidoPor: 'Bluesoft ERP · Pedido de compra',
    reconhece: 'Texto "Pedido:" seguido do número e da loja entre parênteses, e tabela com a coluna "GTIN".',
    descricao: 'Pedido de compra da rede Supermercados DB. Um PDF traz um pedido por loja, cada um com uma ou mais páginas.',
    unidade: 'Quantidade em embalagens (caixas) e valor unitário por unidade, já com ST.',
    conversao: 'Normalmente "Pedido em caixa": o valor da unidade é multiplicado pela quantidade da caixa do ERP.',
    cabecalho: [
      { campo: 'Nº do pedido de compra', onde: '"Pedido: 153331- 017"' },
      { campo: 'Cliente (CNPJ da loja)', onde: 'Linha da loja: "17 - HIPER BOA VISTA … 22.991.939/0017-65"' },
      { campo: 'Fornecedor e CNPJ', onde: '"Fornecedor:" e "CNPJ:"' },
      { campo: 'Datas', onde: '"Emitido em" e "Entrega Prevista"' },
      { campo: 'Total para conferência', onde: 'Quadro "Totais" (Valor de Mercadorias e Total)' }
    ],
    colunas: [
      { nome: 'Código', uso: 'código do cliente' },
      { nome: 'GTIN', uso: 'código de barras (busca no ERP)' },
      { nome: 'Descrição', uso: 'descrição (conferência)' },
      { nome: 'Ref.' },
      { nome: 'Embalagem', uso: 'embalagem do fornecedor' },
      { nome: 'Quant.', uso: 'quantidade' },
      { nome: 'Custo Base' },
      { nome: 'Desc. %' },
      { nome: 'Frete' },
      { nome: 'ICMS-ST %' },
      { nome: 'ICMS-ST' },
      { nome: 'IPI %' },
      { nome: 'IPI' },
      { nome: 'ICMS %' },
      { nome: 'Valor Unit.', uso: 'valor unitário' },
      { nome: 'Total', uso: 'total (conferência)' }
    ],
    exemplo: [
      ['70123', '7898717040944', 'ACUCAR DEMERARA VIVA VITTA 450G', '', 'CX 15.0', '1', '118,65', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '20,00%', '7,91', '7,91'],
      ['70130', '7898717042351', 'BOLACHA FAZENDEIRO MOTOR 300G PT', '', 'CX 20.0', '10', '57,40', '0,00', '0,00', '20,00%', '0,68', '0,00', '0,00', '20,00% - Red. 65,00%', '2,87', '28,70']
    ],
    observacoes: [
      'Confere a soma dos itens com o "Valor de Mercadorias" do PDF e avisa se faltar item.',
      'Avisa se o fornecedor do PDF não for o da conexão escolhida e sugere a conexão certa.'
    ],
    adicionadoEm: 'outubro de 2026'
  },
  {
    id: 'pedido210',
    nome: 'Modelo Baratão da Carne',
    emitidoPor: 'Rotina 210 · Emitir Pedido de Compra',
    reconhece: 'Título "210 - Emitir Pedido de Compra" e "Número do Pedido:" no topo de cada página.',
    descricao: 'Pedido de compra emitido pela rede (Rufino Comércio e Ind. de Alimentos). Um PDF traz um pedido por filial; os itens podem continuar na página seguinte.',
    unidade: 'Pedido "emitido na unidade de venda": quantidade em unidades e preço por unidade.',
    conversao: 'Se o ERP vende o produto em caixa, use "Pedido em unidade" (ex.: 48 UN de caixa com 12 viram 4 caixas).',
    cabecalho: [
      { campo: 'Nº do pedido de compra', onde: '"Número do Pedido: 655662"' },
      { campo: 'Filial', onde: '"Filial: 10" e o endereço da Empresa' },
      { campo: 'Cliente (CNPJ da filial)', onde: '"Empresa: … CNPJ/CPF: 06710613001090"' },
      { campo: 'Fornecedor e CNPJ', onde: '"Fornecedor: … CNPJ/CPF: 50.416.307/0001-46"' },
      { campo: 'Datas', onde: '"Data" e a linha Faturamento / Embarque / Entrega' },
      { campo: 'Total para conferência', onde: 'Rodapé: "16 Itens", "Tot P.Compra" e "Total Ped"' }
    ],
    colunas: [
      { nome: 'Código', uso: 'código do cliente' },
      { nome: 'Descrição', uso: 'descrição (conferência)' },
      { nome: 'QT.CX', uso: 'unidades na caixa' },
      { nome: 'Cód Fab' },
      { nome: 'Emb', uso: 'embalagem' },
      { nome: 'Un.' },
      { nome: 'Codigo barras', uso: 'código de barras (busca no ERP)' },
      { nome: 'Qt.Pedida', uso: 'quantidade (unidades)' },
      { nome: 'Qt. Entreg.' },
      { nome: 'P.Compra', uso: 'preço da unidade' },
      { nome: '% Desc.' },
      { nome: '% Suf' },
      { nome: 'Total Produto', uso: 'total (conferência)' },
      { nome: 'Preço unidade', uso: 'valor unitário' },
      { nome: '% Icms', uso: 'alíquota (informativo)' },
      { nome: 'Frete Conhec' },
      { nome: 'Ncm' },
      { nome: 'Guia' },
      { nome: 'Reg.Esp.' },
      { nome: 'CEST' }
    ],
    exemplo: [
      ['113772', 'BISC.INF.LARANJA CENOURA PAPAPA', '12', '811', '1X60G', 'UN', '7898969895378', '48,00', '0,00', '9,990000', '0,00', '0,00', '479,52', '9,990000', '0,00', '0,00', '19059090', '0,00', '0,0%', '1706201'],
      ['123940', 'VINAGRE FRUTA MACA ORGANICO', '12', '971', '1X250ML', 'UN', '630941499559', '24,00', '0,00', '23,650000', '0,00', '0,00', '567,60', '23,650000', '20,00', '0,00', '22090000', '0,00', '0,0%', '0']
    ],
    observacoes: [
      'Confere a quantidade de itens com o "N Itens" do rodapé e a soma com o "Tot P.Compra".',
      'Junta o item que começa no fim de uma página e termina na seguinte.',
      'As páginas de "Previsão Pagamento" são ignoradas.'
    ],
    adicionadoEm: 'outubro de 2026'
  }
]

export const nomeDoModelo = (id?: string) => MODELOS.find((m) => m.id === id)?.nome ?? ''
