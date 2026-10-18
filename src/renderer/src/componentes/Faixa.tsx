import { useEffect, useRef, useState } from 'react'
import { useConexoes, useSessao } from '../contexto'
import { useAdmin } from '../admin'
import logoPadrao from '../assets/logo.png'
import type { EstadoAtualizacao } from '../../../preload/api'
import { Icone } from './Icone'

/** Faixa superior na cor da conexão ativa: mostra empresa, banco, internet e usuário. */
export function Faixa({ irPara }: { irPara: (aba: 'conexoes' | 'empresas') => void }) {
  const { ativos: perfis, ativa, status, selecionar, verificar } = useConexoes()
  const { perfil, sair, empresaAtual, empresas, escolherEmpresa, ehSuper, internet, offline, pendentes, aparencia } = useSessao()
  const admin = useAdmin()
  const [menu, setMenu] = useState<'banco' | 'empresa' | null>(null)
  const [atualizacao, setAtualizacao] = useState<EstadoAtualizacao | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => window.api.atualizacao.aoMudar(setAtualizacao), [])
  useEffect(() => {
    if (!menu) return
    const fora = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(null)
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [menu])

  const grupos = perfis.reduce<Record<string, typeof perfis>>((g, p) => ((g[p.cliente] ??= []).push(p), g), {})
  const sub =
    status.estado === 'on' ? `${ativa?.servidor}${ativa?.instancia ? '\\' + ativa.instancia : ''} / ${ativa?.banco}` :
    status.estado === 'off' ? 'Sem conexão com o banco: clique para trocar ou testar' :
    status.estado === 'sem-senha' ? 'Falta a senha do SQL neste computador (peça ao administrador)' :
    status.estado === 'verificando' ? 'Conectando…' : 'Escolha em qual banco trabalhar'

  return (
    <header className="faixa" ref={ref}>
      {aparencia?.logo
        ? <img className="logo-faixa propria" src={aparencia.logo} alt={aparencia.empresaNome || ''} />
        : <img className="logo-faixa" src={logoPadrao} alt="" />}
      {ehSuper ? (
        <button className="seletor-empresa" onClick={() => setMenu((m) => (m === 'empresa' ? null : 'empresa'))} aria-haspopup="menu" aria-expanded={menu === 'empresa'}>
          <small>Empresa</small>
          <span>{empresaAtual?.nome ?? (empresas.length ? 'Escolha a empresa' : 'Nenhuma empresa')} <Icone nome="seta" tamanho={14} /></span>
        </button>
      ) : (
        <div className="seletor-empresa fixo"><small>Empresa</small><span>{empresaAtual?.nome ?? '—'}</span></div>
      )}
      <button className="seletor-banco" onClick={() => setMenu((m) => (m === 'banco' ? null : 'banco'))} aria-haspopup="menu" aria-expanded={menu === 'banco'} title={status.estado === 'off' ? status.erro : undefined}>
        <span className={`luz ${status.estado === 'on' ? 'on' : status.estado === 'off' || status.estado === 'sem-senha' ? 'off' : ''}`} />
        <span>
          <div className="titulo">{ativa ? `${ativa.cliente} › ${ativa.nome}` : 'Nenhuma conexão selecionada'}</div>
          <div className="sub">{sub}</div>
        </span>
        <span className="seta"><Icone nome="seta" tamanho={16} /></span>
      </button>

      {menu === 'empresa' && (
        <div className="menu-bancos menu-empresas" role="menu">
          <div className="grupo">Trabalhar na empresa</div>
          {empresas.map((e) => (
            <button key={e.id} role="menuitem" className={e.id === empresaAtual?.id ? 'atual' : ''} onClick={() => { escolherEmpresa(e.id); setMenu(null) }}>
              <span>
                <div>{e.nome} {!e.ativa && <span className="etiqueta erro">bloqueada</span>}</div>
                <div className="mini fraco">{e.usuarios} usuário(s), {e.prevendas_mes} pré-venda(s) no mês</div>
              </span>
            </button>
          ))}
          {empresas.length === 0 && <div className="grupo">{offline ? 'Sem internet: lista indisponível.' : 'Nenhuma empresa cadastrada.'}</div>}
          {admin.ehSuper && (
            <div style={{ borderTop: '1px solid var(--linha)', marginTop: 6, paddingTop: 6 }}>
              <button onClick={() => { irPara('empresas'); setMenu(null) }}><Icone nome="empresa" tamanho={16} /> Gerenciar empresas</button>
            </div>
          )}
        </div>
      )}

      {menu === 'banco' && (
        <div className="menu-bancos" role="menu">
          {Object.entries(grupos).map(([cliente, lista]) => (
            <div key={cliente}>
              <div className="grupo">{cliente}</div>
              {lista.map((p) => (
                <button key={p.id} role="menuitem" className={p.id === ativa?.id ? 'atual' : ''} onClick={() => { selecionar(p.id); setMenu(null) }}>
                  <span className="cor" style={{ background: p.cor }} />
                  <span>
                    <div>{p.nome} {p.autenticacao === 'sql' && !p.temSenha && <span className="etiqueta erro">sem senha</span>}</div>
                    <div className="mini fraco">{p.servidor}{p.instancia ? '\\' + p.instancia : ''} / {p.banco || 'sem banco'}</div>
                  </span>
                </button>
              ))}
            </div>
          ))}
          {perfis.length === 0 && <div className="grupo">Nenhuma conexão cadastrada para {empresaAtual?.nome ?? 'esta empresa'}.</div>}
          <div style={{ borderTop: '1px solid var(--linha)', marginTop: 6, paddingTop: 6 }}>
            {ativa && <button onClick={() => { verificar(); setMenu(null) }}><Icone nome="atualizar" tamanho={16} /> Testar a conexão de novo</button>}
            {admin.perfil && <button onClick={() => { irPara('conexoes'); setMenu(null) }}><Icone nome="banco" tamanho={16} /> Gerenciar conexões</button>}
          </div>
        </div>
      )}

      <span className="espaco" />
      {admin.perfil && !admin.automatico && (
        <span className="selo-admin" title="Área administrativa liberada (Ctrl+Shift+B). Fecha sozinha após 10 minutos sem uso.">
          Administração: {admin.perfil.nome}{admin.nuvem ? '' : ' (sem internet)'}
          <button onClick={() => admin.fechar()}>Fechar</button>
        </span>
      )}
      {!internet && (
        <span className="selo-offline" title={offline ? 'Entrou com o acesso guardado neste computador. A geração de pré-vendas continua normal.' : 'Sem internet no momento.'}>
          Sem internet{pendentes ? ` · ${pendentes} aguardando envio` : ''}
        </span>
      )}
      {internet && pendentes > 0 && <span className="selo-offline">Enviando {pendentes} para o histórico…</span>}
      {atualizacao?.tipo === 'baixando' && <span className="mini">Baixando atualização {atualizacao.percentual}%</span>}
      {atualizacao?.tipo === 'pronta' && (
        <button className="botao-faixa atualizar" onClick={() => window.api.atualizacao.instalar()}>
          Reiniciar e atualizar para {atualizacao.versao}
        </button>
      )}
      {perfil && (
        <div className="usuario">
          {perfil.nome}
          <small>{perfil.papel === 'super_admin' ? 'Super administrador' : perfil.papel === 'admin' ? 'Administrador' : 'Operador'}</small>
        </div>
      )}
      <button className="botao-faixa" onClick={() => void sair()} title="Sair" aria-label="Sair">
        <Icone nome="sair" tamanho={16} />
      </button>
    </header>
  )
}
