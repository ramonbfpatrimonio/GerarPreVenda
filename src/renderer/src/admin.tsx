// Área administrativa oculta (Ctrl+Shift+B).
//
// Conexões, Usuários, Eventos do sistema, Aparência e Empresas só
// aparecem depois que um administrador informa e-mail e senha. A sessão
// administrativa é separada da sessão de quem está usando o programa: um
// administrador pode desbloquear no computador de um operador sem desconectá-lo,
// e tudo o que fizer fica registrado no nome dele. Fecha sozinha após 10 minutos
// sem uso.
//
// Super administrador logado: tudo liberado direto, sem atalho e sem tempo limite
// (usa a própria sessão dele).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { criarNuvemAdmin, ehErroDeRede, nuvem as nuvemSessao, type NovoEvento, type Nuvem, type Perfil } from './servicos'
import { useAviso, useSessao } from './contexto'
import { Alerta, Modal } from './componentes/Modal'

const MINUTOS_INATIVO = 10

interface Admin {
  perfil: Perfil | null // administrador que desbloqueou
  nuvem: Nuvem | null // cliente da sessão administrativa (null = sem internet)
  ehSuper: boolean
  /** true quando liberado direto (super administrador logado): não tem "Fechar" */
  automatico: boolean
  abrirLogin(): void
  fechar(motivo?: string): void
  /** Evento feito pelo administrador (fica no nome dele). */
  registrar(e: NovoEvento): Promise<void>
}

const AdminCtx = createContext<Admin>(null as unknown as Admin)
export const useAdmin = () => useContext(AdminCtx)

