import { useEffect, useState } from 'react'
import { useSessao } from '../contexto'
import { nuvem } from '../servicos'
import { Alerta } from '../componentes/Modal'
import { FundoLogin } from '../componentes/FundoLogin'
import logoPadrao from '../assets/logo.png'

/**
 * Login: fundo à esquerda (3/4 da tela) e formulário à direita.
 * Fundo e logo são os da última empresa que usou este computador (aba Aparência);
 * sem isso, ficam os padrões do programa.
 */
export function Pagina_Login() {
  const { entrar, erro, aparencia, bloqueioLicenca, liberarComMaster } = useSessao()
  const [suporte, setSuporte] = useState('')
  const [liberando, setLiberando] = useState(false)
  const [liberadoMsg, setLiberadoMsg] = useState('')
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

  // Empresa bloqueada pela cobrança: o suporte libera o dia com a senha master
  const liberar = async (e: React.FormEvent) => {
    e.preventDefault()
    setFalha('')
    setLiberando(true)
    try {
      if (!(await liberarComMaster(suporte))) {
        setFalha('Senha do suporte incorreta.')
        return
      }
      setSuporte('')
      if (email && senha) {
        setEntrando(true)
        await entrar(email, senha)
      } else setLiberadoMsg('Uso liberado até o fim do dia. Entre com seu e-mail e senha.')
    } catch (err) {
      setFalha((err as Error).message)
    } finally {
      setLiberando(false)
      setEntrando(false)
    }
  }
  const mostrarLiberacao = !!bloqueioLicenca && /Licença vencida/.test(falha || erro)

  return (
    <div className="login">
      <FundoLogin src={aparencia?.fundo} ajuste={aparencia?.ajuste} rotulo={aparencia?.empresaNome || 'Gerar Pré-Venda'} />
      <form className="lado-form" onSubmit={enviar}>
        <img className="logo-login" src={aparencia?.logo || logoPadrao} alt={aparencia?.empresaNome ?? 'Gerar Pré-Venda'} />
        <h1>Gerar Pré-Venda</h1>
        {(falha || erro) && <Alerta tipo="erro">{falha || erro}</Alerta>}
        {liberadoMsg && !falha && !erro && <Alerta tipo="ok">{liberadoMsg}</Alerta>}
        {mostrarLiberacao && (
          <div className="liberacao-suporte">
            <span>Liberação pelo suporte (vale só hoje)</span>
            <div>
              <input className="entrada" type="password" placeholder="Senha do suporte" value={suporte} onChange={(e) => setSuporte(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void liberar(e)} autoComplete="off" />
              <button type="button" className="botao" onClick={(e) => void liberar(e)} disabled={liberando || !suporte}>{liberando ? <span className="spinner" /> : null} Liberar</button>
            </div>
          </div>
        )}
        <label className="campo"><span>E-mail</span><input className="entrada" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></label>
        <label className="campo"><span>Senha</span><input className="entrada" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" /></label>
        <button className="botao primario grande" type="submit" disabled={entrando || !senha || !nuvem.configurada}>
          {entrando ? <span className="spinner" /> : null} Entrar
        </button>
        <div className="rodape-login">Versão {versao}</div>
      </form>
    </div>
  )
}
