// Leitor do pedido de compra gerado pelo Bluesoft ERP (Supermercados DB).
//
// Recebe as células de texto de cada página com posição (x, y) já na
// orientação visual e devolve os pedidos encontrados. Um PDF pode ter
// vários pedidos (um por loja), cada um com uma ou mais páginas.
//
// Diferente da planilha, não depende de como o Power Query divide as
// colunas: as colunas fixas (código, GTIN, descrição, ref, embalagem) são
// localizadas pela posição do cabeçalho e os valores numéricos são lidos
// pela ordem em que aparecem na linha.

import type { ItemPdf, PedidoPdf, ResultadoPdf } from '../tipos'
import { arred, numeroBR, soDigitos } from '../numeros'

export interface Celula {
  x: number
  y: number
  texto: string
}

export interface PaginaPdf {
  numero: number
  celulas: Celula[]
}

type Linha = { y: number; celulas: Celula[] }

const RE_CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/
const RE_PEDIDO = /Pedido:\s*([\d][\d\s-]*\d)\s*(?:\((.*?)\))?/i
const RE_EMBAL = /^([A-Z]{1,4})\s+(\d+(?:[.,]\d+)?)$/
const RE_NUM = /^-?[\d.]+,\d+%?$|^-?\d+%?$/

/** Agrupa células com o mesmo y (tolerância em pontos) em linhas ordenadas. */
export function agruparLinhas(celulas: Celula[], tolerancia = 2): Linha[] {
  const ordenadas = celulas
    .filter((c) => c.texto.trim() !== '')
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const linhas: Linha[] = []
  for (const c of ordenadas) {
    const ultima = linhas[linhas.length - 1]
    if (ultima && Math.abs(ultima.y - c.y) <= tolerancia) ultima.celulas.push(c)
    else linhas.push({ y: c.y, celulas: [c] })
  }
  for (const l of linhas) l.celulas.sort((a, b) => a.x - b.x)
  return linhas
}

const textoLinha = (l: Linha) => l.celulas.map((c) => c.texto.trim()).join(' ')

interface Colunas {
  gtin: number
  descricao: number
  ref: number
  embalagem: number
}

function colunasDoCabecalho(l: Linha): Colunas | null {
  const achar = (re: RegExp) => l.celulas.find((c) => re.test(c.texto))?.x
  const gtin = achar(/GTIN/i)
  const descricao = achar(/^Descri/i)
  const ref = achar(/^Ref\b/i)
  const embalagem = achar(/^Embal/i)
  if (gtin === undefined || descricao === undefined || embalagem === undefined) return null
  return { gtin, descricao, ref: ref ?? embalagem, embalagem }
}

function lerItem(l: Linha, col: Colunas, pagina: number): ItemPdf | null {
  const cel = l.celulas
  if (cel.length < 4) return null
  const codigoInterno = cel[0].texto.trim()
  const gtin = soDigitos(cel[1]?.texto ?? '')
  if (!/^\d+$/.test(codigoInterno)) return null
  if (!/^\d{8,14}$/.test(gtin) || (cel[1].texto.trim() !== gtin)) return null

  const margem = 3
  const descricao = cel
    .filter((c) => c.x >= col.descricao - margem && c.x < col.ref - margem)
    .map((c) => c.texto.trim())
    .join(' ')
  const ref = col.ref < col.embalagem
    ? cel
        .filter((c) => c.x >= col.ref - margem && c.x < col.embalagem - margem)
        .map((c) => c.texto.trim())
        .join(' ')
    : ''

  // Da embalagem em diante: "CX 15.0" seguido dos números.
  const resto = cel.filter((c) => c.x >= col.embalagem - margem)
  const tokens = resto.map((c) => c.texto.trim()).join(' ').split(/\s+/).filter(Boolean)

  let embalagem = ''
  let fator = 0
  if (tokens.length >= 2 && /^[A-Z]{1,4}$/.test(tokens[0]) && /^\d+([.,]\d+)?$/.test(tokens[1])) {
    embalagem = `${tokens[0]} ${tokens[1]}`
    fator = Number(tokens[1].replace(',', '.'))
    tokens.splice(0, 2)
  } else {
    const m = RE_EMBAL.exec(tokens[0] ?? '')
    if (m) {
      embalagem = tokens[0]
      fator = Number(m[2].replace(',', '.'))
      tokens.splice(0, 1)
    }
  }

  // ICMS pode vir com redução ("20,00% - Red. 65,00%"): separa esse texto.
  const icmsTexto: string[] = []
  const numeros: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '-' || /^Red\.?$/i.test(t)) {
      icmsTexto.push(t)
      continue
    }
    if (RE_NUM.test(t)) numeros.push(t)
  }
  // Ordem esperada: Quant, Custo Base, Desc(%), Frete, ICMS-ST(%), ICMS-ST,
  // IPI(%), IPI, ICMS(%) [, Red%], Valor unit., Total
  if (numeros.length < 4) return null
  const total = numeroBR(numeros[numeros.length - 1])
  const valorUnitario = numeroBR(numeros[numeros.length - 2])
  const quantidade = numeroBR(numeros[0])
  const custoBase = numeroBR(numeros[1])
  const descontoPerc = numeroBR(numeros[2] ?? '0')
  const icmsStPerc = numeroBR(numeros[4] ?? '0')
  const icmsSt = numeroBR(numeros[5] ?? '0')
  const percentuaisIcms = numeros.slice(8, numeros.length - 2)
  const icmsPerc = percentuaisIcms.length > 1
    ? `${percentuaisIcms[0]} - Red. ${percentuaisIcms.slice(1).join(' ')}`
    : percentuaisIcms[0] ?? ''

  return {
    linha: 0,
    pagina,
    codigoInterno,
    gtin,
    descricao,
    ref,
    embalagem,
    fatorEmbalagem: fator,
    quantidade,
    custoBase,
    descontoPerc,
    icmsStPerc,
    icmsSt,
    icmsPerc,
    valorUnitario,
    total
  }
}

