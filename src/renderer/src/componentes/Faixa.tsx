import { useEffect, useRef, useState } from 'react'
import { useConexoes, useSessao } from '../contexto'
import type { EstadoAtualizacao } from '../../../preload/api'
import { Icone } from './Icone'

/** Faixa superior na cor da conexão ativa: sempre mostra em qual banco você está. */
export function Faixa({ irParaConexoes }: { irParaConexoes: () => void }) {
  const { perfis, ativa, status, selecionar, verificar } = useConexoes()
  const { perfil, sair } = useSessao()
  const [menu, setMenu] = useState(false)
  const [atualizacao, setAtualizacao] = useState<EstadoAtualizacao | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => window.api.atualizacao.aoMudar(setAtualizacao), [])
  useEffect(() => {
    if (!menu) return
    const fora = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [menu])

  const grupos = perfis.reduce<Record<string, typeof perfis>>((g, p) => ((g[p.cliente] ??= []).push(p), g), {})
  const sub =
    status.estado === 'on' ? `${ativa?.servidor}${ativa?.instancia ? '\\' + ativa.instancia : ''} / ${ativa?.banco}` :
    status.estado === 'off' ? 'Sem conexão com o banco: clique para trocar ou testar' :
    status.estado === 'verificando' ? 'Conectando…' : 'Escolha em qual banco trabalhar'

  return (
    <header className="faixa" ref={ref}>
      <span className="marca">Gerar Pré-Venda</span>
      <button className="seletor-banco" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} title={status.estado === 'off' ? status.erro : undefined}>
        <span className={`luz ${status.estado === 'on' ? 'on' : status.estado === 'off' ? 'off' : ''}`} />
        <span>
          <div className="titulo">{ativa ? `${ativa.cliente} › ${ativa.nome}` : 'Nenhuma conexão selecionada'}</div>
          <div className="sub">{sub}</div>
        </span>
        <span className="seta"><Icone nome="seta" tamanho={16} /></span>
      </button>
      {menu && (
        <div className="menu-bancos" role="menu">
          {Object.entries(grupos).map(([cliente, lista]) => (
            <div key={cliente}>
              <div className="grupo">{cliente}</div>
              {lista.map((p) => (
                <button key={p.id} role="menuitem" className={p.id === ativa?.id ? 'atual' : ''} onClick={() => { selecionar(p.id); setMenu(false) }}>
                  <span className="cor" style={{ background: p.cor }} />
                  <span>
                    <div>{p.nome}</div>
                    <div className="mini fraco">{p.servidor}{p.instancia ? '\\' + p.instancia : ''} / {p.banco || 'sem banco'}</div>
                  </span>
                </button>
              ))}
            </div>
          ))}
          {perfis.length === 0 && <div className="grupo">Nenhuma conexão cadastrada.</div>}
          <div style={{ borderTop: '1px solid var(--linha)', marginTop: 6, paddingTop: 6 }}>
            {ativa && <button onClick={() => { verificar(); setMenu(false) }}><Icone nome="atualizar" tamanho={16} /> Testar a conexão de novo</button>}
            {perfil?.papel === 'admin' && <button onClick={() => { irParaConexoes(); setMenu(false) }}><Icone nome="banco" tamanho={16} /> Gerenciar conexões</button>}
          </div>
        </div>
      )}
      <span className="espaco" />
      {atualizacao?.tipo === 'baixando' && <span className="mini">Baixando atualização {atualizacao.percentual}%</span>}
      {atualizacao?.tipo === 'pronta' && (
        <button className="botao-faixa atualizar" onClick={() => window.api.atualizacao.instalar()}>
          Reiniciar e atualizar para {atualizacao.versao}
        </button>
      )}
      {perfil && (
        <div className="usuario">
          {perfil.nome}
          <small>{perfil.papel === 'admin' ? 'Administrador' : 'Operador'}</small>
        </div>
      )}
      <button className="botao-faixa" onClick={() => void sair()} title="Sair">
        <Icone nome="sair" tamanho={16} />
      </button>
    </header>
  )
}
