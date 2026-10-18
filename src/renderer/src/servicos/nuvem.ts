// Tudo que fala com o Supabase: login, empresas, usuários, conexões da empresa e histórico.
// A separação entre empresas é garantida no banco (RLS, supabase/migrations/002_empresas.sql);
// os filtros daqui são só para a tela.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DadosConexaoNuvem } from '@shared/tipos'

export type Papel = 'super_admin' | 'admin' | 'operador'

export interface Perfil {
  id: string
  nome: string
  email: string
  papel: Papel
  ativo: boolean
  empresa_id: string | null
  empresa_nome: string
  empresa_ativa: boolean
}

export interface Empresa {
  id: string
  nome: string
  cnpj: string
  ativa: boolean
  retencao_meses: number
  criado_em?: string
  usuarios?: number
  prevendas_mes?: number
  total_mes?: number
  ultima_atividade?: string | null
}

export interface RegistroHistorico {
  id?: number
  criado_em?: string
  empresa_id?: string
  chave_local?: string
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
  empresas?: { nome: string } | null
}

export interface ConexaoNuvem {
  id: string
  empresa_id: string
  dados: DadosConexaoNuvem
  atualizado_em?: string
}

export interface Nuvem {
  configurada: boolean
  entrar(email: string, senha: string): Promise<void>
  sair(): Promise<void>
  usuarioAtualId(): Promise<string | null>
  aoMudarSessao(fn: (logado: boolean) => void): () => void
  meuPerfil(): Promise<Perfil | null>
  online(): Promise<boolean>
  // histórico
  registrarPreVenda(r: RegistroHistorico): Promise<void>
  historico(filtro: { texto?: string; desde?: string; limite?: number; empresaId?: string | null }): Promise<RegistroHistorico[]>
  jaGeradoNoHistorico(empresaId: string | null, cnpj: string, pedido: string): Promise<RegistroHistorico[]>
  // usuários
  usuarios(empresaId?: string | null): Promise<Perfil[]>
  criarUsuario(d: { email: string; senha: string; nome: string; papel: Papel; empresa_id?: string | null }): Promise<void>
  alterarUsuario(id: string, d: Partial<Pick<Perfil, 'nome' | 'papel' | 'ativo'>>): Promise<void>
  trocarSenha(id: string, senha: string): Promise<void>
  // empresas (super_admin)
  empresas(): Promise<Empresa[]>
  criarEmpresa(d: { nome: string; cnpj: string; admin_nome: string; admin_email: string; admin_senha: string }): Promise<string>
  alterarEmpresa(id: string, d: Partial<Pick<Empresa, 'nome' | 'cnpj' | 'ativa' | 'retencao_meses'>>): Promise<void>
  // conexões da empresa
  conexoes(empresaId: string): Promise<ConexaoNuvem[]>
  salvarConexao(empresaId: string, dados: DadosConexaoNuvem): Promise<void>
  excluirConexao(id: string): Promise<void>
  // eventos do sistema
  registrarEvento(e: NovoEvento): Promise<void>
  eventos(filtro: { desde?: string; texto?: string; acao?: string; entidade?: string; empresaId?: string | null; limite?: number }): Promise<Evento[]>
  // backup da nuvem
  backupEmpresa(empresaId: string): Promise<Record<string, unknown>>
}

export interface NovoEvento {
  acao: string
  entidade: string
  descricao?: string
  detalhes?: Record<string, unknown>
  chave_local?: string
  criado_em?: string
  empresa_id?: string | null
}

export interface Evento {
  id: number
  criado_em: string
  empresa_id: string | null
  usuario_nome: string
  estacao: string
  acao: string
  entidade: string
  descricao: string
  detalhes: Record<string, unknown>
  empresas?: { nome: string } | null
}

// Projeto Supabase do Gerar Pré-Venda. A chave "anon" é pública por natureza:
// quem protege os dados são as políticas RLS (supabase/migrations).
// Se existir um .env com VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, ele tem prioridade.
const URL_PADRAO = 'https://pgbwgdnclmzlszvacdfo.supabase.co'
const CHAVE_PADRAO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBnYndnZG5jbG16bHN6dmFjZGZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNTE2MDYsImV4cCI6MjEwNzgyNzYwNn0.PaE9vlT9nU5BryxyH9BhLVnKjv7dEkwh4g9uY7ySIsk'

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || URL_PADRAO
const CHAVE = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || CHAVE_PADRAO

// Nome do computador vai em todo pedido (o banco grava nos eventos do sistema).
let estacao = ''
export function definirEstacao(nome: string) {
  estacao = (nome || '').normalize('NFD').replace(/[^\x20-\x7E]/g, '').slice(0, 60)
}