function pedidoVazio(numero: string, comprador: string): PedidoPdf {
  return {
    numero,
    numeroLimpo: numero.replace(/\s+/g, ''),
    comprador,
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

export function lerPedidosBluesoft(paginas: PaginaPdf[], arquivo = ''): ResultadoPdf {
  const pedidos = new Map<string, PedidoPdf>()
  const avisos: string[] = []

  for (const pg of paginas) {
    const linhas = agruparLinhas(pg.celulas)
    let pedido: PedidoPdf | null = null
    let colunas: Colunas | null = null
    let esperandoTotais = false
    let esperandoEntrega = false

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i]
      const txt = textoLinha(l)

      const mPed = RE_PEDIDO.exec(txt)
      if (mPed && !pedido) {
        // Formato igual ao da planilha: mantém dígitos, hífen e espaço ("153331- 017")
        const numero = mPed[1].trim()
        const comprador = (mPed[2] ?? '').trim()
        pedido = pedidos.get(numero) ?? pedidoVazio(numero, comprador)
        pedidos.set(numero, pedido)
        if (!pedido.paginas.includes(pg.numero)) pedido.paginas.push(pg.numero)
        continue
      }
      if (!pedido) continue

      const mEmit = /Emitido em (\d{2}\/\d{2}\/\d{4})/.exec(txt)
      if (mEmit && !pedido.emitidoEm) pedido.emitidoEm = mEmit[1]

      // Linha da loja: "17 SUPERMERCADOS DB LTDA 17 - HIPER BOA VISTA 22.991.939/0017-65 ..."
      if (!pedido.cnpjLoja && /^\d+$/.test(l.celulas[0]?.texto.trim() ?? '') && RE_CNPJ.test(txt)) {
        pedido.cnpjLoja = soDigitos(RE_CNPJ.exec(txt)![0])
        const nomeAbrev = l.celulas.find((c) => /^\d+\s+-\s+/.test(c.texto.trim()))
        if (nomeAbrev) pedido.loja = nomeAbrev.texto.trim()
        continue
      }
      if (/^Fornecedor:/i.test(txt) && !pedido.fornecedor) {
        pedido.fornecedor = l.celulas[1]?.texto.trim() ?? ''
        continue
      }
      if (/^CNPJ:/i.test(txt) && !pedido.cnpjFornecedor) {
        const m = RE_CNPJ.exec(txt)
        if (m) pedido.cnpjFornecedor = soDigitos(m[0])
        continue
      }

      if (/GTIN/i.test(txt) && /Descri/i.test(txt)) {
        colunas = colunasDoCabecalho(l)
        continue
      }

      if (/^Totais\b/i.test(txt)) {
        esperandoTotais = true
        continue
      }
      if (esperandoTotais) {
        const nums = l.celulas.map((c) => c.texto.trim()).filter((t) => /^[\d.]+,\d{2}$/.test(t))
        if (nums.length >= 5) {
          pedido.totalPdf = numeroBR(nums[nums.length - 1])
          pedido.mercadoriasPdf = numeroBR(nums[0])
          esperandoTotais = false
        }
        continue
      }

      if (/Entrega Prevista/i.test(txt)) {
        esperandoEntrega = true
        continue
      }
      if (esperandoEntrega) {
        const datas = txt.match(/\d{2}\/\d{2}\/\d{4}/g)
        if (datas) {
          pedido.entregaPrevista = datas[0]
          esperandoEntrega = false
        }
        continue
      }

      if (colunas) {
        const item = lerItem(l, colunas, pg.numero)
        if (item) {
          pedido.itens.push(item)
        } else if (/^\d{5,}\s+\d{8,14}\b/.test(txt)) {
          pedido.avisos.push(`Página ${pg.numero}: linha não reconhecida — "${txt.slice(0, 90)}"`)
        }
      }
    }
    if (!pedido && linhasComConteudo(linhas)) {
      avisos.push(`Página ${pg.numero}: nenhum número de pedido encontrado.`)
    }
  }

  const lista = [...pedidos.values()]
  for (const p of lista) {
    p.itens.forEach((it, i) => (it.linha = i + 1))
    if (!p.cnpjLoja) p.avisos.push('CNPJ da loja não encontrado no PDF.')
    if (p.itens.length === 0) p.avisos.push('Nenhum item encontrado neste pedido.')
    // Conferência: soma de Quant × Custo Base deve bater com "Valor de Mercadorias"
    // (valor exato); a soma dos totais por linha pode diferir alguns centavos
    // porque o PDF arredonda cada linha.
    if (p.mercadoriasPdf !== null) {
      const mercadorias = arred(p.itens.reduce((s, it) => s + arred(it.quantidade * it.custoBase), 0))
      if (Math.abs(mercadorias - p.mercadoriasPdf) > 0.02) {
        p.avisos.push(
          `A soma dos itens lidos (R$ ${mercadorias.toFixed(2)}) não bate com o "Valor de Mercadorias" do PDF (R$ ${p.mercadoriasPdf.toFixed(2)}). Algum item pode não ter sido lido.`
        )
      }
    } else if (p.itens.length) {
      p.avisos.push('Quadro de totais não encontrado: não foi possível conferir se todos os itens foram lidos.')
    }
  }
  return { arquivo, pedidos: lista, avisos }
}

function linhasComConteudo(linhas: Linha[]): boolean {
  return linhas.some((l) => textoLinha(l).length > 3)
}
