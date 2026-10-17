import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { lerPdf } from '../src/main/pdf'

describe('leitor Bluesoft — HAGE_RR.pdf', async () => {
  const r = await lerPdf(resolve(__dirname, 'fixtures/HAGE_RR.pdf'))

  it('encontra os 4 pedidos (lojas 17, 29, 30, 31)', () => {
    expect(r.pedidos.map((p) => p.numero)).toEqual(['153331- 017', '153331- 029', '153331- 030', '153331- 031'])
    expect(r.pedidos.map((p) => p.cnpjLoja)).toEqual([
      '22991939001765', '22991939002907', '22991939003032', '22991939003113'
    ])
    expect(r.pedidos[0].loja).toBe('17 - HIPER BOA VISTA')
    expect(r.pedidos[0].comprador).toBe('SUPERMERCADOS DB LTDA')
    expect(r.pedidos[0].cnpjFornecedor).toBe('39648061000103')
    expect(r.pedidos[0].emitidoEm).toBe('15/09/2026')
    expect(r.pedidos[0].entregaPrevista).toBe('05/10/2026')
  })

  it('lê todos os 116 itens, sem avisos, e a soma bate com o total do PDF', () => {
    expect(r.pedidos.reduce((s, p) => s + p.itens.length, 0)).toBe(116)
    for (const p of r.pedidos) {
      expect(p.avisos).toEqual([])
      expect(p.paginas.length).toBe(2)
    }
    expect(r.pedidos[0].totalPdf).toBe(4137.09)
    expect(r.pedidos.map((p) => p.mercadoriasPdf)).toEqual([4391.97, 2455.75, 2498.5, 1950.41])
  })

  it('lê corretamente as colunas de um item', () => {
    const it0 = r.pedidos[0].itens[0]
    expect(it0).toMatchObject({
      codigoInterno: '18118314', gtin: '7898717040944',
      descricao: 'ACUCAR DEMERARA VIVA VITTA 450G CX 15.0', ref: '000310',
      embalagem: 'CX 15.0', fatorEmbalagem: 15, quantidade: 1, custoBase: 134.85,
      valorUnitario: 7.91, total: 118.67
    })
    const rosq = r.pedidos[0].itens.find((i) => i.gtin === '7898717042337')!
    expect(rosq).toMatchObject({ quantidade: 8, icmsStPerc: 18, icmsSt: 80.64, valorUnitario: 2.97, total: 474.88 })
  })
})

import { lerPedidosBluesoft, type Celula } from '../src/shared/pdf/bluesoft'

describe('leitor Bluesoft — linha com ICMS reduzido (layout do "pedido db maio")', () => {
  it('lê valor e total mesmo com "20,00% - Red." na coluna de ICMS', () => {
    const c = (x: number, y: number, texto: string): Celula => ({ x, y, texto })
    const pag = [
      c(255, 47, 'Pedido: 111913- 001(SUPERMERCADOS DB LTDA)'),
      c(38, 115, '1'), c(397, 115, '22.991.939/0001-06'), c(243, 115, '01 - HIPER PARAIBA'),
      c(38, 307, 'Código'), c(84, 307, 'GTIN Unitário'), c(145, 307, 'Descrição'), c(344, 307, 'Ref'), c(405, 307, 'Embal. Quant.'),
      c(38, 326, '18173064'), c(84, 326, '7898717042337'), c(145, 326, 'ROSQUINHA FAZENDEIRO CHOC 300G CX 20.0'),
      c(405, 326, 'CX 20.0'), c(444, 326, '10,000'), c(475, 326, '59,80 0,00%'), c(540, 326, '0,00'), c(567, 326, '2,38'),
      c(597, 326, '14,23'), c(632, 326, '0,00'), c(662, 326, '0,00 20,00% - Red.'), c(745, 326, '3,06'), c(783, 326, '612,23'),
      c(680, 334, '65,00%'),
      c(36, 400, 'Totais'), c(71, 420, '598,00'), c(149, 420, '0,00'), c(199, 420, '598,00'), c(269, 420, '0,00'), c(341, 420, '0,00'), c(777, 420, '612,23')
    ]
    const r = lerPedidosBluesoft([{ numero: 1, celulas: pag }])
    const it = r.pedidos[0].itens[0]
    expect(it).toMatchObject({ quantidade: 10, custoBase: 59.8, icmsSt: 14.23, valorUnitario: 3.06, total: 612.23, ref: '' })
    expect(r.pedidos[0].avisos).toEqual([])
  })
})