function novoCliente(persistir: boolean): SupabaseClient {
  return createClient(URL, CHAVE, {
    auth: persistir
      ? { persistSession: true, autoRefreshToken: true }
      : { persistSession: false, autoRefreshToken: true, storageKey: 'gpv-admin' },
    global: { headers: { 'x-estacao': estacao } }
  })
}

let cliente: SupabaseClient | null = null
function sb(): SupabaseClient {
  if (!cliente) cliente = novoCliente(true)
  return cliente
}

const MSG_SEM_INTERNET = 'Sem conexão com a internet.'

/** Falha de rede (sem internet / Supabase fora do ar), e não erro de regra. */
export function ehErroDeRede(e: unknown): boolean {
  const m = (e as Error)?.message ?? String(e)
  return m === MSG_SEM_INTERNET || /Failed to fetch|NetworkError|fetch failed|Load failed|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|network/i.test(m)
}

function traduzir(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.'
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(msg)) return MSG_SEM_INTERNET
  if (/already been registered|already registered/i.test(msg)) return 'Já existe um usuário com este e-mail.'
  if (/row-level security|permission denied/i.test(msg)) return 'Sem permissão para esta operação.'
  const falta = msg.match(/Could not find the (?:table|function) '?public\.(\w+)/i)
  if (falta) {
    const arquivo = /evento/i.test(falta[1]) ? '003_eventos.sql' : /empresa|conexoes_empresa|resumo/i.test(falta[1]) ? '002_empresas.sql' : '001_inicial.sql'
    return `O banco na nuvem ainda não foi atualizado (falta "${falta[1]}"). No Supabase, abra o SQL Editor e rode supabase/migrations/${arquivo}.`
  }
  return msg
}

async function ou<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  let r: { data: T; error: { message: string } | null }
  try {
    r = await p
  } catch (e) {
    throw new Error(traduzir((e as Error).message))
  }
  if (r.error) throw new Error(traduzir(r.error.message))
  return r.data
}

