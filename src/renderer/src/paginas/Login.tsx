import { useState } from 'react'
import { useSessao } from '../contexto'
import { nuvem } from '../servicos'
import { Alerta } from '../componentes/Modal'

export function Pagina_Login() {
  const { entrar, erro } = useSessao()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [falha, setFalha] = useState('')
  const [entrando, setEntrando] = useState(false)

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
      <form className="lado-form" onSubmit={enviar}>
        <div>
          <h1>Gerar Pré-Venda</h1>
          <p className="fraco">Entre com o seu usuário. O mesmo login funciona em qualquer computador.</p>
        </div>
        {!nuvem.configurada && (
          <Alerta tipo="erro">Este programa foi gerado sem o endereço do Supabase. Configure o arquivo .env (veja o LEIAME) e gere o instalador de novo.</Alerta>
        )}
        {(falha || erro) && <Alerta tipo="erro">{falha || erro}</Alerta>}
        <label className="campo"><span>E-mail</span><input className="entrada" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></label>
        <label className="campo"><span>Senha</span><input className="entrada" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" /></label>
        <button className="botao primario grande" type="submit" disabled={entrando || !email || !senha || !nuvem.configurada}>
          {entrando ? <span className="spinner" /> : null} Entrar
        </button>
      </form>
      <div className="lado-info">
        <h2 style={{ color: 'var(--tinta)' }}>Um programa, o banco de cada cliente</h2>
        <p>Cada cliente tem a sua conexão e a sua cor. A faixa no topo da tela mostra o tempo todo em qual banco a pré-venda vai ser gravada.</p>
        <div className="faixas" aria-hidden="true">
          <div className="faixa-exemplo" style={{ background: '#1f5f9e' }}>Hage › COMERCIO</div>
          <div className="faixa-exemplo" style={{ background: '#7a3fb5' }}>Hage › INDUSTRIA</div>
          <div className="faixa-exemplo" style={{ background: '#0e7c5a' }}>Outro cliente › Matriz</div>
        </div>
      </div>
    </div>
  )
}
