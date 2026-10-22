import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { dataBR, plural, somarDias } from '@shared/licenca'
import { contatoSuporte, useSessao, type EstadoDaLicenca } from '../contexto'
import { Modal } from './Modal'

function textos(l: EstadoDaLicenca) {
  if (l.estado === 'vencendo') {
    const quando = l.dias === 0 ? 'vence hoje' : `vence em ${plural(l.dias, 'dia', 'dias')}`
    return {
      titulo: l.dias === 0 ? 'A licença vence hoje' : `A licença vence em ${plural(l.dias, 'dia', 'dias')}`,
      faixa: `A licença do programa ${quando} (${dataBR(l.vencimento)}). Faça o pagamento para não ter o acesso bloqueado.`,
      corpo: `O vencimento é em ${dataBR(l.vencimento)}. Faça o pagamento para continuar usando o programa sem interrupção.`
    }
  }
  const bloqueio = dataBR(somarDias(l.limite ?? l.vencimento ?? '', 1))
  return {
    titulo: 'Licença vencida',
    faixa: `A licença venceu em ${dataBR(l.vencimento)}. O acesso será bloqueado em ${bloqueio} se o pagamento não for confirmado.`,
    corpo: `A licença venceu em ${dataBR(l.vencimento)} e o pagamento ainda não foi confirmado. Em ${bloqueio} o acesso ao programa será bloqueado para todos os usuários da empresa.`
  }
}

/** Faixa de aviso de vencimento (todos os usuários) e janela no primeiro acesso do dia. */
export function AvisoLicenca() {
  const { licenca } = useSessao()
  const [janela, setJanela] = useState(false)
  const mostrar = licenca && (licenca.estado === 'vencendo' || licenca.estado === 'atrasada')
  const chave = mostrar ? `licenca-aviso:${licenca.vencimento}:${licenca.estado}` : ''

  useEffect(() => {
    if (!chave) return
    try {
      if (sessionStorage.getItem(chave)) return
      sessionStorage.setItem(chave, '1')
    } catch { /* sem armazenamento: mostra mesmo assim */ }
    setJanela(true)
  }, [chave])

  if (!mostrar) return null
  const t = textos(licenca)
  const atrasada = licenca.estado === 'atrasada'
  return (
    <>
      <div className={`aviso-licenca ${atrasada ? 'atrasada' : ''}`} role="status">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
        <span>{t.faixa} {contatoSuporte(licenca)}</span>
        <button onClick={() => setJanela(true)}>Detalhes</button>
      </div>
      {createPortal(
        <Modal aberto={janela} aoFechar={() => setJanela(false)} rotulo={t.titulo}
          botoes={<button className="botao primario" onClick={() => setJanela(false)} autoFocus>Entendi</button>}>
          <div className="layout-indisponivel">
            <div className={`icone-layout ${atrasada ? 'icone-atraso' : 'icone-vencendo'}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 13v3M12 18.5h.01" /></svg>
            </div>
            <h2>{t.titulo}</h2>
            <p>{t.corpo}</p>
            {licenca.valor > 0 && <p className="arquivo-layout">Valor: {licenca.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>}
            <p className="fraco">{contatoSuporte(licenca)}</p>
          </div>
        </Modal>,
        document.body
      )}
    </>
  )
}
