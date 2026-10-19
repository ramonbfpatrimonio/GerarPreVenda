import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EstadoAtualizacao } from '../../../preload/api'
import { Modal } from './Modal'

/**
 * Atualização do programa.
 * 1. Achou versão nova: pergunta "Atualizar agora" ou "Depois".
 * 2. Agora: baixa em segundo plano (o programa continua funcionando).
 * 3. Baixou: pergunta "Reiniciar agora" ou "Depois". Reiniciando, instala
 *    sem abrir o instalador e o programa volta sozinho, já atualizado.
 *    Depois: instala quando o programa for fechado.
 * Enquanto houver algo pendente, a faixa superior mostra um botão para retomar.
 */
export function Atualizacao() {
  const [estado, setEstado] = useState<EstadoAtualizacao | null>(null)
  const [janela, setJanela] = useState(false)
  const [adiada, setAdiada] = useState('') // versão que a pessoa deixou para depois

  useEffect(() => {
    window.api.atualizacao.estadoAtual?.().then((e) => e && setEstado(e)).catch(() => undefined)
    return window.api.atualizacao.aoMudar(setEstado)
  }, [])

  // abre a pergunta sozinho quando aparece uma versão nova ou termina o download
  useEffect(() => {
    if (estado?.tipo === 'disponivel' && adiada !== `d${estado.versao}`) setJanela(true)
    if (estado?.tipo === 'pronta' && adiada !== `p${estado.versao}`) setJanela(true)
  }, [estado]) // eslint-disable-line react-hooks/exhaustive-deps

  const depois = () => {
    if (estado?.tipo === 'disponivel') setAdiada(`d${estado.versao}`)
    if (estado?.tipo === 'pronta') setAdiada(`p${estado.versao}`)
    setJanela(false)
  }

  const versao = estado && 'versao' in estado ? estado.versao : ''

  return (
    <>
      {estado?.tipo === 'disponivel' && !janela && (
        <button className="botao-faixa atualizar" onClick={() => setJanela(true)}>Atualização {estado.versao} disponível</button>
      )}
      {estado?.tipo === 'baixando' && (
        <button className="botao-faixa baixando" onClick={() => setJanela(true)} title="Baixando a atualização em segundo plano">
          <span className="barra-mini"><span style={{ width: `${estado.percentual}%` }} /></span> Atualizando {estado.percentual}%
        </button>
      )}
      {estado?.tipo === 'pronta' && !janela && (
        <button className="botao-faixa atualizar" onClick={() => window.api.atualizacao.instalar()}>Reiniciar e atualizar para {estado.versao}</button>
      )}

      {createPortal(
      <Modal
        aberto={janela && (estado?.tipo === 'disponivel' || estado?.tipo === 'baixando' || estado?.tipo === 'pronta')}
        aoFechar={depois}
        rotulo="Atualização do programa"
        botoes={
          estado?.tipo === 'disponivel' ? (
            <>
              <button className="botao" onClick={depois}>Depois</button>
              <button className="botao primario" onClick={() => void window.api.atualizacao.baixar()}>Atualizar agora</button>
            </>
          ) : estado?.tipo === 'baixando' ? (
            <button className="botao" onClick={() => setJanela(false)}>Continuar usando</button>
          ) : (
            <>
              <button className="botao" onClick={depois}>Depois</button>
              <button className="botao primario" onClick={() => window.api.atualizacao.instalar()}>Reiniciar agora</button>
            </>
          )
        }
      >
        {estado?.tipo === 'disponivel' && (
          <>
            <h2>Nova versão disponível: {versao}</h2>
            <p>Quer atualizar agora? O download é feito em segundo plano e você pode continuar usando o programa.</p>
          </>
        )}
        {estado?.tipo === 'baixando' && (
          <>
            <h2>Baixando a atualização…</h2>
            <div className="barra-progresso"><span style={{ width: `${estado.percentual}%` }} /></div>
            <p className="fraco mini">{estado.percentual}% · pode continuar usando; aviso quando terminar.</p>
          </>
        )}
        {estado?.tipo === 'pronta' && (
          <>
            <h2>Atualização pronta</h2>
            <p>O programa vai fechar, instalar a versão {versao} e abrir de novo sozinho, em poucos segundos. Nada do que está guardado é perdido.</p>
            <p className="fraco mini">Se escolher depois, a atualização é instalada quando o programa for fechado.</p>
          </>
        )}
      </Modal>,
      document.body
      )}
    </>
  )
}
