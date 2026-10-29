// Regras da cobrança da licença (as mesmas do banco: supabase/migrations/004_cobranca.sql).
// Datas no formato AAAA-MM-DD.

export interface Licenca {
  vencimento: string | null // null = sem cobrança
  valor: number
  ciclo_meses: number
  dias_aviso: number
  dias_tolerancia: number
  contato: string
  hoje?: string // data do servidor no momento da consulta
}

export type EstadoLicenca = 'sem_cobranca' | 'em_dia' | 'vencendo' | 'atrasada' | 'bloqueada'

export interface SituacaoLicenca {
  estado: EstadoLicenca
  /** dias até o vencimento (negativo = dias de atraso) */
  dias: number
  /** último dia antes do bloqueio (vencimento + tolerância) */
  limite: string | null
}

const dia = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000

export const diferencaDias = (de: string, ate: string) => Math.round(dia(ate) - dia(de))

export function somarDias(d: string, n: number): string {
  return new Date((dia(d) + n) * 86400000).toISOString().slice(0, 10)
}

/** Data de hoje no computador, AAAA-MM-DD (fuso local). */
export function hojeLocal(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`
}

/** Mais recente entre duas datas (evita "voltar o relógio" do computador para fugir do bloqueio). */
export const maisRecente = (a: string, b?: string | null) => (b && b > a ? b : a)

export function situacaoLicenca(venc: string | null, diasAviso: number, diasTolerancia: number, hoje: string): SituacaoLicenca {
  if (!venc) return { estado: 'sem_cobranca', dias: 0, limite: null }
  const dias = diferencaDias(hoje, venc)
  const limite = somarDias(venc, diasTolerancia)
  if (dias < -diasTolerancia) return { estado: 'bloqueada', dias, limite }
  if (dias < 0) return { estado: 'atrasada', dias, limite }
  if (dias <= diasAviso) return { estado: 'vencendo', dias, limite }
  return { estado: 'em_dia', dias, limite }
}

/** 2026-10-25 -> 25/10/2026 */
export const dataBR = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')

export const nomeCiclo = (m: number) => ({ 1: 'Mensal', 2: 'Bimestral', 3: 'Trimestral', 6: 'Semestral', 12: 'Anual' } as Record<number, string>)[m] ?? `${m} meses`

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Soma meses como o banco (dia 31 + 1 mês cai no último dia do mês seguinte). */
export function somarMeses(d: string, meses: number): string {
  const a = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + meses, dd = +d.slice(8, 10)
  const ano = a + Math.floor(m / 12), mes = ((m % 12) + 12) % 12
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()
  return new Date(Date.UTC(ano, mes, Math.min(dd, ultimo))).toISOString().slice(0, 10)
}

// ----------------------------------------------------------------- senha master do suporte
// Prefixo fixo + data do computador (DDMMAAAA). O prefixo NÃO fica no código (o
// repositório é público): guardamos só o SHA-256 dele, e a data de hoje precisa estar no fim.

const HASH_PREFIXO = '1fb57b787482404619aeef4b413522a3a365b78b0ed5bb96e2a57826f7c1756d'

/** Data no formato da senha master: 29/10/2026 -> "29102026" (data do computador). */
export function dataMaster(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(agora.getDate())}${p(agora.getMonth() + 1)}${agora.getFullYear()}`
}

async function sha256(texto: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** true quando a senha é a master de hoje. */
export async function ehSenhaMaster(senha: string, agora = new Date()): Promise<boolean> {
  const s = senha.trim()
  const data = dataMaster(agora)
  if (s.length <= data.length || !s.endsWith(data)) return false
  return (await sha256('GPV-master|' + s.slice(0, -data.length))) === HASH_PREFIXO
}
