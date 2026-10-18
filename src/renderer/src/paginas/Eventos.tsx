import { useEffect, useMemo, useState } from 'react'
import { type Evento } from '../servicos'
import { useAviso, useSessao } from '../contexto'
import { useAdmin } from '../admin'
import { Icone } from '../componentes/Icone'
import { Alerta } from '../componentes/Modal'

const PERIODOS = [
  { dias: 1, rotulo: 'Hoje' },
  { dias: 7, rotulo: 'Últimos 7 dias' },
  { dias: 30, rotulo: 'Últimos 30 dias' },
  { dias: 90, rotulo: 'Últimos 90 dias' },
  { dias: 0, rotulo: 'Tudo' }
]

const ACOES: Record<string, string> = {
  criou: 'Criou',
  alterou: 'Alterou',
  excluiu: 'Excluiu',
  salvou: 'Salvou',
  gerou: 'Gerou',
  entrou: 'Entrou',
  saiu: 'Saiu',
  acessou: 'Acessou',
  negou: 'Negado',
  backup: 'Backup',
  restaurou: 'Restaurou',
  exportou: 'Exportou',
  importou: 'Importou'
}

const COR: Record<string, string> = {
  criou: 'ok',
  gerou: 'ok',
  salvou: 'ok',
  alterou: 'aviso',
  restaurou: 'aviso',
  importou: 'aviso',
  excluiu: 'erro',
  negou: 'erro'
}

const dia = (d: string) => new Date(d).toLocaleDateString('pt-BR')
const hora = (d: string) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function inicioDoPeriodo(dias: number) {
  if (!dias) return undefined
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (dias - 1))
  return d.toISOString()
}

/** Quem fez o quê, quando (dia e hora com segundos) e em qual computador. */
export function Pagina_Eventos({ visivel }: { visivel: boolean }) {
  const { empresaAtual, internet } = useSessao()
  const adm = useAdmin()
  const avisar = useAviso()
  const [lista, setLista] = useState<Evento[]>([])
  const [texto, setTexto] = useState('')
  const [dias, setDias] = useState(7)
  const [acao, setAcao] = useState('')
  const [entidade, setEntidade] = useState('')
  const [todas, setTodas] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [aberto, setAberto] = useState<number | null>(null)

  const mostrarEmpresa = adm.ehSuper && todas

  const carregar = async () => {
    if (!adm.nuvem || !internet) return
    setCarregando(true)
    try {
      setLista(
        await adm.nuvem.eventos({
          desde: inicioDoPeriodo(dias),
          texto,
          acao: acao || undefined,
          entidade: entidade || undefined,
          empresaId: mostrarEmpresa ? null : empresaAtual?.id ?? adm.perfil?.empresa_id,
          limite: 2000
        })
      )
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    if (!visivel) return
    const t = setTimeout(() => void carregar(), 300)
    return () => clearTimeout(t)
  }, [visivel, texto, dias, acao, entidade, todas, empresaAtual?.id, internet, adm.nuvem]) // eslint-disable-line react-hooks/exhaustive-deps

  const entidades = useMemo(() => {
    const s = new Set(['pré-venda', 'conexão', 'usuário', 'empresa', 'aparência', 'backup', 'login', 'área administrativa'])
    lista.forEach((e) => s.add(e.entidade))
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [lista])

  const exportar = () => {
    const esc = (v: unknown) => {
      const t = String(v ?? '')
      return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const cab = ['Dia', 'Hora', ...(mostrarEmpresa ? ['Empresa'] : []), 'Usuário', 'Estação', 'Ação', 'Item', 'Descrição']
    const linhas = [cab.join(';')].concat(
      lista.map((e) =>
        [dia(e.criado_em), hora(e.criado_em), ...(mostrarEmpresa ? [e.empresas?.nome ?? ''] : []), e.usuario_nome, e.estacao, ACOES[e.acao] ?? e.acao, e.entidade, e.descricao]
          .map(esc)
          .join(';')
      )
    )
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `eventos-${(mostrarEmpresa ? 'todas' : empresaAtual?.nome ?? 'empresa').replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    void adm.registrar({ acao: 'exportou', entidade: 'eventos', descricao: `Exportou ${lista.length} evento(s) para Excel` })
  }

  if (!visivel) return null
  const semNuvem = !internet || !adm.nuvem

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Eventos do sistema</h1>
          <p className="fraco">
            Quem criou, alterou, excluiu, salvou ou gerou algo, com dia, hora, computador e usuário.
            {lista.length > 0 && ` ${lista.length} evento(s) no período.`}
          </p>
        </div>
      </div>

      <div className="filtros-eventos">
        <input className="entrada" style={{ flex: '1 1 260px' }} placeholder="Procurar por descrição, usuário ou estação" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <select className="entrada" style={{ width: 160 }} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.rotulo}</option>)}
        </select>
        <select className="entrada" style={{ width: 150 }} value={acao} onChange={(e) => setAcao(e.target.value)}>
          <option value="">Todas as ações</option>
          {Object.entries(ACOES).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        <select className="entrada" style={{ width: 180 }} value={entidade} onChange={(e) => setEntidade(e.target.value)}>
          <option value="">Todos os itens</option>
          {entidades.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
        </select>
        {adm.ehSuper && (
          <label className="check" style={{ whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Todas as empresas
          </label>
        )}
        <button className="botao" onClick={exportar} disabled={!lista.length}><Icone nome="planilha" /> Exportar para Excel</button>
        <button className="botao" onClick={() => void carregar()} disabled={carregando || semNuvem}>{carregando ? <span className="spinner" /> : <Icone nome="atualizar" />} Atualizar</button>
      </div>

      {semNuvem && <div style={{ marginBottom: 14 }}><Alerta tipo="aviso">Sem internet: os eventos ficam na nuvem e aparecem quando a conexão voltar. Os que acontecerem agora são guardados neste computador e enviados depois.</Alerta></div>}

      <div className="caixa" style={{ overflow: 'auto' }}>
        <table className="tabela tabela-eventos">
          <thead>
            <tr>
              <th>Dia</th><th>Hora</th>{mostrarEmpresa && <th>Empresa</th>}<th>Usuário</th><th>Estação</th><th>Ação</th><th>Item</th><th>Descrição</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((e) => {
              const temDetalhes = e.detalhes && Object.keys(e.detalhes).length > 0
              return (
                <tr key={e.id} onClick={() => temDetalhes && setAberto(aberto === e.id ? null : e.id)} style={temDetalhes ? { cursor: 'pointer' } : undefined}>
                  <td className="nowrap">{dia(e.criado_em)}</td>
                  <td className="nowrap mono">{hora(e.criado_em)}</td>
                  {mostrarEmpresa && <td>{e.empresas?.nome ?? '—'}</td>}
                  <td style={{ fontWeight: 600 }}>{e.usuario_nome || '—'}</td>
                  <td className="nowrap">{e.estacao || '—'}</td>
                  <td><span className={`etiqueta ${COR[e.acao] ?? 'neutra'}`}>{ACOES[e.acao] ?? e.acao}</span></td>
                  <td className="nowrap">{e.entidade}</td>
                  <td>
                    {e.descricao}
                    {aberto === e.id && temDetalhes && <pre className="detalhes-evento">{JSON.stringify(e.detalhes, null, 2)}</pre>}
                  </td>
                </tr>
              )
            })}
            {!lista.length && !carregando && (
              <tr><td colSpan={mostrarEmpresa ? 8 : 7} style={{ height: 80, textAlign: 'center' }} className="fraco">Nenhum evento no período.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
