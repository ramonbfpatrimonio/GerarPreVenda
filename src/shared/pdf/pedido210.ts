// Leitor do relatório "210 - Emitir Pedido de Compra" (rotina 210, usado por
// redes como a Rufino). Exemplo: pedido para a VALERE DISTRIBUIDORA.
//
// Cada pedido (um por filial) ocupa uma ou mais páginas; os itens podem
// continuar na página seguinte. O pedido vem "EMITIDO NA UNID. DE VENDA":
// Qt.Pedida está em unidades e P.Compra é o preço da unidade.
//
// Colunas da linha do item (da esquerda para a direita):
//   Código | Descrição | QT.CX | Cód Fab | Emb | Un. | Codigo barras |
//   Qt.Pedida | Qt.Entreg. | P.Compra | %Desc | %Suf | Total Produto |
//   Preço unidade | %Icms | Frete Conhec | Ncm | Guia | %Reg.Esp. | CEST

import type { ItemPdf, PedidoPdf, ResultadoPdf } from '../tipos'
import { arred, numeroBR, soDigitos } from '../numeros'
import { agruparLinhas, type Celula, type PaginaPdf } from './bluesoft'

type Linha = { y: number; celulas: Celula[] }

const RE_CNPJ_SOLTO = /\b\d{14}\b|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/
const RE_NUM = /^-?[\d.]+,\d+%?$|^-?\d+%?$/
const txt = (l: Linha) => l.celulas.map((c) => c.texto.trim()).join(' ')

/** O PDF é deste layout? */
export function ehPedido210(paginas: PaginaPdf[]): boolean {
  const primeira = paginas[0]?.celulas.map((c) => c.texto).join(' ') ?? ''
  return /Emitir Pedido de Compra/i.test(primeira) && /N[úu]mero do Pedido/i.test(primeira)
}

interface Colunas {
  descricao: number // x onde começa a descrição
  qtcx: number // x do cabeçalho QT.CX (fim da descrição)
  gtin: number // x do cabeçalho "Codigo barras"
}

function colunas(l: Linha): Colunas | null {
  const x = (re: RegExp) => l.celulas.find((c) => re.test(c.texto.trim()))?.x
  const descricao = x(/^Descri/i)
  const qtcx = x(/^QT\.?CX$/i)
  const gtin = x(/^Codigo barras$/i) ?? x(/barras/i)
  if (descricao === undefined || qtcx === undefined || gtin === undefined) return null
  return { descricao, qtcx, gtin }
}

// Posição (x) de cada coluna numérica, em relação ao cabeçalho "Codigo barras".
// Os números são alinhados à direita; cada valor vai para a coluna mais próxima.
const ANCORAS = { qtPedida: 84, qtEntreg: 124, pCompra: 150, desc: 193, suf: 215, total: 272, preco: 301, icms: 338, frete: 369 } as const
type CampoNum = keyof typeof ANCORAS

/** Lê a linha do item. `incompleto` = tem código e código de barras, mas faltam números
 *  (o item quebrou na virada da página e continua na próxima). */
