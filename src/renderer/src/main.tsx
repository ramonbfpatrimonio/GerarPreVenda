import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './estilo.css'
import { App } from './App'
import { iniciarServicos } from './servicos'
import { DURACAO_PRELOADER, Preloader } from './componentes/Preloader'

// Os serviços começam a carregar junto com a tela de abertura.
const servicos = iniciarServicos()
const tempoMinimo = new Promise((ok) => setTimeout(ok, DURACAO_PRELOADER))

function Raiz() {
  const [pronto, setPronto] = useState(false) // serviços prontos e os 4 s passados
  const [preloader, setPreloader] = useState(true)
  useEffect(() => {
    void Promise.all([servicos, tempoMinimo]).then(() => {
      setPronto(true)
      setTimeout(() => setPreloader(false), 450) // tempo do esmaecer
    })
  }, [])
  return (
    <>
      {pronto && <App />}
      {preloader && <Preloader saindo={pronto} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Raiz />
  </StrictMode>
)
