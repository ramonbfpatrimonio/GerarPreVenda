// Tudo que fala com o Supabase: login, empresas, usuários, conexões da empresa e histórico.
// A separação entre empresas é garantida no banco (RLS, supabase/migrations/002_empresas.sql);
// os filtros daqui são só para a tela.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DadosConexaoNuvem } from '@shared/tipos'
import type { Licenca } from '@shared/licenca'

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
  licenca?: Licenca | null // situação da cobrança da empresa (guardada também para o acesso offline)
}

export interface ConfigCobranca {
  dias_aviso: number
  dias_tolerancia: number
  contato: string
}

export interface EmpresaCobranca {
  id: string
  nome: string
  cnpj: string
  ativa: boolean
  licenca_valor: number
  licenca_ciclo_meses: number
  licenca_vencimento: string | null
  licenca_obs: string
  ultimo_pagamento: string | null
}

export interface PagamentoLicenca {
  id: number
  empresa_id: string
  pago_em: string
  valor: number
  forma: string
  obs: string
  vencimento_anterior: string | null
  vencimento_novo: string
  criado_em: string
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
  /** Acesso master: super administrador entra com a senha master (Edge Function login-master). */
  entrarMaster(email: string, senha: string): Promise<void>
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
  // cobrança da licença
  licenca(empresaId?: string | null): Promise<Licenca | null>
  configCobranca(): Promise<ConfigCobranca>
  salvarConfigCobranca(d: ConfigCobranca): Promise<void>
  empresasCobranca(): Promise<EmpresaCobranca[]>
  alterarLicenca(id: string, d: Partial<Pick<EmpresaCobranca, 'licenca_valor' | 'licenca_ciclo_meses' | 'licenca_vencimento' | 'licenca_obs'>>): Promise<void>
  pagamentos(empresaId: string): Promise<PagamentoLicenca[]>
  registrarPagamento(d: { empresaId: string; pagoEm: string; valor: number; forma: string; obs: string }): Promise<string>
  estornarPagamento(id: number): Promise<string | null>
  // conexões da empresa
  conexoes(empresaId: string): Promise<ConexaoNuvem[]>
  salvarConexao(empresaId: string, dados: DadosConexaoNuvem): Promise<void>
  excluirConexao(id: string): Promise<void>
  // eventos do sistema
  registrarEvento(e: NovoEvento): Promise<void>
  eventos(filtro: { desde?: string; texto?: string; acao?: string; entidade?: string; empresaId?: string | null; limite?: number }): Promise<Evento[]>
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

// O login vale só enquanto o programa está aberto: a sessão fica no
// sessionStorage, que some quando o programa é fechado (ao reabrir, pede login).
// Também apaga a sessão que versões antigas guardavam no localStorage.
try {
  Object.keys(localStorage).filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token')).forEach((k) => localStorage.removeItem(k))
} catch { /* sem acesso ao armazenamento: segue */ }

function novoCliente(persistir: boolean): SupabaseClient {
  return createClient(URL, CHAVE, {
    auth: persistir
      ? { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage }
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
    const arquivo = /licenca|cobranca|pagamento/i.test(falta[1]) ? '004_cobranca.sql' : /evento/i.test(falta[1]) ? '003_eventos.sql' : /empresa|conexoes_empresa|resumo/i.test(falta[1]) ? '002_empresas.sql' : '001_inicial.sql'
    return `O banco na nuvem ainda não foi atualizado (falta "${falta[1]}"). No Supabase, abra o SQL Editor e rode supabase/migrations/${arquivo}.`
  }
  if (/column [\w.]*licenca_\w+ does not exist/i.test(msg))
    return 'O banco na nuvem ainda não foi atualizado para a cobrança. No Supabase, abra o SQL Editor e rode supabase/migrations/004_cobranca.sql.'
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
  async entrarMaster(email, senha) {
    let token: string
    try {
      const { data, error } = await sb().functions.invoke('login-master', { body: { email: email.trim(), senha } })
      if (error) {
        // a função devolve { erro } no corpo das respostas 4xx
        const ctx = (error as { context?: Response }).context
        const corpo = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
        if (corpo?.erro) throw new Error(corpo.erro)
        if (/not found|404/i.test(error.message)) throw new Error('A função login-master ainda não foi publicada no Supabase (Edge Functions).')
        throw new Error(traduzir(error.message))
      }
      if (data?.erro) throw new Error(data.erro)
      token = data?.token_hash
    } catch (e) {
      throw new Error(traduzir((e as Error).message))
    }
    if (!token) throw new Error('Não foi possível entrar com a senha master.')
    const { error } = await sb().auth.verifyOtp({ token_hash: token, type: 'magiclink' })
    if (error) throw new Error(traduzir(error.message))
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
    if (!p) return null
    const perfil = paraPerfil(p)
    if (perfil.papel !== 'super_admin' && perfil.empresa_id) {
      // Sem a migração 004 ainda: entra normalmente, sem cobrança
      perfil.licenca = await this.licenca().catch((e) => {
        if (ehErroDeRede(e)) throw e
        return null
      })
    }
    return perfil
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

  async licenca(empresaId) {
    const r = (await ou(sb().rpc('minha_licenca', { p_empresa: empresaId ?? null }))) as Licenca[] | null
    const l = r?.[0]
    return l ? { ...l, valor: Number(l.valor) } : null
  },
  async configCobranca() {
    const c = (await ou(sb().from('config_cobranca').select('dias_aviso, dias_tolerancia, contato').eq('id', 1).maybeSingle())) as ConfigCobranca | null
    return c ?? { dias_aviso: 5, dias_tolerancia: 3, contato: '' }
  },
  async salvarConfigCobranca(d) {
    await ou(sb().from('config_cobranca').update({ ...d, atualizado_em: new Date().toISOString() }).eq('id', 1))
  },
  async empresasCobranca() {
    const es = ((await ou(sb().from('empresas').select('id, nome, cnpj, ativa, licenca_valor, licenca_ciclo_meses, licenca_vencimento, licenca_obs').order('nome'))) ?? []) as EmpresaCobranca[]
    const pg = ((await ou(sb().from('pagamentos_licenca').select('empresa_id, pago_em').order('pago_em', { ascending: false }))) ?? []) as { empresa_id: string; pago_em: string }[]
    return es.map((e) => ({ ...e, licenca_valor: Number(e.licenca_valor), ultimo_pagamento: pg.find((x) => x.empresa_id === e.id)?.pago_em ?? null }))
  },
  async alterarLicenca(id, d) {
    await ou(sb().from('empresas').update(d).eq('id', id))
  },
  async pagamentos(empresaId) {
    const r = ((await ou(sb().from('pagamentos_licenca').select('*').eq('empresa_id', empresaId).order('id', { ascending: false }))) ?? []) as PagamentoLicenca[]
    return r.map((x) => ({ ...x, valor: Number(x.valor) }))
  },
  async registrarPagamento(d) {
    return (await ou(sb().rpc('registrar_pagamento', { p_empresa: d.empresaId, p_pago_em: d.pagoEm, p_valor: d.valor, p_forma: d.forma, p_obs: d.obs }))) as string
  },
  async estornarPagamento(id) {
    return (await ou(sb().rpc('estornar_pagamento', { p_id: id }))) as string | null
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
