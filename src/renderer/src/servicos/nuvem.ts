// Tudo que fala com o Supabase: login, perfis de usuário e histórico central.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Papel = 'admin' | 'operador'

export interface Perfil {
  id: string
  nome: string
  email: string
  papel: Papel
  ativo: boolean
}

export interface RegistroHistorico {
  id?: number
  criado_em?: string
  usuario_nome: string
  estacao: string
  conexao_cliente: string
  conexao_nome: string
  banco: string
  ano: string
  numero: string
  cliente_codigo: string
  cliente_nome: string
  cliente_cnpj: string
  pedido_compra: string
  filtro: string
  qtd_itens: number
  total: number
  total_com_st: number
  arquivo_pdf: string
}

export interface Nuvem {
  configurada: boolean
  entrar(email: string, senha: string): Promise<void>
  sair(): Promise<void>
  usuarioAtualId(): Promise<string | null>
  aoMudarSessao(fn: (logado: boolean) => void): () => void
  meuPerfil(): Promise<Perfil | null>
  registrarPreVenda(r: RegistroHistorico): Promise<void>
  historico(filtro: { texto?: string; desde?: string; limite?: number }): Promise<RegistroHistorico[]>
  jaGeradoNoHistorico(conexaoCliente: string, cnpj: string, pedido: string): Promise<RegistroHistorico[]>
  usuarios(): Promise<Perfil[]>
  criarUsuario(d: { email: string; senha: string; nome: string; papel: Papel }): Promise<void>
  alterarUsuario(id: string, d: Partial<Pick<Perfil, 'nome' | 'papel' | 'ativo'>>): Promise<void>
  trocarSenha(id: string, senha: string): Promise<void>
}

// Projeto Supabase do Gerar Pré-Venda. A chave "anon" é pública por natureza:
// quem protege os dados são as políticas RLS (supabase/migrations).
// Se existir um .env com VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, ele tem prioridade.
const URL_PADRAO = 'https://pgbwgdnclmzlszvacdfo.supabase.co'
const CHAVE_PADRAO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBnYndnZG5jbG16bHN6dmFjZGZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNTE2MDYsImV4cCI6MjEwNzgyNzYwNn0.PaE9vlT9nU5BryxyH9BhLVnKjv7dEkwh4g9uY7ySIsk'

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || URL_PADRAO
const CHAVE = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || CHAVE_PADRAO

let cliente: SupabaseClient | null = null
function sb(): SupabaseClient {
  if (!URL || !CHAVE) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  if (!cliente) cliente = createClient(URL, CHAVE, { auth: { persistSession: true, autoRefreshToken: true } })
  return cliente
}

function traduzir(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.'
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) return 'Sem conexão com a internet (Supabase). Verifique a rede.'
  if (/already been registered|already registered/i.test(msg)) return 'Já existe um usuário com este e-mail.'
  return msg
}

async function ou<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(traduzir(error.message))
  return data
}

async function funcaoAdmin(corpo: Record<string, unknown>) {
  const { data, error } = await sb().functions.invoke('admin-usuarios', { body: corpo })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as { context?: Response }).context
      const j = ctx ? await ctx.json() : null
      if (j?.erro) msg = j.erro
    } catch {
      /* mantém a mensagem original */
    }
    throw new Error(traduzir(msg))
  }
  if (data?.erro) throw new Error(data.erro)
  return data
}

export const nuvemSupabase: Nuvem = {
  configurada: !!(URL && CHAVE),
  async entrar(email, senha) {
    const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password: senha })
    if (error) throw new Error(traduzir(error.message))
  },
  async sair() {
    await sb().auth.signOut()
  },
  async usuarioAtualId() {
    const { data } = await sb().auth.getSession()
    return data.session?.user.id ?? null
  },
  aoMudarSessao(fn) {
    const { data } = sb().auth.onAuthStateChange((_ev, sessao) => fn(!!sessao))
    return () => data.subscription.unsubscribe()
  },
  async meuPerfil() {
    const id = await this.usuarioAtualId()
    if (!id) return null
    return (await ou(sb().from('perfis').select('id, nome, email, papel, ativo').eq('id', id).maybeSingle())) as Perfil | null
  },
  async registrarPreVenda(r) {
    await ou(sb().from('prevendas_geradas').insert(r))
  },
  async historico({ texto, desde, limite = 300 }) {
    let q = sb().from('prevendas_geradas').select('*').order('criado_em', { ascending: false }).limit(limite)
    if (desde) q = q.gte('criado_em', desde)
    if (texto?.trim()) {
      const t = texto.trim().replace(/[%,()]/g, ' ')
      q = q.or(
        `pedido_compra.ilike.%${t}%,cliente_nome.ilike.%${t}%,cliente_cnpj.ilike.%${t}%,numero.ilike.%${t}%,usuario_nome.ilike.%${t}%,conexao_cliente.ilike.%${t}%`
      )
    }
    return ((await ou(q)) ?? []) as RegistroHistorico[]
  },
  async jaGeradoNoHistorico(conexaoCliente, cnpj, pedido) {
    const r = await ou(
      sb()
        .from('prevendas_geradas')
        .select('*')
        .eq('conexao_cliente', conexaoCliente)
        .eq('cliente_cnpj', cnpj)
        .eq('pedido_compra', pedido)
        .order('criado_em', { ascending: false })
    )
    return (r ?? []) as RegistroHistorico[]
  },
  async usuarios() {
    return ((await ou(sb().from('perfis').select('id, nome, email, papel, ativo').order('nome'))) ?? []) as Perfil[]
  },
  async criarUsuario(d) {
    await funcaoAdmin({ acao: 'criar', ...d })
  },
  async alterarUsuario(id, d) {
    await ou(sb().from('perfis').update(d).eq('id', id))
  },
  async trocarSenha(id, senha) {
    await funcaoAdmin({ acao: 'senha', id, senha })
  }
}
