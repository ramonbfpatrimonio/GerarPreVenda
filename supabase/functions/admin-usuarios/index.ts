// Edge Function: empresas e usuários (precisa da service role, por isso roda no Supabase).
//
// Ações:
//   criar_empresa  (super_admin)            -> cria a empresa e o administrador dela
//   criar          (admin da empresa/super) -> cria usuário; admin só na própria empresa
//   senha          (admin da empresa/super) -> troca a senha; admin só de usuários da própria empresa
//
// Publicar: painel Edge Functions > admin-usuarios > colar este código > Deploy
// (ou: npx supabase functions deploy admin-usuarios)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const erro = (mensagem: string, status = 400) => resposta({ erro: mensagem }, status)

function traduzir(msg: string): string {
  if (/already been registered|already registered|already exists/i.test(msg)) return 'Já existe um usuário com este e-mail.'
  if (/password/i.test(msg) && /short|least|weak/i.test(msg)) return 'Senha fraca: use pelo menos 6 caracteres.'
  if (/invalid.*email|email.*invalid/i.test(msg)) return 'E-mail inválido.'
  return msg
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: eu } = await comoUsuario.auth.getUser()
  if (!eu?.user) return erro('Sessão expirada. Entre novamente.', 401)

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: meu } = await admin
    .from('perfis')
    .select('papel, ativo, empresa_id, empresas(ativa)')
    .eq('id', eu.user.id)
    .single()
  const empresaAtiva = (meu?.empresas as { ativa?: boolean } | null)?.ativa ?? false
  const souSuper = !!meu && meu.ativo && meu.papel === 'super_admin'
  const souAdmin = !!meu && meu.ativo && meu.papel === 'admin' && empresaAtiva
  if (!souSuper && !souAdmin) return erro('Apenas administradores podem gerenciar usuários.', 403)

  const corpo = await req.json().catch(() => ({}))

  // Cria o usuário já com empresa e papel no app_metadata (o gatilho do banco cria o perfil).
  async function criarUsuario(email: string, senha: string, nome: string, papel: string, empresaId: string) {
    if (!email || !senha || String(senha).length < 6) throw new Error('Informe e-mail e senha (mínimo 6 caracteres).')
    const { data, error } = await admin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
      app_metadata: { empresa_id: empresaId, papel }
    })
    if (error) throw new Error(traduzir(error.message))
    // Garante o perfil mesmo se o gatilho for antigo
    await admin.from('perfis').upsert({ id: data.user.id, email: data.user.email, nome: nome || email, papel, empresa_id: empresaId, ativo: true })
    return data.user.id
  }

  try {
    if (corpo.acao === 'criar_empresa') {
      if (!souSuper) return erro('Apenas o super administrador cria empresas.', 403)
      const nome = String(corpo.nome ?? '').trim()
      if (!nome) return erro('Informe o nome da empresa.')
      const { data: emp, error } = await admin
        .from('empresas')
        .insert({ nome, cnpj: String(corpo.cnpj ?? '').replace(/\D/g, '') })
        .select('id')
        .single()
      if (error) return erro(error.message)
      try {
        await criarUsuario(corpo.admin_email, corpo.admin_senha, corpo.admin_nome, 'admin', emp.id)
      } catch (e) {
        await admin.from('empresas').delete().eq('id', emp.id) // desfaz: empresa sem administrador não serve
        return erro((e as Error).message)
      }
      return resposta({ id: emp.id })
    }

    if (corpo.acao === 'criar') {
      const papel = corpo.papel === 'admin' ? 'admin' : 'operador'
      const empresaId = souSuper ? corpo.empresa_id : meu!.empresa_id
      if (!empresaId) return erro('Escolha a empresa do usuário.')
      const id = await criarUsuario(corpo.email, corpo.senha, corpo.nome, papel, empresaId)
      return resposta({ id })
    }

    if (corpo.acao === 'senha') {
      const { id, senha } = corpo
      if (!id || !senha || String(senha).length < 6) return erro('A senha precisa ter pelo menos 6 caracteres.')
      const { data: alvo } = await admin.from('perfis').select('empresa_id, papel').eq('id', id).single()
      if (!alvo) return erro('Usuário não encontrado.', 404)
      if (!souSuper && (alvo.empresa_id !== meu!.empresa_id || alvo.papel === 'super_admin')) {
        return erro('Você só pode trocar a senha de usuários da sua empresa.', 403)
      }
      const { error } = await admin.auth.admin.updateUserById(id, { password: senha })
      if (error) return erro(traduzir(error.message))
      return resposta({ ok: true })
    }

    return erro('Ação desconhecida.')
  } catch (e) {
    return erro((e as Error).message)
  }
})