async function funcaoAdmin(c: SupabaseClient, corpo: Record<string, unknown>) {
  const { data, error } = await c.functions.invoke('admin-usuarios', { body: corpo })
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

type LinhaPerfil = Omit<Perfil, 'empresa_nome' | 'empresa_ativa'> & { empresas: { nome: string; ativa: boolean } | null }
const COLUNAS_PERFIL = 'id, nome, email, papel, ativo, empresa_id, empresas(nome, ativa)'
const paraPerfil = (p: LinhaPerfil): Perfil => ({
  id: p.id,
  nome: p.nome,
  email: p.email,
  papel: p.papel,
  ativo: p.ativo,
  empresa_id: p.empresa_id,
  empresa_nome: p.empresas?.nome ?? '',
  empresa_ativa: p.empresas?.ativa ?? false
})

/** Monta o serviço sobre um cliente do Supabase (o da sessão normal ou o da área administrativa). */
function fabricar(obter: () => SupabaseClient): Nuvem {
  const sb = obter
  return {
  configurada: !!(URL && CHAVE),
  async entrar(email, senha) {
    try {
      const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password: senha })
      if (error) throw new Error(traduzir(error.message))
    } catch (e) {
      throw new Error(traduzir((e as Error).message))
    }
  },
  async sair() {
    try {
      await sb().auth.signOut({ scope: 'local' })
    } catch {
      /* sem internet: a sessão local é apagada mesmo assim */
    }
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
    const p = (await ou(sb().from('perfis').select(COLUNAS_PERFIL).eq('id', id).maybeSingle())) as LinhaPerfil | null
    return p ? paraPerfil(p) : null
  },
  async online() {
    try {
      const r = await fetch(`${URL}/auth/v1/health`, { headers: { apikey: CHAVE }, cache: 'no-store' })
      return r.ok
    } catch {
      return false
    }
  },

  async registrarPreVenda(r) {
    const { empresas: _ignorar, ...registro } = r
    // chave_local única: reenviar (fila offline) não duplica
    await ou(sb().from('prevendas_geradas').upsert(registro, { onConflict: 'chave_local', ignoreDuplicates: true }))
  },
  async historico({ texto, desde, limite = 300, empresaId }) {
    let q = sb().from('prevendas_geradas').select('*, empresas(nome)').order('criado_em', { ascending: false }).limit(limite)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    if (desde) q = q.gte('criado_em', desde)
    if (texto?.trim()) {
      const t = texto.trim().replace(/[%,()]/g, ' ')
      q = q.or(
        `pedido_compra.ilike.%${t}%,cliente_nome.ilike.%${t}%,cliente_cnpj.ilike.%${t}%,numero.ilike.%${t}%,usuario_nome.ilike.%${t}%,conexao_cliente.ilike.%${t}%`
      )
    }
    return ((await ou(q)) ?? []) as RegistroHistorico[]
  },
  async jaGeradoNoHistorico(empresaId, cnpj, pedido) {
    let q = sb().from('prevendas_geradas').select('*').eq('cliente_cnpj', cnpj).eq('pedido_compra', pedido)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    return ((await ou(q.order('criado_em', { ascending: false }))) ?? []) as RegistroHistorico[]
  },

  async usuarios(empresaId) {
    let q = sb().from('perfis').select(COLUNAS_PERFIL).order('nome')
    if (empresaId) q = q.eq('empresa_id', empresaId)
    return (((await ou(q)) ?? []) as unknown as LinhaPerfil[]).map(paraPerfil)
  },
  async criarUsuario(d) {
    await funcaoAdmin(sb(), { acao: 'criar', ...d })
  },
  async alterarUsuario(id, d) {
    await ou(sb().from('perfis').update(d).eq('id', id))
  },
  async trocarSenha(id, senha) {
    await funcaoAdmin(sb(), { acao: 'senha', id, senha })
  },

  async empresas() {
    const r = (await ou(sb().rpc('resumo_empresas'))) as Empresa[] | null
    return (r ?? []).map((e) => ({ ...e, usuarios: Number(e.usuarios), prevendas_mes: Number(e.prevendas_mes), total_mes: Number(e.total_mes) }))
  },
  async criarEmpresa(d) {
    const r = await funcaoAdmin(sb(), { acao: 'criar_empresa', ...d })
    return r.id as string
  },
  async alterarEmpresa(id, d) {
    await ou(sb().from('empresas').update(d).eq('id', id))
  },

  async conexoes(empresaId) {
    return ((await ou(sb().from('conexoes_empresa').select('id, empresa_id, dados, atualizado_em').eq('empresa_id', empresaId))) ?? []) as ConexaoNuvem[]
  },
  async salvarConexao(empresaId, dados) {
    await ou(sb().from('conexoes_empresa').upsert({ id: dados.id, empresa_id: empresaId, dados: { ...dados, empresaId } }))
  },
  async excluirConexao(id) {
    await ou(sb().from('conexoes_empresa').delete().eq('id', id))
  },

  async registrarEvento(e) {
    await ou(
      sb().rpc('registrar_evento', {
        p_acao: e.acao,
        p_entidade: e.entidade,
        p_descricao: e.descricao ?? '',
        p_detalhes: e.detalhes ?? {},
        p_chave_local: e.chave_local ?? null,
        p_criado_em: e.criado_em ?? null,
        p_empresa_id: e.empresa_id ?? null
      })
    )
  },
  async eventos({ desde, texto, acao, entidade, empresaId, limite = 1000 }) {
    let q = sb().from('eventos_sistema').select('*, empresas(nome)').order('criado_em', { ascending: false }).limit(limite)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    if (desde) q = q.gte('criado_em', desde)
    if (acao) q = q.eq('acao', acao)
    if (entidade) q = q.eq('entidade', entidade)
    if (texto?.trim()) {
      const t = texto.trim().replace(/[%,()]/g, ' ')
      q = q.or(`descricao.ilike.%${t}%,usuario_nome.ilike.%${t}%,estacao.ilike.%${t}%`)
    }
    return ((await ou(q)) ?? []) as Evento[]
  },

  async backupEmpresa(empresaId) {
    const [empresa, usuarios, conexoes, historico, eventos] = await Promise.all([
      ou(sb().from('empresas').select('*').eq('id', empresaId).maybeSingle()),
      ou(sb().from('perfis').select('id, nome, email, papel, ativo, criado_em').eq('empresa_id', empresaId)),
      ou(sb().from('conexoes_empresa').select('*').eq('empresa_id', empresaId)),
      ou(sb().from('prevendas_geradas').select('*').eq('empresa_id', empresaId).order('criado_em')),
      ou(sb().from('eventos_sistema').select('*').eq('empresa_id', empresaId).order('criado_em'))
    ])
    return {
      formato: 'gerar-pre-venda/backup-empresa',
      versao: 1,
      gerado_em: new Date().toISOString(),
      observacao: 'Senhas não fazem parte do backup (nem dos usuários, nem do SQL).',
      empresa, usuarios, conexoes, historico, eventos
    }
  }
  }
}

/** Sessão normal do programa (fica salva neste computador). */
export const nuvemSupabase: Nuvem = fabricar(sb)

/**
 * Sessão da área administrativa (Ctrl+Shift+B): cliente separado, só em memória.
 * Um administrador pode desbloquear no computador de um operador sem
 * desconectar o operador; o que ele fizer fica no nome dele.
 */
export function criarNuvemAdmin(): Nuvem {
  const c = novoCliente(false)
  return fabricar(() => c)
}
