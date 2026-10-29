// Edge Function: entrar como super administrador com a SENHA MASTER do suporte.
//
// Senha master = prefixo fixo + data do computador (DDMMAAAA). O prefixo não fica
// no código: guardamos só o SHA-256 dele (o mesmo de src/shared/master.ts).
// Só vale para contas de super administrador ativas (ex.: admin@admin.com).
// A data aceita é a de hoje em Manaus, com 1 dia de folga para os lados
// (relógio/fuso do computador).
//
// Publicar: painel Edge Functions > Deploy a new function > nome login-master >
// colar este código > Deploy   (ou: npx supabase functions deploy login-master)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const HASH_PREFIXO = '1fb57b787482404619aeef4b413522a3a365b78b0ed5bb96e2a57826f7c1756d'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-estacao',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Datas aceitas (DDMMAAAA): ontem, hoje e amanhã no fuso de Manaus. */
function datasAceitas(): string[] {
  const manaus = Date.now() - 4 * 3600_000
  return [-1, 0, 1].map((d) => {
    const x = new Date(manaus + d * 86400_000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(x.getUTCDate())}${p(x.getUTCMonth() + 1)}${x.getUTCFullYear()}`
  })
}

async function senhaMasterValida(senha: string): Promise<boolean> {
  const s = String(senha ?? '').trim()
  const data = s.slice(-8)
  if (s.length <= 8 || !datasAceitas().includes(data)) return false
  return (await sha256('GPV-master|' + s.slice(0, -8))) === HASH_PREFIXO
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const corpo = await req.json().catch(() => ({}))
  const email = String(corpo.email ?? '').trim().toLowerCase()

  if (!email || !(await senhaMasterValida(corpo.senha))) {
    await espera(800) // atrasa tentativas
    return resposta({ erro: 'E-mail ou senha incorretos.' }, 401)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // Acha o login pelo e-mail no Auth (o e-mail do perfil pode estar desatualizado)
  let usuario: { id: string; email?: string } | undefined
  for (let pagina = 1; pagina <= 20 && !usuario; pagina++) {
    const { data: lista, error: e } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 })
    if (e) return resposta({ erro: e.message }, 500)
    usuario = lista.users.find((u) => (u.email ?? '').toLowerCase() === email)
    if (lista.users.length < 200) break
  }
  const { data: perfil } = usuario
    ? await admin.from('perfis').select('id, papel, ativo, email').eq('id', usuario.id).maybeSingle()
    : { data: null }
  if (!perfil || perfil.papel !== 'super_admin' || !perfil.ativo) {
    await espera(800)
    return resposta({ erro: 'A senha master só vale para o acesso master (super administrador).' }, 403)
  }
  if (perfil.email !== email) await admin.from('perfis').update({ email }).eq('id', perfil.id)

  // Gera um link de acesso de uso único (não envia e-mail); o programa troca pelo login.
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data?.properties?.hashed_token) return resposta({ erro: error?.message ?? 'Não foi possível entrar.' }, 500)

  return resposta({ token_hash: data.properties.hashed_token })
})
