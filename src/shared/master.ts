// Senha master do suporte: prefixo fixo + data do computador (DDMMAAAA).
// O prefixo NÃO fica no código (o repositório é público): guardamos só o
// SHA-256 dele, e a data de hoje precisa estar no fim da senha.

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
