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
import { Pagina_Eventos } from './paginas/Eventos'
import { Pagina_Aparencia } from './paginas/Aparencia'
import { Pagina_Modelos } from './paginas/Modelos'
import { Pagina_Cobranca } from './paginas/Cobranca'
import { AvisoLicenca } from './componentes/AvisoLicenca'
import { AdminProvider, useAdmin } from './admin'

export type Aba = 'pedido' | 'historico' | 'modelos' | 'conexoes' | 'usuarios' | 'eventos' | 'aparencia' | 'empresas' | 'cobranca'
const ABAS_ADMIN: Aba[] = ['conexoes', 'usuarios', 'eventos', 'aparencia', 'empresas', 'modelos', 'cobranca']

function abaInicial(): Aba {
  const a = new URLSearchParams(location.search).get('aba') as Aba | null
  return a && ['pedido', 'historico', ...ABAS_ADMIN].includes(a) ? a : 'pedido'
}

function Casca() {
  const { perfil, carregando } = useSessao()
  if (carregando) return <div className="carregando"><span><span className="spinner" /> Carregando…</span></div>
  if (!perfil) return <Pagina_Login />
  return (
    <AdminProvider>
      <ConexoesProvider>
        <Programa />
      </ConexoesProvider>
    </AdminProvider>
  )
}

function Programa() {
  const admin = useAdmin()
  const [aba, setAba] = useState<Aba>(abaInicial)
  const [versao, setVersao] = useState('')
  useEffect(() => {
    window.api.atualizacao.versao().then(setVersao).catch(() => undefined)
  }, [])

  // Área administrativa fechou: volta para o pedido se estava numa aba oculta
  useEffect(() => {
    if ((!admin.perfil && ABAS_ADMIN.includes(aba)) || (!admin.ehSuper && ['conexoes', 'eventos', 'aparencia', 'empresas', 'modelos', 'cobranca'].includes(aba))) setAba('pedido')
  }, [admin.perfil, admin.ehSuper]) // eslint-disable-line react-hooks/exhaustive-deps

  const itens: { id: Aba; rotulo: string; icone: string; mostrar: boolean }[] = [
    { id: 'pedido', rotulo: 'Pedido', icone: 'pedido', mostrar: true },
    { id: 'historico', rotulo: 'Histórico', icone: 'historico', mostrar: true },
    // administrador da empresa: só Usuários; o resto é do super administrador
    { id: 'conexoes', rotulo: 'Conexões', icone: 'banco', mostrar: admin.ehSuper },
    { id: 'usuarios', rotulo: 'Usuários', icone: 'usuarios', mostrar: !!admin.perfil },
    { id: 'eventos', rotulo: 'Eventos do sistema', icone: 'eventos', mostrar: admin.ehSuper },
    { id: 'aparencia', rotulo: 'Aparência', icone: 'imagem', mostrar: admin.ehSuper },
    { id: 'empresas', rotulo: 'Empresas', icone: 'empresa', mostrar: admin.ehSuper },
    { id: 'cobranca', rotulo: 'Cobrança', icone: 'dinheiro', mostrar: admin.ehSuper },
    { id: 'modelos', rotulo: 'Modelos de Pedido', icone: 'modelo', mostrar: admin.ehSuper }
  ]
  const visiveis = itens.filter((i) => i.mostrar)

  return (
    <div className="casca">
      <Faixa irPara={(a) => setAba(a)} />
      <AvisoLicenca />
      <div className="corpo">
        <nav className="nav" aria-label="Menu">
          {visiveis.map((i, n) => (
            <div key={i.id}>
              {n === 2 && <div className="nav-separador">Administração</div>}
              <button className={aba === i.id ? 'ativo' : ''} onClick={() => setAba(i.id)} aria-current={aba === i.id ? 'page' : undefined}>
                <Icone nome={i.icone} /> {i.rotulo}
              </button>
            </div>
          ))}
          {admin.perfil && !admin.automatico && (
            <button className="nav-fechar-admin" onClick={() => admin.fechar()}>
              <Icone nome="cadeado" /> Fechar administração
            </button>
          )}
          <div className="rodape">Versão {versao}</div>
        </nav>
        {/* O pedido fica montado o tempo todo para não perder o que foi feito ao trocar de aba. */}
        <Pagina_Pedido visivel={aba === 'pedido'} />
        <Pagina_Historico visivel={aba === 'historico'} />
        {admin.ehSuper && aba === 'conexoes' && <Pagina_Conexoes />}
        {admin.perfil && <Pagina_Usuarios visivel={aba === 'usuarios'} />}
        {admin.ehSuper && <Pagina_Eventos visivel={aba === 'eventos'} />}
        {admin.ehSuper && <Pagina_Aparencia visivel={aba === 'aparencia'} />}
        {admin.ehSuper && <Pagina_Modelos visivel={aba === 'modelos'} />}
        {admin.ehSuper && <Pagina_Cobranca visivel={aba === 'cobranca'} />}
        {admin.ehSuper && <Pagina_Empresas visivel={aba === 'empresas'} irParaPedido={() => setAba('pedido')} />}
      </div>
    </div>
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
