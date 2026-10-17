import { describe, it, expect } from 'vitest'
import { calcularLinha, calcularICMSF, fatorST, type LinhaPedido, type OpcoesCalculo } from '../src/shared/regras'
import { numeroBR, zeros, cnpj14 } from '../src/shared/numeros'
import type { ProdutoErp } from '../src/shared/tipos'

const prod = (o: Partial<ProdutoErp>): ProdutoErp => ({
  codigo: '000123', codBarras: '789', descricao: 'X', unid: 'CX', unidades: 30, qtUndFor: 30,
  precoVenda: 0, sitTrib: '00', aliqIcmsN: 20, aliqIcmsF: 0, percAgrega: 0, percRed: 0, ...o
})
const linha = (b: number, d: number, p: ProdutoErp | null | undefined): LinhaPedido => ({
  id: '1', codigoLido: '789', quantidadeOriginal: b, precoOriginal: d, produto: p
})
const op = (o: Partial<OpcoesCalculo> = {}): OpcoesCalculo => ({
  modo: 'ORIGINAL', abaterST: false, quantidadeInteira: false, regras: { cstsComST: ['10', '70'] }, ...o
})

describe('números BR', () => {
  it('trata ponto de milhar (a planilha transformava 1.000 em 1)', () => {
    expect(numeroBR('1.000')).toBe(1000)
    expect(numeroBR('1.234,56')).toBe(1234.56)
    expect(numeroBR('2,500')).toBe(2.5)
    expect(numeroBR('15.0')).toBe(15)
    expect(numeroBR('12,00%')).toBe(12)
  })
  it('zeros e CNPJ como a planilha', () => {
    expect(zeros('123', 6)).toBe('000123')
    expect(zeros('AB1', 6)).toBe('000AB1')
    expect(cnpj14('22.991.939/0017-65')).toBe('22991939001765')
    expect(cnpj14('1234')).toBe('00000000001234')
  })
})

describe('PEDIDO COMPRA EM CAIXA', () => {
  it('CX: mantém a quantidade e multiplica o preço por I', () => {
    const c = calcularLinha(linha(2, 8.99, prod({ unid: 'CX', unidades: 15, qtUndFor: 15 })), op({ modo: 'CAIXA' }))
    expect(c.quantidade).toBe(2)
    expect(c.preco).toBeCloseTo(134.85)
    expect(c.total).toBeCloseTo(269.7)
  })
  it('UN: multiplica a quantidade por I e mantém o preço', () => {
    const c = calcularLinha(linha(2, 8.99, prod({ unid: 'UN', unidades: 1, qtUndFor: 15 })), op({ modo: 'CAIXA' }))
    expect(c.quantidade).toBe(30)
    expect(c.preco).toBe(8.99)
  })
  it('DP com I > H: (I/H) × B e não mexe no preço', () => {
    const c = calcularLinha(linha(2, 5, prod({ unid: 'DP', unidades: 12, qtUndFor: 72 })), op({ modo: 'CAIXA' }))
    expect(c.quantidade).toBe(12)
    expect(c.preco).toBe(5)
  })
  it('nunca acumula: recalcula sempre a partir do original', () => {
    const l = linha(2, 8.99, prod({ unid: 'UN', unidades: 1, qtUndFor: 15 }))
    calcularLinha(l, op({ modo: 'CAIXA' }))
    expect(calcularLinha(l, op({ modo: 'CAIXA' })).quantidade).toBe(30)
  })
})

describe('PEDIDO COMPRA EM UNIDADE', () => {
  it('CX com H > 1: caixas inteiras em B, sobra em C, preço da caixa em D', () => {
    const c = calcularLinha(linha(70, 2, prod({ unid: 'CX', unidades: 30, qtUndFor: 30 })), op({ modo: 'UNIDADE' }))
    expect(c.quantidade).toBe(2)
    expect(c.quantidadeUnid).toBe(10)
    expect(c.preco).toBe(60)
    expect(c.total).toBeCloseTo(140) // a planilha calculava 120,60
  })
  it('CX com H = 1 e I > 1: B ÷ I e D × I', () => {
    const c = calcularLinha(linha(72, 1, prod({ unid: 'CX', unidades: 1, qtUndFor: 72 })), op({ modo: 'UNIDADE' }))
    expect(c.quantidade).toBe(1)
    expect(c.preco).toBe(72)
  })
  it('H = 1 (não CX): ignorada com aviso', () => {
    const c = calcularLinha(linha(10, 1, prod({ unid: 'UN', unidades: 1, qtUndFor: 12 })), op({ modo: 'UNIDADE' }))
    expect(c.quantidade).toBe(10)
    expect(c.aviso).toMatch(/ignorada/)
  })
})

describe('ST', () => {
  const st10 = prod({ sitTrib: '10', aliqIcmsN: 20, percAgrega: 34 })
  const st70 = prod({ sitTrib: '70', aliqIcmsN: 20, percAgrega: 34, percRed: 65 })
  it('ICMSF CST 10 e 70 como na planilha', () => {
    expect(calcularICMSF(st10, 10, 2, ['10', '70'])).toBeCloseTo(20 * 0.34 * 0.2)
    expect(calcularICMSF(st70, 10, 2, ['10', '70'])).toBeCloseTo(20 * 0.35 * 0.34 * 0.2)
    expect(calcularICMSF(prod({}), 10, 2, ['10', '70'])).toBe(0)
  })
  it('abater ST é o inverso do ICMSF', () => {
    const f = fatorST(st70, ['10', '70'])
    const semST = 3.06 / f
    expect(semST + calcularICMSF(st70, semST, 1, ['10', '70'])).toBeCloseTo(3.06)
    const c = calcularLinha(linha(1, 3.06, st70), op({ abaterST: true }))
    expect(c.stAbatido).toBe(true)
    expect(c.preco).toBe(Math.round((3.06 / f) * 100) / 100)
    expect(c.totalComST).toBeCloseTo(3.06, 1)
  })
  it('alíquota ICMSF tem prioridade sobre ICMSN', () => {
    const p = prod({ sitTrib: '10', aliqIcmsN: 20, aliqIcmsF: 18, percAgrega: 50 })
    expect(calcularICMSF(p, 100, 1, ['10'])).toBeCloseTo(100 * 0.5 * 0.18)
  })
})

describe('status da linha', () => {
  it('produto não localizado não passa como ok', () => {
    expect(calcularLinha(linha(1, 1, null), op()).status).toBe('nao-encontrado')
    expect(calcularLinha(linha(1, 1, undefined), op()).status).toBe('pendente')
    expect(calcularLinha(linha(0, 1, prod({})), op()).status).toBe('sem-quantidade')
    expect(calcularLinha(linha(1, 0, prod({})), op()).status).toBe('sem-preco')
  })
  it('edição manual tem prioridade', () => {
    const l = { ...linha(2, 8.99, prod({ unid: 'CX', unidades: 15, qtUndFor: 15 })), manual: { preco: 100 } }
    expect(calcularLinha(l, op({ modo: 'CAIXA' })).preco).toBe(100)
  })
})
