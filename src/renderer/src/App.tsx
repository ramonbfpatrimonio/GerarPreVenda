import { useEffect, useState } from 'react'
import { AvisosProvider, ConexoesProvider, SessaoProvider, useSessao } from './contexto'
import { Faixa } from './componentes/Faixa'
import { Icone } from './componentes/Icone'
import { Pagina_Pedido } from './paginas/Pedido'
import { Pagina_Conexoes } from './paginas/Conexoes'
import { Pagina_Historico } from './paginas/Historico'
import { Pagina_Usuarios } from './paginas/Usuarios'
import { Pagina_Login } from './paginas/Login'
import { Pagina_Empresas } from './paginas/Empresas'

type Aba = 'pedido' | 'conexoes' | 'historico' | 'usuarios' | 'empresas'

function abaInicial(): Aba {
  const a = new URLSearchParams(location.search).get('aba')
  return a === 'conexoes' || a === 'historico' || a === 'usuarios' || a === 'empresas' ? a : 'pedido'
}

function Casca() {
  const { perfil, carregando, ehSuper, ehAdmin } = useSessao()
  const [aba, setAba] = useState<Aba>(abaInicial)
  const [versao, setVersao] = useState('')
  useEffect(() => {
    window.api.atualizacao.versao().then(setVersao).catch(() => undefined)
  }, [])

  if (carregando) return <div className="carregando"><span><span className="spinner" /> Carregando…</span></div>
  if (!perfil) return <Pagina_Login />

  const itens: { id: Aba; rotulo: string; icone: string; mostrar: boolean }[] = [
    { id: 'pedido', rotulo: 'Pedido', icone: 'pedido', mostrar: true },
    { id: 'historico', rotulo: 'Histórico', icone: 'historico', mostrar: true },
    { id: 'conexoes', rotulo: 'Conexões', icone: 'banco', mostrar: true },
    { id: 'usuarios', rotulo: 'Usuários', icone: 'usuarios', mostrar: ehAdmin },
    { id: 'empresas', rotulo: 'Empresas', icone: 'empresa', mostrar: ehSuper }
  ]

  return (
    <ConexoesProvider>
      <div className="casca">
        <Faixa irPara={setAba} />
        <div className="corpo">
          <nav className="nav" aria-label="Menu">
            {itens.filter((i) => i.mostrar).map((i) => (
              <button key={i.id} className={aba === i.id ? 'ativo' : ''} onClick={() => setAba(i.id)} aria-current={aba === i.id ? 'page' : undefined}>
                <Icone nome={i.icone} /> {i.rotulo}
              </button>
            ))}
            <div className="rodape">Versão {versao}</div>
          </nav>
          {/* O pedido fica montado o tempo todo para não perder o que foi feito ao trocar de aba. */}
          <Pagina_Pedido visivel={aba === 'pedido'} />
          {aba === 'conexoes' && <Pagina_Conexoes />}
          <Pagina_Historico visivel={aba === 'historico'} />
          {ehAdmin && <Pagina_Usuarios visivel={aba === 'usuarios'} />}
          {ehSuper && <Pagina_Empresas visivel={aba === 'empresas'} irParaPedido={() => setAba('pedido')} />}
        </div>
      </div>
    </ConexoesProvider>
  )
}

export function App() {
  return (
    <AvisosProvider>
      <SessaoProvider>
        <Casca />
      </SessaoProvider>
    </AvisosProvider>
  )
}
