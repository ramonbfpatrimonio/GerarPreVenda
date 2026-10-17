import { useEffect, type ReactNode } from 'react'

export function Modal({
  aberto, aoFechar, children, botoes, largo, faixaBanco, rotulo
}: {
  aberto: boolean
  aoFechar: () => void
  children: ReactNode
  botoes?: ReactNode
  largo?: boolean
  faixaBanco?: boolean
  rotulo: string
}) {
  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberto, aoFechar])
  if (!aberto) return null
  return (
    <div className="fundo-modal" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className={`modal ${largo ? 'largo' : ''}`} role="dialog" aria-modal="true" aria-label={rotulo}>
        {faixaBanco && <div className="topo-banco" />}
        <div className="conteudo">{children}</div>
        {botoes && <div className="botoes">{botoes}</div>}
      </div>
    </div>
  )
}

export function Alerta({ tipo, children, acoes }: { tipo: 'erro' | 'aviso' | 'ok'; children: ReactNode; acoes?: ReactNode }) {
  return (
    <div className={`alerta ${tipo}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {tipo === 'ok' ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />}
      </svg>
      <div>{children}</div>
      {acoes && <div className="acoes">{acoes}</div>}
    </div>
  )
}
