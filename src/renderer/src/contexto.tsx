import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PerfilConexao } from '@shared/tipos'
import { ehErroDeRede, nuvem, type Empresa, type NovoEvento, type Nuvem, type Perfil, type RegistroHistorico } from './servicos'
import type { AparenciaLocal } from '../../preload/api'

// ----------------------------------------------------------------- avisos
type TipoAviso = 'info' | 'ok' | 'erro'
interface Aviso { id: number; texto: string; tipo: TipoAviso }
const AvisosCtx = createContext<(texto: string, tipo?: TipoAviso) => void>(() => undefined)
export const useAviso = () => useContext(AvisosCtx)

export function AvisosProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Aviso[]>([])
  const seq = useRef(0)
  const avisar = useCallback((texto: string, tipo: TipoAviso = 'info') => {
    const id = ++seq.current
    setLista((l) => [...l, { id, texto, tipo }])
    setTimeout(() => setLista((l) => l.filter((a) => a.id !== id)), tipo === 'erro' ? 8000 : 4000)
  }, [])
  return (
    <AvisosCtx.Provider value={avisar}>
      {children}
      <div className="avisos-flutuantes" role="status" aria-live="polite">
        {lista.map((a) => (
          <div key={a.id} className={`aviso-flutuante ${a.tipo}`}>{a.texto}</div>
        ))}
      </div>
    </AvisosCtx.Provider>
  )
}

// ----------------------------------------------------------------- sessão, empresa, internet e fila
export interface EmpresaAtual { id: string; nome: string }

interface Sessao {
  perfil: Perfil | null
  offline: boolean // entrou sem internet (com o acesso guardado neste computador)
  internet: boolean
  carregando: boolean
  erro: string
  // empresa em que se está trabalhando (super_admin escolhe; os demais têm a sua)
  empresaAtual: EmpresaAtual | null
  empresas: Empresa[]
  escolherEmpresa(id: string): void
  recarregarEmpresas(): Promise<void>
  // fila do histórico (pré-vendas geradas sem internet)
  pendentes: number
  registrarNoHistorico(r: RegistroHistorico): Promise<'enviado' | 'na-fila'>
  /** Registra um evento do sistema (vai para a fila se estiver sem internet). */
  registrarEvento(e: NovoEvento, via?: Nuvem | null): Promise<void>
  aparencia: AparenciaLocal | null
  recarregarAparencia(): Promise<void>
  entrar(email: string, senha: string): Promise<void>
  sair(): Promise<void>
  ehSuper: boolean
  ehAdmin: boolean
}
const SessaoCtx = createContext<Sessao>(null as unknown as Sessao)
export const useSessao = () => useContext(SessaoCtx)

