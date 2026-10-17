// Regras de negócio portadas da planilha GERAR_PRE_VENDA.xlsm.
//
// Diferença principal: a planilha alterava as células no lugar (e por isso
// conversões podiam ser aplicadas duas vezes). Aqui tudo é recalculado a partir
// dos valores originais do PDF, de acordo com o modo escolhido.
//
// Colunas da planilha:  B = quantidade, C = quantidade em unidades soltas,
// D = valor unitário, G = unidade de venda, H = unidades, I = unidade do fornecedor.

import type { FiltroST, ProdutoErp, RegrasConexao } from './tipos'
import { arred } from './numeros'

export type ModoConversao = 'ORIGINAL' | 'CAIXA' | 'UNIDADE'

export interface LinhaPedido {
  id: string
  codigoLido: string // coluna A (GTIN ou código)
  quantidadeOriginal: number // B vinda do PDF/colagem
  precoOriginal: number // D vinda do PDF/colagem
  descricaoPdf?: string
  totalPdf?: number
  /** undefined = ainda não buscado; null = não localizado no ERP */
  produto?: ProdutoErp | null
  /** Edições manuais na tabela (têm prioridade sobre o modo de conversão). */
  manual?: { quantidade?: number; quantidadeUnid?: number; preco?: number }
}

export interface OpcoesCalculo {
  modo: ModoConversao
  abaterST: boolean
  quantidadeInteira: boolean
  regras: Pick<RegrasConexao, 'cstsComST'>
}

export type StatusLinha = 'pendente' | 'nao-encontrado' | 'sem-quantidade' | 'sem-preco' | 'ok'

export interface LinhaCalculada {
  quantidade: number // B
  quantidadeUnid: number // C
  preco: number // D
  convertidaQtd: boolean
  convertidaPreco: boolean
  stAbatido: boolean
  temST: boolean
  icmsf: number // ICMS-ST do item (vai para PrevendasItens.ICMSF)
  total: number // (B + C/I) × D
  totalComST: number
  status: StatusLinha
  aviso?: string
}

const UNID_PRECO = ['CX', 'FD', 'PT', 'KG']
const UNID_DIVISAO = ['CX', 'FD', 'PC', 'PT']

/** Mod do VBA: arredonda os operandos para inteiro antes do resto. */
function modVba(a: number, b: number): number {
  const ia = Math.round(a)
  const ib = Math.round(b)
  return ib === 0 ? 0 : ia % ib
}

export function temST(p: ProdutoErp | null | undefined, csts: string[]): boolean {
  return !!p && csts.includes((p.sitTrib || '').trim())
}

function aliquotaUsada(p: ProdutoErp): number {
  return p.aliqIcmsF > 0 ? p.aliqIcmsF : p.aliqIcmsN
}

/** Fator "valor com ST" ÷ "valor sem ST" (botão ABATER ST DO VALOR UNITÁRIO). */
export function fatorST(p: ProdutoErp, csts: string[]): number {
  if (!temST(p, csts)) return 1
  const aliq = aliquotaUsada(p) / 100
  const ag = p.percAgrega / 100
  const red = p.sitTrib.trim() === '70' ? p.percRed / 100 : 0
  return 1 + (1 - red) * ag * aliq
}

/**
 * ICMS-ST do item (função CalcularICMSF da planilha):
 *   CST 10: base = preço × qtd
 *   CST 70: base = preço × qtd × (1 − %red)
 *   ICMSF = base × (1 + MVA) × alíq − base × alíq
 */
export function calcularICMSF(p: ProdutoErp, preco: number, quantidade: number, csts: string[]): number {
  if (!temST(p, csts)) return 0
  const aliq = aliquotaUsada(p) / 100
  const red = p.sitTrib.trim() === '70' ? p.percRed / 100 : 0
  const base = preco * quantidade * (1 - red)
  const vlrIcms = base * aliq
  const baseST = base * (1 + p.percAgrega / 100)
  return baseST * aliq - vlrIcms
}

/** Quantidade efetiva em unidades de venda: B + C ÷ I. */
export function quantidadeEfetiva(b: number, c: number, p: ProdutoErp | null | undefined): number {
  if (!c) return b
  const divisor = p && p.qtUndFor > 0 ? p.qtUndFor : 0
  return divisor ? b + c / divisor : b
}

/** Botão "PEDIDO COMPRA EM CAIXA" (BotaoMultiplicar). */
function converterCaixa(b: number, d: number, p: ProdutoErp) {
  const g = p.unid.trim().toUpperCase()
  const h = p.unidades
  const i = p.qtUndFor
  let convB = false
  let convD = false
  if (g === 'DP' && i > h) {
    // Display: (I ÷ H) × B, preço não muda
    if (b > 0 && h > 0 && i > 0) {
      b = b * (i / h)
      convB = true
    }
    return { b, d, convB, convD }
  }
  if (!UNID_PRECO.includes(g)) {
    // UN, PC e demais: quantidade × I
    if (b !== 0) {
      b = b * i
      convB = true
    }
  }
  if (UNID_PRECO.includes(g) && h >= 1) {
    // CX, FD, PT, KG: preço × I
    if (d !== 0) {
      d = d * i
      convD = true
    }
  }
  return { b, d, convB, convD }
}