function lerItem(cel: Celula[], col: Colunas, pagina: number): { item: ItemPdf | null; incompleto: boolean } {
  const codigo = cel[0]?.texto.trim() ?? ''
  if (!/^\d+$/.test(codigo) || cel[0].x > col.descricao) return { item: null, incompleto: false }
  // código de barras: 8 a 14 dígitos perto da coluna "Codigo barras"
  const iG = cel.findIndex((c) => Math.abs(c.x - col.gtin) < 25 && /^\d{8,14}$/.test(c.texto.trim()))
  if (iG < 0) return { item: null, incompleto: false }
  const gtin = cel[iG].texto.trim()

  const margem = 4
  const descricao = cel
    .filter((c, i) => i > 0 && c.x < col.qtcx - margem && c.x >= col.descricao - 10)
    .map((c) => c.texto.trim())
    .join(' ')
  const meio = cel.filter((c) => c.x >= col.qtcx - margem && c.x < col.gtin - 8)
  const qtcx = numeroBR(meio.find((c) => /^\d+$/.test(c.texto.trim()) && c.x < col.qtcx + 15)?.texto ?? '0')
  const emb = meio.find((c) => /^\d+X/i.test(c.texto.trim()))?.texto.trim() ?? ''
  const un = [...meio].reverse().find((c) => /^[A-Z]{1,3}$/.test(c.texto.trim()))?.texto.trim() ?? ''

  const v: Partial<Record<CampoNum, string>> = {}
  for (const c of cel) {
    const t = c.texto.trim()
    if (c.x <= cel[iG].x + 30 || !RE_NUM.test(t)) continue
    const rel = c.x - col.gtin
    let melhor: CampoNum | null = null
    let dist = 16
    for (const k of Object.keys(ANCORAS) as CampoNum[]) {
      const d = Math.abs(rel - ANCORAS[k])
      if (d < dist) {
        dist = d
        melhor = k
      }
    }
    if (melhor && v[melhor] === undefined) v[melhor] = t
  }
  if (v.qtPedida === undefined || (v.pCompra === undefined && v.preco === undefined) || v.total === undefined) {
    return { item: null, incompleto: true }
  }
  const quantidade = numeroBR(v.qtPedida)
  const precoUnidade = numeroBR(v.preco ?? v.pCompra ?? '0') || numeroBR(v.pCompra ?? '0')

  return {
    incompleto: false,
    item: {
      linha: 0,
      pagina,
      codigoInterno: codigo,
      gtin,
      descricao,
      ref: emb,
      embalagem: `${un || 'UN'}${qtcx ? ` · caixa ${qtcx}` : ''}${emb ? ` · ${emb}` : ''}`,
      fatorEmbalagem: qtcx,
      quantidade, // em unidades
      custoBase: arred(precoUnidade * (qtcx || 1), 4), // preço da caixa
      descontoPerc: numeroBR(v.desc ?? '0'),
      icmsStPerc: 0,
      icmsSt: 0,
      icmsPerc: v.icms ? `${v.icms}%` : '',
      valorUnitario: precoUnidade,
      total: numeroBR(v.total)
    }
  }
}

function novo(numero: string): PedidoPdf {
  return {
    numero,
    numeroLimpo: numero,
    comprador: '',
    loja: '',
    cnpjLoja: '',
    cnpjFornecedor: '',
    fornecedor: '',
    emitidoEm: '',
    entregaPrevista: '',
    paginas: [],
    itens: [],
    totalPdf: null,
    mercadoriasPdf: null,
    avisos: []
  }
}

