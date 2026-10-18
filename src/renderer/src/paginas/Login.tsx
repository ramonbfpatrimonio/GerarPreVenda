import { useEffect, useState } from 'react'
import { useSessao } from '../contexto'
import { nuvem } from '../servicos'
import { Alerta } from '../componentes/Modal'
import fundoPadrao from '../assets/fundo-padrao.jpg'
import logoPadrao from '../assets/logo.png'

/**
 * Login: fundo à esquerda (3/4 da tela) e formulário à direita.
 * Fundo e logo são os da última empresa que usou este computador (aba Aparência);
 * sem isso, ficam os padrões do programa.
 */
export function Pagina_Login() {
  const { entrar, erro, aparencia } = useSessao()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [falha, setFalha] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [versao, setVersao] = useState('')

  useEffect(() => {
    window.api.atualizacao.versao().then(setVersao).catch(() => undefined)
  }, [])

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setFalha('')
    setEntrando(true)
    try {
      await entrar(email, senha)
    } catch (err) {
      setFalha((err as Error).message)
    } finally {
      setEntrando(false)
    }
  }

  return (
    <div className="login">
      <div className="fundo-login" style={{ backgroundImage: `url(${aparencia?.fundo || fundoPadrao})` }} role="img" aria-label={aparencia?.empresaNome ?? 'Gerar Pré-Venda'} />
      <form className="lado-form" onSubmit={enviar}>
        <img className="logo-login" src={aparencia?.logo || logoPadrao} alt={aparencia?.empresaNome ?? 'Gerar Pré-Venda'} />
        <div>
          <h1>Gerar Pré-Venda</h1>
          <p className="fraco">{aparencia?.empresaNome ? `Entre para trabalhar em ${aparencia.empresaNome}.` : 'Entre com o seu usuário.'}</p>
        </div>
        {(falha || erro) && <Alerta tipo="erro">{falha || erro}</Alerta>}
        <label className="campo"><span>E-mail</span><input className="entrada" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></label>
        <label className="campo"><span>Senha</span><input className="entrada" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" /></label>
        <button className="botao primario grande" type="submit" disabled={entrando || !email || !senha || !nuvem.configurada}>
          {entrando ? <span className="spinner" /> : null} Entrar
        </button>
        <div className="rodape-login">Versão {versao}</div>
      </form>
    </div>
  )
}