const CHAVE_EMPRESA = 'empresaAtual'
const lerLocal = (k: string) => {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}
const gravarLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [offline, setOffline] = useState(false)
  const [internet, setInternet] = useState(true)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaEscolhida, setEmpresaEscolhida] = useState(lerLocal(CHAVE_EMPRESA))
  const [pendentes, setPendentes] = useState(0)
  const enviando = useRef(false)
  const avisar = useAviso()

  /** Bloqueios que valem online: usuário desativado ou empresa suspensa. */
  const validar = useCallback(async (p: Perfil | null): Promise<Perfil | null> => {
    if (!p) return null
    let motivo = ''
    if (!p.ativo) motivo = 'Seu usuário está desativado. Fale com o administrador.'
    else if (p.papel !== 'super_admin' && !p.empresa_id) motivo = 'Seu usuário não está ligado a nenhuma empresa. Fale com o administrador.'
    else if (p.papel !== 'super_admin' && !p.empresa_ativa) motivo = 'Acesso da empresa suspenso. Fale com o suporte.'
    if (motivo) {
      await window.api.offline.esquecer(p.email).catch(() => undefined)
      await nuvem.sair()
      setErro(motivo)
      return null
    }
    await window.api.offline.atualizarPerfil(p).catch(() => undefined)
    return p
  }, [])

  const carregarPerfil = useCallback(async () => {
    try {
      setPerfil(await validar(await nuvem.meuPerfil()))
      setOffline(false)
    } catch (e) {
      if (ehErroDeRede(e)) {
        // Sessão salva + sem internet: segue com o perfil guardado (se ainda no prazo)
        const id = await nuvem.usuarioAtualId().catch(() => null)
        const guardado = id ? await window.api.offline.perfilPorId(id).catch(() => null) : null
        if (guardado) {
          setPerfil(guardado as Perfil)
          setOffline(true)
          setInternet(false)
        } else setPerfil(null)
      } else {
        setErro((e as Error).message)
        setPerfil(null)
      }
    } finally {
      setCarregando(false)
    }
  }, [validar])

  useEffect(() => {
    void carregarPerfil()
    return nuvem.aoMudarSessao((logado) => {
      if (!logado) setPerfil((p) => (offline ? p : null))
    })
  }, [carregarPerfil]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- internet: eventos do sistema + teste periódico
  useEffect(() => {
    let vivo = true
    const testar = async () => {
      const ok = navigator.onLine && (await nuvem.online())
      if (vivo) setInternet(ok)
    }
    void testar()
    const t = setInterval(testar, 30_000)
    const on = () => void testar()
    const off = () => setInternet(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      vivo = false
      clearInterval(t)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // ---- fila do histórico
  const atualizarPendentes = useCallback(async () => {
    setPendentes((await window.api.fila.listar().catch(() => [])).filter((r) => r._tipo !== 'evento').length)
  }, [])

  const esvaziarFila = useCallback(async () => {
    if (enviando.current) return
    enviando.current = true
    try {
      const fila = await window.api.fila.listar()
      if (!fila.length) return
      if (!(await nuvem.usuarioAtualId())) return // entrou offline sem sessão: envia no próximo login online
      const enviados: string[] = []
      for (const r of fila) {
        try {
          const { _tipo, ...dados } = r
          if (_tipo === 'evento') await nuvem.registrarEvento(dados as unknown as NovoEvento)
          else await nuvem.registrarPreVenda(dados as unknown as RegistroHistorico)
          enviados.push(r.chave_local)
        } catch (e) {
          if (ehErroDeRede(e)) break
        }
      }
      if (enviados.length) {
        await window.api.fila.remover(enviados)
        const pv = fila.filter((r) => enviados.includes(r.chave_local) && r._tipo !== 'evento').length
        if (pv) avisar(`${pv} pré-venda(s) gerada(s) sem internet entraram no histórico.`, 'ok')
      }
    } finally {
      enviando.current = false
      void atualizarPendentes()
    }
  }, [avisar, atualizarPendentes])

  useEffect(() => {
    void atualizarPendentes()
  }, [atualizarPendentes])

  // Internet voltou: confirma o perfil (bloqueios), sai do modo offline e envia a fila
  useEffect(() => {
    if (!perfil || !internet) return
    if (offline) {
      void (async () => {
        if (await nuvem.usuarioAtualId()) {
          await carregarPerfil()
          void esvaziarFila()
        }
      })()
    } else void esvaziarFila()
  }, [internet, perfil?.id, offline]) // eslint-disable-line react-hooks/exhaustive-deps

  const registrarNoHistorico = useCallback(
    async (r: RegistroHistorico): Promise<'enviado' | 'na-fila'> => {
      const registro = { ...r, chave_local: r.chave_local ?? crypto.randomUUID(), criado_em: r.criado_em ?? new Date().toISOString() }
      try {
        if (!internet || offline) throw new Error('Sem conexão com a internet.')
        await nuvem.registrarPreVenda(registro)
        return 'enviado'
      } catch (e) {
        if (!ehErroDeRede(e)) throw e
        await window.api.fila.adicionar(registro as unknown as Record<string, unknown> & { chave_local: string })
        void atualizarPendentes()
        return 'na-fila'
      }
    },
    [internet, offline, atualizarPendentes]
  )

  const registrarEvento = useCallback(
    async (e: NovoEvento, via?: Nuvem | null) => {
      const ev = { ...e, chave_local: e.chave_local ?? crypto.randomUUID(), criado_em: e.criado_em ?? new Date().toISOString() }
      try {
        if (!internet || offline) throw new Error('Sem conexão com a internet.')
        await (via ?? nuvem).registrarEvento(ev)
      } catch (err) {
        if (!ehErroDeRede(err)) return // evento nunca impede a operação
        await window.api.fila.adicionar({ ...(ev as unknown as Record<string, unknown>), chave_local: ev.chave_local, _tipo: 'evento' }).catch(() => undefined)
      }
    },
    [internet, offline]
  )

  // ---- aparência (fundo e logo da empresa): cópia local para a tela de login
  const [aparencia, setAparencia] = useState<AparenciaLocal | null>(null)
  useEffect(() => {
    window.api.aparencia.ler().then(setAparencia).catch(() => undefined)
  }, [])

  // ---- empresas
  const ehSuper = perfil?.papel === 'super_admin'
  const recarregarEmpresas = useCallback(async () => {
    if (!ehSuper || offline) return
    try {
      setEmpresas(await nuvem.empresas())
    } catch (e) {
      if (!ehErroDeRede(e)) avisar((e as Error).message, 'erro')
    }
  }, [ehSuper, offline, avisar])
  useEffect(() => {
    void recarregarEmpresas()
  }, [recarregarEmpresas])

  const empresaAtual: EmpresaAtual | null = useMemo(() => {
    if (!perfil) return null
    if (!ehSuper) return perfil.empresa_id ? { id: perfil.empresa_id, nome: perfil.empresa_nome } : null
    const e = empresas.find((x) => x.id === empresaEscolhida) ?? empresas[0]
    if (e) return { id: e.id, nome: e.nome }
    // offline: lembra a última escolhida
    return empresaEscolhida ? { id: empresaEscolhida, nome: lerLocal(CHAVE_EMPRESA + ':nome') || 'Empresa' } : null
  }, [perfil, ehSuper, empresas, empresaEscolhida])

  const escolherEmpresa = useCallback(
    (id: string) => {
      setEmpresaEscolhida(id)
      gravarLocal(CHAVE_EMPRESA, id)
      const e = empresas.find((x) => x.id === id)
      if (e) gravarLocal(CHAVE_EMPRESA + ':nome', e.nome)
    },
    [empresas]
  )

  const recarregarAparencia = useCallback(async () => {
    if (!empresaAtual || !internet || offline) return
    try {
      const a = await nuvem.aparencia(empresaAtual.id)
      const local: AparenciaLocal | null = a
        ? { empresaId: empresaAtual.id, empresaNome: empresaAtual.nome, fundo: a.fundo, logo: a.logo, atualizadoEm: a.atualizado_em }
        : null
      await window.api.aparencia.salvar(local)
      setAparencia(local)
    } catch {
      /* mantém a cópia local */
    }
  }, [empresaAtual?.id, internet, offline]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void recarregarAparencia()
  }, [recarregarAparencia])

  const valor = useMemo<Sessao>(
    () => ({
      perfil,
      offline,
      internet: internet && !offline,
      carregando,
      erro,
      empresaAtual,
      empresas,
      escolherEmpresa,
      recarregarEmpresas,
      pendentes,
      registrarNoHistorico,
      registrarEvento,
      aparencia,
      recarregarAparencia,
      ehSuper,
      ehAdmin: ehSuper || perfil?.papel === 'admin',
      async entrar(email, senha) {
        setErro('')
        try {
          await nuvem.entrar(email, senha)
        } catch (e) {
          if (!ehErroDeRede(e)) throw e
          // Sem internet: tenta o acesso guardado neste computador
          const p = (await window.api.offline.entrar(email, senha)) as Perfil
          setPerfil(p)
          setOffline(true)
          setInternet(false)
          await window.api.fila
            .adicionar({ _tipo: 'evento', chave_local: crypto.randomUUID(), criado_em: new Date().toISOString(), acao: 'entrou', entidade: 'sessão', descricao: 'Entrou no programa sem internet (acesso offline)' })
            .catch(() => undefined)
          return
        }
        const p = await validar(await nuvem.meuPerfil())
        if (p) {
          await window.api.offline.lembrar(email, senha, p).catch(() => undefined)
          void nuvem.registrarEvento({ acao: 'entrou', entidade: 'sessão', descricao: 'Entrou no programa', chave_local: crypto.randomUUID() }).catch(() => undefined)
        }
        setPerfil(p)
        setOffline(false)
      },
      async sair() {
        await registrarEvento({ acao: 'saiu', entidade: 'sessão', descricao: 'Saiu do programa' })
        await nuvem.sair()
        setPerfil(null)
        setOffline(false)
      }
    }),
    [perfil, offline, internet, carregando, erro, empresaAtual, empresas, escolherEmpresa, recarregarEmpresas, pendentes, registrarNoHistorico, registrarEvento, aparencia, recarregarAparencia, ehSuper, validar]
  )
  return <SessaoCtx.Provider value={valor}>{children}</SessaoCtx.Provider>
}

// ----------------------------------------------------------------- conexões da empresa
export type EstadoConexao =
  | { estado: 'nenhuma' }
  | { estado: 'verificando' }
  | { estado: 'on'; driver: string }
  | { estado: 'off'; erro: string }
  | { estado: 'sem-senha' }

interface Conexoes {
  perfis: PerfilConexao[] // conexões da empresa atual (cópia local com as senhas deste PC)
  ativos: PerfilConexao[] // só as ativas (as desativadas somem da faixa superior e do pedido)
  locais: PerfilConexao[] // conexões antigas, só deste computador (sem empresa)
  ativa: PerfilConexao | null
  status: EstadoConexao
  sincronizadoComNuvem: boolean
  selecionar(id: string): void
  recarregar(): Promise<void>
  verificar(): void
}
const ConexoesCtx = createContext<Conexoes>(null as unknown as Conexoes)
export const useConexoes = () => useContext(ConexoesCtx)

export function ConexoesProvider({ children }: { children: ReactNode }) {
  const { empresaAtual, internet } = useSessao()
  const [todas, setTodas] = useState<PerfilConexao[]>([])
  const [sincronizado, setSincronizado] = useState(false)
  const chaveAtiva = `conexaoAtiva:${empresaAtual?.id ?? ''}`
  const [ativaId, setAtivaId] = useState<string>(() => lerLocal(chaveAtiva))
  const [status, setStatus] = useState<EstadoConexao>({ estado: 'nenhuma' })
  const avisar = useAviso()

  useEffect(() => setAtivaId(lerLocal(chaveAtiva)), [chaveAtiva])

  const recarregar = useCallback(async () => {
    if (empresaAtual && internet) {
      try {
        const daNuvem = await nuvem.conexoes(empresaAtual.id)
        await window.api.conexoes.sincronizar(
          empresaAtual.id,
          daNuvem.map((c) => ({ ...c.dados, id: c.id, empresaId: empresaAtual.id }))
        )
        setSincronizado(true)
      } catch (e) {
        setSincronizado(false)
        if (!ehErroDeRede(e)) avisar(`Não foi possível ler as conexões da empresa: ${(e as Error).message}`, 'erro')
      }
    } else setSincronizado(false)
    try {
      setTodas(await window.api.conexoes.listar())
    } catch (e) {
      avisar((e as Error).message, 'erro')
    }
  }, [empresaAtual?.id, internet, avisar]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  const perfis = useMemo(() => todas.filter((p) => empresaAtual && p.empresaId === empresaAtual.id), [todas, empresaAtual])
  const locais = useMemo(() => todas.filter((p) => !p.empresaId), [todas])
  const ativos = useMemo(() => perfis.filter((p) => p.ativo !== false), [perfis])
  const ativa = ativos.find((p) => p.id === ativaId) ?? null

  const verificar = useCallback(() => {
    if (!ativa) {
      setStatus({ estado: 'nenhuma' })
      return
    }
    if (ativa.autenticacao === 'sql' && !ativa.temSenha) {
      setStatus({ estado: 'sem-senha' })
      return
    }
    setStatus({ estado: 'verificando' })
    window.api.erp
      .status(ativa.id)
      .then((driver) => setStatus({ estado: 'on', driver }))
      .catch((e: Error) => setStatus({ estado: 'off', erro: e.message }))
  }, [ativa])

  useEffect(() => {
    verificar()
    const t = setInterval(verificar, 90_000)
    return () => clearInterval(t)
  }, [verificar])

  useEffect(() => {
    document.documentElement.style.setProperty('--banco', ativa?.cor ?? '#5a6472')
  }, [ativa?.cor])

  const selecionar = useCallback(
    (id: string) => {
      setAtivaId(id)
      gravarLocal(chaveAtiva, id)
    },
    [chaveAtiva]
  )

  const valor = useMemo(
    () => ({ perfis, ativos, locais, ativa, status, sincronizadoComNuvem: sincronizado, selecionar, recarregar, verificar }),
    [perfis, ativos, locais, ativa, status, sincronizado, selecionar, recarregar, verificar]
  )
  return <ConexoesCtx.Provider value={valor}>{children}</ConexoesCtx.Provider>
}
