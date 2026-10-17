// Conversões numéricas no formato brasileiro.
// A planilha usava Val(Replace(x, ",", ".")), que transforma "1.000" em 1
// e "1.234,56" em 1,234. Aqui o ponto de milhar é tratado corretamente.

/** Converte "1.234,56", "1,000", "12,00%", "15.0" ou número em number. */
export function numeroBR(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0
  if (valor === null || valor === undefined) return 0
  let s = String(valor).trim().replace(/\s/g, '').replace('%', '').replace(/^R\$/, '')
  if (!s) return 0
  const temVirgula = s.includes(',')
  if (temVirgula) {
    // vírgula decimal, pontos de milhar
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.000" ou "12.345.678": só pontos de milhar
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function arred(n: number, casas = 2): number {
  const f = 10 ** casas
  return Math.round((n + Number.EPSILON) * f) / f
}

export function moeda(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function numero(n: number, casas = 2): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

/** Número com até `max` casas, sem zeros sobrando (para quantidades). */
export function qtd(n: number, max = 4): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: max })
}

export function soDigitos(s: string): string {
  return (s || '').replace(/\D/g, '')
}

/** CNPJ com 14 dígitos (completa zeros à esquerda, como a planilha). */
export function cnpj14(s: string): string {
  return soDigitos(s).padStart(14, '0').slice(-14)
}

export function formatarCnpj(s: string): string {
  const d = cnpj14(s)
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/** Código com zeros à esquerda (planilha: Format(codigo, "000000")). */
export function zeros(codigo: string, digitos: number): string {
  const c = (codigo || '').trim()
  if (!c) return ''
  if (/^\d+$/.test(c)) return c.replace(/^0+(?=\d)/, '').padStart(digitos, '0')
  return c.padStart(digitos, '0').slice(-digitos)
}
