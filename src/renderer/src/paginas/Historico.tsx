import { useEffect, useState } from 'react'
import { formatarCnpj, moeda } from '@shared/numeros'
import { nuvem, type RegistroHistorico } from '../servicos'
import { useAviso, useSessao } from '../contexto'
import { Icone } from '../componentes/Icone'
import { Alerta } from '../componentes/Modal'

const PERIODOS = [
  { rotulo: 'Últimos 7 dias', dias: 7 },
  { rotulo: 'Últimos 30 dias', dias: 30 },
  { rotulo: 'Últimos 90 dias', dias: 90 },
  { rotulo: 'Último ano', dias: 365 },
  { rotulo: 'Tudo', dias: 0 }
]
const FILTROS: Record<string, string> = { TODOS: 'Todos', ST: 'Só ST', SEM_ST: 'Sem ST' }

/** CSV com ; e vírgula decimal: abre direto no Excel em português. */
function exportarCsv(lista: RegistroHistorico[], nomeArquivo: string) {
  const col = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const num = (v: number) => Number(v).toFixed(2).replace('.', ',')
  const linhas = [
    ['Data', 'Empresa', 'Pré-venda', 'Conexão', 'Cliente', 'CNPJ', 'Pedido de compra', 'Filtro', 'Itens', 'Total', 'Total com ST', 'Usuário', 'Computador', 'Arquivo PDF'].map(col).join(';'),
    ...lista.map((h) =>
      [
        col(h.criado_em ? new Date(h.criado_em).toLocaleString('pt-BR') : ''),
        col(h.empresas?.nome ?? ''),
        col(`${h.numero}/${h.ano}`),
        col(`${h.conexao_cliente} ${h.conexao_nome}`),
        col(h.cliente_nome || h.cliente_codigo),
        col(formatarCnpj(h.cliente_cnpj)),
        col(h.pedido_compra),
        col(FILTROS[h.filtro] ?? h.filtro),
        h.qtd_itens,
        num(h.total),
        num(h.total_com_st),
        col(h.usuario_nome),
        col(h.estacao),
        col(h.arquivo_pdf)
      ].join(';')
    )
  ]
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nomeArquivo
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export function Pagina_Historico({ visivel }: { visivel: boolean }) {
  const { empresaAtual, ehSuper, internet, pendentes } = useSessao()
  const [texto, setTexto] = useState('')
  const [dias, setDias] = useState(30)
  const [todasEmpresas, setTodasEmpresas] = useState(false)
  const [lista, setLista] = useState<RegistroHistorico[]>([])
  const [fila, setFila] = useState<RegistroHistorico[]>([])
  const [carregando, setCarregando] = useState(false)
  const avisar = useAviso()
  const mostrarEmpresa = ehSuper && todasEmpresas

  const carregar = async () => {
    setFila((await window.api.fila.listar().catch(() => [])) as unknown as RegistroHistorico[])
    if (!internet) return
    setCarregando(true)
    try {
      const desde = dias ? new Date(Date.now() - dias * 86400000).toISOString() : undefined
      setLista(await nuvem.historico({ texto, desde, empresaId: mostrarEmpresa ? null : empresaAtual?.id, limite: 1000 }))
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
  }, [texto, dias, visivel, empresaAtual?.id, todasEmpresas, internet, pendentes]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visivel) return null
  const somaTotal = lista.reduce((s, h) => s + Number(h.total), 0)

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Histórico</h1>
          <p className="fraco">
            {mostrarEmpresa ? 'Pré-vendas de todas as empresas.' : `Pré-vendas geradas em ${empresaAtual?.nome ?? '—'}, em todos os computadores.`}
            {lista.length > 0 && ` ${lista.length} no período, ${moeda(somaTotal)}.`}
          </p>
        </div>
        <div className="acoes">
          <input className="entrada" style={{ width: 300 }} placeholder="Pedido, cliente, CNPJ, nº ou usuário" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <select className="entrada" style={{ width: 150 }} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.rotulo}</option>)}
          </select>
          {ehSuper && (
            <label className="check" style={{ whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={todasEmpresas} onChange={(e) => setTodasEmpresas(e.target.checked)} /> Todas as empresas
            </label>
          )}
          <button className="botao" onClick={() => exportarCsv(lista, `historico-${(mostrarEmpresa ? 'todas' : empresaAtual?.nome ?? 'empresa').replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`)} disabled={!lista.length}>
            <Icone nome="planilha" /> Exportar para Excel
          </button>
          <button className="botao" onClick={() => void carregar()} disabled={carregando || !internet}>{carregando ? <span className="spinner" /> : <Icone nome="atualizar" />} Atualizar</button>
        </div>
      </div>

      {!internet && <div style={{ marginBottom: 14 }}><Alerta tipo="aviso">Sem internet: o histórico da nuvem aparece quando a conexão voltar. Abaixo estão as pré-vendas geradas neste computador que ainda vão ser enviadas.</Alerta></div>}
      {fila.length > 0 && (
        <div className="caixa" style={{ marginBottom: 14, overflow: 'auto' }}>
          <div style={{ padding: '10px 12px', fontWeight: 600 }}>Aguardando internet ({fila.length})</div>
          <table className="tabela">
            <thead><tr><th>Gerada em</th><th>Pré-venda</th><th>Conexão</th><th>Cliente</th><th>Pedido de compra</th><th className="num">Total</th><th>Usuário</th></tr></thead>
            <tbody>
              {fila.map((h) => (
                <tr key={h.chave_local}>
                  <td>{h.criado_em ? new Date(h.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td>
                  <td style={{ fontWeight: 600 }}>{h.numero}/{h.ano}</td>
                  <td>{h.conexao_cliente} › {h.conexao_nome}</td>
                  <td>{h.cliente_nome || h.cliente_codigo}</td>
                  <td>{h.pedido_compra}</td>
                  <td className="num">{moeda(Number(h.total))}</td>
                  <td>{h.usuario_nome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {internet && <div className="caixa" style={{ overflow: 'auto' }}>
        <table className="tabela">
          <thead>
            <tr>
              <th>Data</th>{mostrarEmpresa && <th>Empresa</th>}<th>Pré-venda</th><th>Conexão</th><th>Cliente</th><th>Pedido de compra</th>
              <th>Itens</th><th className="num">Total</th><th className="num">Com ST</th><th>Usuário</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((h) => (
              <tr key={h.id}>
                <td>{h.criado_em ? new Date(h.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td>
                {mostrarEmpresa && <td>{h.empresas?.nome}</td>}
                <td style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{h.numero}/{h.ano}</td>
                <td>{h.conexao_cliente} › {h.conexao_nome}</td>
                <td className="desc">{h.cliente_nome || h.cliente_codigo}<div className="mini fraco">{formatarCnpj(h.cliente_cnpj)}</div></td>
                <td>{h.pedido_compra}</td>
                <td>{h.qtd_itens} {h.filtro !== 'TODOS' && <span className="etiqueta st">{FILTROS[h.filtro]}</span>}</td>
                <td className="num">{moeda(Number(h.total))}</td>
                <td className="num">{moeda(Number(h.total_com_st))}</td>
                <td>{h.usuario_nome}<div className="mini fraco">{h.estacao}</div></td>
              </tr>
            ))}
            {!carregando && internet && lista.length === 0 && (
              <tr><td colSpan={mostrarEmpresa ? 10 : 9} style={{ height: 80, textAlign: 'center' }} className="fraco">Nenhuma pré-venda encontrada neste período.</td></tr>
            )}
          </tbody>
        </table>
      </div>}
    </div>
  )
}
