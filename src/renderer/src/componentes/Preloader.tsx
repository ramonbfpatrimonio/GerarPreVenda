import { useEffect, useState } from 'react'
import logo from '../assets/logo.png'

export const DURACAO_PRELOADER = 4000

/** Tela de abertura: logo pulsando e barra que enche em 4 segundos. */
export function Preloader({ saindo }: { saindo: boolean }) {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const inicio = performance.now()
    let quadro = 0
    const passo = () => {
      const t = Math.min(1, (performance.now() - inicio) / DURACAO_PRELOADER)
      setPct(Math.round(t * 100))
      if (t < 1) quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [])
  return (
    <div className={`preloader ${saindo ? 'saindo' : ''}`} role="status" aria-label="Carregando o programa">
      <div className="centro">
        <div className="logo-pulso"><img src={logo} alt="" /></div>
        <div className="nome">Gerar Pré-Venda</div>
        <div className="trilho"><span /></div>
        <div className="pct">{pct}%</div>
      </div>
    </div>
  )
}
