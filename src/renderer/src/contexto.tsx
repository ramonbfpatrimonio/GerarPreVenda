import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PerfilConexao } from '@shared/tipos'
import { nuvem, type Perfil } from './servicos'

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

// ----------------------------------------------------------------- sessão
interface Sessao {
  perfil: Perfil | null
  carregando: boolean
  erro: string
  entrar(email: string, senha: string): Promise<void>
  sair(): Promise<void>
}
const SessaoCtx = createContext<Sessao>(null as unknown as Sessao)
export const useSessao = () => useContext(SessaoCtx)

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregarPerfil = useCallback(async () => {
    try {
      const p = await nuvem.meuPerfil()
      if (p && !p.ativo) {
        await nuvem.sair()
        setErro('Seu usuário está desativado. Fale com o administrador.')
        setPerfil(null)
      } else setPerfil(p)
    } catch (e) {
      setErro((e as Error).message)
      setPerfil(null)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    if (!nuvem.configurada) {
      setCarregando(false)
      return
    }
    void carregarPerfil()
    return nuvem.aoMudarSessao((logado) => {
      if (!logado) setPerfil(null)
    })
  }, [carregarPerfil])

  const valor = useMemo<Sessao>(
    () => ({
      perfil,
      carregando,
      erro,
      async entrar(email, senha) {
        setErro('')
        await nuvem.entrar(email, senha)
        await carregarPerfil()
      },
      async sair() {
        await nuvem.sair()
        setPerfil(null)
      }
    }),
    [perfil, carregando, erro, carregarPerfil]
  )
  return <SessaoCtx.Provider value={valor}>{children}</SessaoCtx.Provider>
}

// ----------------------------------------------------------------- conexão ativa
export type EstadoConexao = { estado: 'nenhuma' } | { estado: 'verificando' } | { estado: 'on'; driver: string } | { estado: 'off'; erro: string }

interface Conexoes {
  perfis: PerfilConexao[]
  ativa: PerfilConexao | null
  status: EstadoConexao
  selecionar(id: string): void
  recarregar(): Promise<void>
  verificar(): void
}
const ConexoesCtx = createContext<Conexoes>(null as unknown as Conexoes)
export const useConexoes = () => useContext(ConexoesCtx)

const CHAVE_ATIVA = 'conexaoAtiva'
function lerAtiva(): string {
  try {
    return localStorage.getItem(CHAVE_ATIVA) ?? ''
  } catch {
    return ''
  }
}

export function ConexoesProvider({ children }: { children: ReactNode }) {
  const [perfis, setPerfis] = useState<PerfilConexao[]>([])
  const [ativaId, setAtivaId] = useState<string>(lerAtiva)
  const [status, setStatus] = useState<EstadoConexao>({ estado: 'nenhuma' })
  const aviso = useAviso()

  const recarregar = useCallback(async () => {
    try {
      setPerfis(await window.api.conexoes.listar())
    } catch (e) {
      aviso((e as Error).message, 'erro')
    }
  }, [aviso])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  const ativa = perfis.find((p) => p.id === ativaId) ?? null

  const verificar = useCallback(() => {
    if (!ativa) {
      setStatus({ estado: 'nenhuma' })
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

  const selecionar = useCallback((id: string) => {
    setAtivaId(id)
    try {
      localStorage.setItem(CHAVE_ATIVA, id)
    } catch {
      /* sem armazenamento: só não lembra na próxima vez */
    }
  }, [])

  const valor = useMemo(() => ({ perfis, ativa, status, selecionar, recarregar, verificar }), [perfis, ativa, status, selecionar, recarregar, verificar])
  return <ConexoesCtx.Provider value={valor}>{children}</ConexoesCtx.Provider>
}