/** Botão "PEDIDO COMPRA EM UNIDADE" (BotaoDIVIDIR). */
function converterUnidade(b: number, c: number, d: number, p: ProdutoErp) {
  const g = p.unid.trim().toUpperCase()
  const h = p.unidades
  const i = p.qtUndFor
  let convB = false
  let convD = false
  let aviso: string | undefined
  if (g === 'CX' && h === 1 && i > 1) {
    if (b > 0) {
      b = b / i
      convB = true
    }
    if (d !== 0) {
      d = d * i
      convD = true
    }
    return { b, c, d, convB, convD, aviso }
  }
  if (h === 1) {
    aviso = 'Unidades (H) = 1: conversão para unidade ignorada'
    return { b, c, d, convB, convD, aviso }
  }
  if (h > 0 && i > 0 && UNID_DIVISAO.includes(g)) {
    if (b > 0) {
      const inteiras = Math.trunc(b / i)
      c = modVba(b, i)
      b = inteiras
      convB = true
    }
    if (d > 0) {
      d = d * i
      convD = true
    }
  }
  return { b, c, d, convB, convD, aviso }
}

export function calcularLinha(l: LinhaPedido, o: OpcoesCalculo): LinhaCalculada {
  const csts = o.regras.cstsComST
  let b = l.quantidadeOriginal
  let c = 0
  let d = l.precoOriginal
  let convB = false
  let convD = false
  let stAbatido = false
  let aviso: string | undefined
  const p = l.produto

  if (p && p.unid.trim() && p.unidades && p.qtUndFor) {
    if (o.modo === 'CAIXA') {
      const r = converterCaixa(b, d, p)
      ;({ b, d, convB, convD } = r)
      if (p.unidades === 1 && p.qtUndFor === 1) aviso = 'Unidade do fornecedor = 1: confira a conversão'
    } else if (o.modo === 'UNIDADE') {
      const r = converterUnidade(b, c, d, p)
      ;({ b, c, d, convB, convD } = r)
      aviso = r.aviso
    }
  } else if (p && o.modo !== 'ORIGINAL') {
    aviso = 'Unidade, unidades ou unidade do fornecedor vazias no ERP: sem conversão'
  }

  if (o.quantidadeInteira) b = Math.trunc(b)

  const st = temST(p, csts)
  if (o.abaterST && p && st) {
    const f = fatorST(p, csts)
    if (f > 1) {
      d = arred(d / f, 2)
      stAbatido = true
    }
  }

  if (l.manual?.quantidade !== undefined) b = l.manual.quantidade
  if (l.manual?.quantidadeUnid !== undefined) c = l.manual.quantidadeUnid
  if (l.manual?.preco !== undefined) d = l.manual.preco

  const qEf = quantidadeEfetiva(b, c, p)
  const total = qEf * d
  const icmsf = p ? arred(calcularICMSF(p, d, qEf, csts), 2) : 0

  let status: StatusLinha = 'ok'
  if (p === undefined) status = 'pendente'
  else if (p === null) status = 'nao-encontrado'
  else if (!(b > 0) && !(c > 0)) status = 'sem-quantidade'
  else if (!(d > 0)) status = 'sem-preco'

  return {
    quantidade: b,
    quantidadeUnid: c,
    preco: d,
    convertidaQtd: convB,
    convertidaPreco: convD,
    stAbatido,
    temST: st,
    icmsf,
    total,
    totalComST: total + icmsf,
    status,
    aviso
  }
}

export function passaFiltro(calc: LinhaCalculada, filtro: FiltroST): boolean {
  if (filtro === 'ST') return calc.temST
  if (filtro === 'SEM_ST') return !calc.temST
  return true
}

export interface Resumo {
  linhas: number
  ok: number
  naoEncontrados: number
  pendentes: number
  comProblema: number
  comST: number
  total: number
  totalComST: number
}

export function resumir(calcs: LinhaCalculada[]): Resumo {
  const r: Resumo = { linhas: calcs.length, ok: 0, naoEncontrados: 0, pendentes: 0, comProblema: 0, comST: 0, total: 0, totalComST: 0 }
  for (const c of calcs) {
    if (c.status === 'ok') r.ok++
    else if (c.status === 'nao-encontrado') r.naoEncontrados++
    else if (c.status === 'pendente') r.pendentes++
    else r.comProblema++
    if (c.temST) r.comST++
    r.total += c.total
    r.totalComST += c.totalComST
  }
  r.total = arred(r.total)
  r.totalComST = arred(r.totalComST)
  return r
}