export function lerPedidos210(paginas: PaginaPdf[], arquivo = ''): ResultadoPdf {
  const pedidos = new Map<string, PedidoPdf>()
  const esperado = new Map<string, number>() // "16 Itens" do rodapé
  const avisos: string[] = []
  let pendente: Linha | null = null // item incompleto (quebra de linha ou de página)

  for (const pg of paginas) {
    const linhas = agruparLinhas(pg.celulas)
    let pedido: PedidoPdf | null = null
    let col: Colunas | null = null
    let filial = ''
    let bloco: 'empresa' | 'fornecedor' | '' = ''

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i]
      const t = txt(l)

      const mPed = /N[úu]mero do Pedido:\s*(\d+)/i.exec(t)
      if (mPed) {
        pedido = pedidos.get(mPed[1]) ?? novo(mPed[1])
        pedidos.set(mPed[1], pedido)
        if (!pedido.paginas.includes(pg.numero)) pedido.paginas.push(pg.numero)
        filial = /Filial:\s*(\d+)/i.exec(t)?.[1] ?? ''
        const data = /Data\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1]
        if (data && !pedido.emitidoEm) pedido.emitidoEm = data
        continue
      }
      if (!pedido) continue

      if (/^Empresa:/i.test(t) || l.celulas.some((c) => /^Empresa:$/i.test(c.texto.trim()))) {
        bloco = 'empresa'
        if (!pedido.cnpjLoja) {
          const cnpj = RE_CNPJ_SOLTO.exec(t)?.[0]
          if (cnpj) pedido.cnpjLoja = soDigitos(cnpj)
          pedido.comprador = l.celulas.find((c) => !/:$/.test(c.texto.trim()) && /[A-Z]{3}/.test(c.texto) && !/^\d/.test(c.texto.trim()))?.texto.trim() ?? ''
        }
        continue
      }
      if (/Fornecedor:/i.test(t)) {
        bloco = 'fornecedor'
        if (!pedido.fornecedor) {
          const nome = l.celulas.find((c) => c.x > 60 && c.x < 320)
          pedido.fornecedor = nome?.texto.trim() ?? ''
          const cnpj = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.exec(t)?.[0]
          if (cnpj) pedido.cnpjFornecedor = soDigitos(cnpj)
        }
        continue
      }
      if (bloco === 'empresa' && /^Endere/i.test(t) && !pedido.loja) {
        const end = l.celulas.find((c) => c.x > 60 && c.x < 280)?.texto.trim() ?? ''
        pedido.loja = `Filial ${filial}${end ? ` - ${end}` : ''}`
        continue
      }
      if (/Faturamento/i.test(t) && /Entrega/i.test(t)) {
        // datas na linha seguinte: Faturamento, Embarque, Entrega
        const prox = linhas.slice(i + 1, i + 4).find((x) => /\d{2}\/\d{2}\/\d{4}/.test(txt(x)))
        const datas = prox ? txt(prox).match(/\d{2}\/\d{2}\/\d{4}/g) ?? [] : []
        if (datas.length && !pedido.entregaPrevista) pedido.entregaPrevista = datas[datas.length - 1]
        continue
      }
      if (/Codigo barras/i.test(t) && /Qt\.?\s*Pedida/i.test(t)) {
        col = colunas(l)
        continue
      }
      const mItens = /^(\d+)\s+Itens\b/i.exec(t)
      if (mItens) {
        if (pendente) pedido.avisos.push(`Página ${pg.numero}: item não reconhecido — "${txt(pendente).slice(0, 80)}"`)
        pendente = null
        esperado.set(pedido.numero, Number(mItens[1]))
        const tot = /Tot P\.Compra:\s*([\d.]+,\d{2})/i.exec(t)?.[1]
        if (tot) pedido.mercadoriasPdf = numeroBR(tot)
        col = null
        continue
      }
      const mTotal = /Total Ped:\s*([\d.]+,\d{2})/i.exec(t)
      if (mTotal) {
        pedido.totalPdf = numeroBR(mTotal[1])
        continue
      }
      if (!col) continue

      const comecaComCodigo = /^\d{4,}$/.test(l.celulas[0]?.texto.trim() ?? '') && l.celulas[0].x < col.descricao
      if (pendente && !comecaComCodigo) {
        // continuação: descrição que quebrou de linha, ou item que virou a página
        const r = lerItem([...pendente.celulas, ...l.celulas], col, pg.numero)
        if (r.item) {
          pedido.itens.push(r.item)
          pendente = null
        } else if (r.incompleto) pendente = { y: l.y, celulas: [...pendente.celulas, ...l.celulas] }
        continue
      }
      const r = lerItem(l.celulas, col, pg.numero)
      if (r.item) {
        pedido.itens.push(r.item)
        pendente = null
      } else if (comecaComCodigo) {
        if (pendente) pedido.avisos.push(`Página ${pg.numero}: item não reconhecido — "${txt(pendente).slice(0, 80)}"`)
        pendente = l
      }
    }
  }

  const lista = [...pedidos.values()]
  for (const p of lista) {
    p.itens.forEach((it, i) => (it.linha = i + 1))
    if (!p.cnpjLoja) p.avisos.push('CNPJ do cliente (Empresa) não encontrado no PDF.')
    if (p.itens.length === 0) p.avisos.push('Nenhum item encontrado neste pedido.')
    const n = esperado.get(p.numero)
    if (n !== undefined && n !== p.itens.length) {
      p.avisos.push(`O PDF diz ${n} itens, mas foram lidos ${p.itens.length}. Confira o pedido.`)
    }
    if (p.mercadoriasPdf !== null) {
      const soma = arred(p.itens.reduce((s, it) => s + it.total, 0))
      if (Math.abs(soma - p.mercadoriasPdf) > 0.05) {
        p.avisos.push(`A soma dos itens lidos (R$ ${soma.toFixed(2)}) não bate com o "Tot P.Compra" do PDF (R$ ${p.mercadoriasPdf.toFixed(2)}).`)
      }
    }
    if (p.totalPdf === null) p.totalPdf = p.mercadoriasPdf
  }
  if (!lista.length) avisos.push('Nenhum pedido encontrado no layout "210 - Emitir Pedido de Compra".')
  return { arquivo, pedidos: lista, avisos }
}
