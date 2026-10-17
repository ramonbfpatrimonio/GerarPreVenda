// Edge Function: criação de usuários e troca de senha pelo administrador.
// Precisa da service role, por isso roda no Supabase e não no programa.
//
// Publicar:  supabase functions deploy admin-usuarios
// (SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já existem nas Edge Functions)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Quem está chamando?
  const comoUsuario = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const { data: eu } = await comoUsuario.auth.getUser()
  if (!eu?.user) return resposta({ erro: 'Sessão expirada. Entre novamente.' }, 401)

  const admin = createClient(url, service)
  const { data: perfil } = await admin.from('perfis').select('papel, ativo').eq('id', eu.user.id).single()
  if (!perfil || perfil.papel !== 'admin' || !perfil.ativo) {
    return resposta({ erro: 'Apenas administradores podem gerenciar usuários.' }, 403)
  }

  const corpo = await req.json().catch(() => ({}))

  if (corpo.acao === 'criar') {
    const { email, senha, nome, papel } = corpo
    if (!email || !senha || String(senha).length < 6) return resposta({ erro: 'Informe e-mail e senha (mínimo 6 caracteres).' }, 400)
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome }
    })
    if (error) return resposta({ erro: error.message }, 400)
    await admin.from('perfis').upsert({ id: data.user.id, email, nome: nome || email, papel: papel === 'admin' ? 'admin' : 'operador', ativo: true })
    return resposta({ id: data.user.id })
  }

  if (corpo.acao === 'senha') {
    const { id, senha } = corpo
    if (!id || !senha || String(senha).length < 6) return resposta({ erro: 'A senha precisa ter pelo menos 6 caracteres.' }, 400)
    const { error } = await admin.auth.admin.updateUserById(id, { password: senha })
    if (error) return resposta({ erro: error.message }, 400)
    return resposta({ ok: true })
  }

  return resposta({ erro: 'Ação desconhecida.' }, 400)
})