export function AdminProvider({ children }: { children: ReactNode }) {
  const { perfil: logado, empresaAtual, registrarEvento, internet, offline } = useSessao()
  const superLogado = logado?.papel === 'super_admin' && logado.ativo
  const avisar = useAviso()
  const [adm, setAdm] = useState<{ perfil: Perfil; nuvem: Nuvem | null } | null>(null)
  const [modal, setModal] = useState(false)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)
  const ultimoUso = useRef(Date.now())

  const admRef = useRef(adm)
  useEffect(() => {
    admRef.current = adm
  }, [adm])

  const fechar = useCallback(
    (motivo?: string) => {
      const atual = admRef.current
      if (!atual) return
      admRef.current = null
      void registrarEvento({ acao: 'saiu', entidade: 'área administrativa', descricao: `${atual.perfil.nome} fechou a área administrativa${motivo ? ` (${motivo})` : ''}` }, atual.nuvem)
      void atual.nuvem?.sair()
      setAdm(null)
      if (motivo) avisar(`Área administrativa fechada: ${motivo}.`, 'info')
    },
    [registrarEvento, avisar]
  )

  const abrirLogin = useCallback(() => {
    setErro('')
    setSenha('')
    setEmail((e) => e || (logado && logado.papel !== 'operador' ? logado.email : ''))
    setModal(true)
  }, [logado])

  // Ctrl+Shift+B
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b' || e.code === 'KeyB')) {
        e.preventDefault()
        if (!adm && !superLogado) abrirLogin()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [adm, abrirLogin, superLogado])

  // Fecha sozinha após 10 minutos sem uso
  useEffect(() => {
    if (!adm) return
    const mexeu = () => (ultimoUso.current = Date.now())
    const eventos = ['mousemove', 'mousedown', 'keydown', 'wheel']
    eventos.forEach((ev) => window.addEventListener(ev, mexeu, { passive: true }))
    const t = setInterval(() => {
      if (Date.now() - ultimoUso.current > MINUTOS_INATIVO * 60_000) fechar(`${MINUTOS_INATIVO} minutos sem uso`)
    }, 15_000)
    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, mexeu))
      clearInterval(t)
    }
  }, [adm, fechar])

  // Quem está logado saiu ou trocou: fecha a área administrativa
  useEffect(() => {
    if (!logado && adm) fechar()
  }, [logado]) // eslint-disable-line react-hooks/exhaustive-deps

  const entrar = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro('')
    setEntrando(true)
    try {
      let perfil: Perfil | null = null
      let nuvemAdm: Nuvem | null = null
      try {
        if (!internet) throw new Error('Sem conexão com a internet.')
        nuvemAdm = criarNuvemAdmin()
        await nuvemAdm.entrar(email, senha)
        perfil = await nuvemAdm.meuPerfil()
      } catch (e) {
        if (!ehErroDeRede(e)) throw e
        // Sem internet: só quem já entrou neste computador (acesso offline)
        perfil = (await window.api.offline.entrar(email, senha)) as Perfil
        nuvemAdm = null
      }
      if (!perfil) throw new Error('E-mail ou senha incorretos.')
      const motivo =
        !perfil.ativo ? 'usuário desativado'
        : perfil.papel === 'operador' ? 'este usuário não é administrador'
        : perfil.papel !== 'super_admin' && !perfil.empresa_ativa ? 'empresa bloqueada'
        : perfil.papel !== 'super_admin' && empresaAtual && perfil.empresa_id !== empresaAtual.id ? `este administrador não é da empresa ${empresaAtual.nome}`
        : ''
      if (motivo) {
        await nuvemAdm?.sair()
        void registrarEvento({ acao: 'negou', entidade: 'área administrativa', descricao: `Acesso negado para ${email.trim()}: ${motivo}` })
        throw new Error(`Acesso negado: ${motivo}.`)
      }
      if (nuvemAdm) await window.api.offline.lembrar(email, senha, perfil).catch(() => undefined)
      ultimoUso.current = Date.now()
      setAdm({ perfil, nuvem: nuvemAdm })
      setModal(false)
      setSenha('')
      void registrarEvento(
        { acao: 'acessou', entidade: 'área administrativa', descricao: `${perfil.nome} abriu a área administrativa${logado && logado.id !== perfil.id ? ` no computador de ${logado.nome}` : ''}${nuvemAdm ? '' : ' (sem internet)'}` },
        nuvemAdm
      )
      avisar(nuvemAdm ? `Área administrativa liberada para ${perfil.nome}.` : `Área administrativa liberada sem internet: só as configurações deste computador.`, 'ok')
    } catch (e) {
      const m = (e as Error).message
      if (/incorretos|Invalid login/i.test(m)) void registrarEvento({ acao: 'negou', entidade: 'área administrativa', descricao: `Senha incorreta para ${email.trim()}` })
      setErro(m)
    } finally {
      setEntrando(false)
    }
  }

  const valor = useMemo<Admin>(() => {
    if (superLogado && logado) {
      const n = internet && !offline ? nuvemSessao : null
      return { perfil: logado, nuvem: n, ehSuper: true, automatico: true, abrirLogin, fechar: () => undefined, registrar: (e) => registrarEvento(e) }
    }
    return {
      perfil: adm?.perfil ?? null,
      nuvem: adm?.nuvem ?? null,
      ehSuper: adm?.perfil.papel === 'super_admin',
      automatico: false,
      abrirLogin,
      fechar,
      registrar: (e) => registrarEvento(e, adm?.nuvem)
    }
  }, [adm, abrirLogin, fechar, registrarEvento, superLogado, logado, internet, offline])

  return (
    <AdminCtx.Provider value={valor}>
      {children}
      <Modal aberto={modal} aoFechar={() => !entrando && setModal(false)} rotulo="Área administrativa">
        <form onSubmit={entrar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <h2>Área administrativa</h2>
            <p className="fraco mini">Conexões, usuários, eventos e aparência. Informe o login de um administrador.</p>
          </div>
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          <label className="campo"><span>E-mail</span><input className="entrada" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!email} autoComplete="off" /></label>
          <label className="campo"><span>Senha</span><input className="entrada" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus={!!email} autoComplete="off" /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="botao" onClick={() => setModal(false)} disabled={entrando}>Cancelar</button>
            <button type="submit" className="botao primario" disabled={entrando || !email || !senha}>{entrando ? <span className="spinner" /> : null} Liberar</button>
          </div>
        </form>
      </Modal>
    </AdminCtx.Provider>
  )
}
