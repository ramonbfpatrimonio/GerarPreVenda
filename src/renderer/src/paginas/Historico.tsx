import { useEffect, useState } from 'react'
import { formatarCnpj, moeda } from '@shared/numeros'
import { nuvem, type RegistroHistorico } from '../servicos'
import { useAviso } from '../contexto'
import { Icone } from '../componentes/Icone'

const PERIODOS = [
  { rotulo: 'Últimos 7 dias', dias: 7 },
  { rotulo: 'Últimos 30 dias', dias: 30 },
  { rotulo: 'Últimos 90 dias', dias: 90 },
  { rotulo: 'Tudo', dias: 0 }
]
const FILTROS: Record<string, string> = { TODOS: 'Todos', ST: 'Só ST', SEM_ST: 'Sem ST' }

export function Pagina_Historico({ visivel }: { visivel: boolean }) {
  const [texto, setTexto] = useState('')
  const [dias, setDias] = useState(30)
  const [lista, setLista] = useState<RegistroHistorico[]>([])
  const [carregando, setCarregando] = useState(false)
  const avisar = useAviso()

  const carregar = async () => {
    setCarregando(true)
    try {
      const desde = dias ? new Date(Date.now() - dias * 86400000).toISOString() : undefined
      setLista(await nuvem.historico({ texto, desde }))
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
  }, [texto, dias, visivel]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visivel) return null
  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Histórico</h1>
          <p className="fraco">Pré-vendas geradas pelo programa em todos os computadores.</p>
        </div>
        <div className="acoes">
          <input className="entrada" style={{ width: 320 }} placeholder="Pedido, cliente, CNPJ, nº da pré-venda ou usuário" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <select className="entrada" style={{ width: 160 }} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.rotulo}</option>)}
          </select>
          <button className="botao" onClick={() => void carregar()} disabled={carregando}>{carregando ? <span className="spinner" /> : <Icone nome="atualizar" />} Atualizar</button>
        </div>
      </div>
      <div className="caixa" style={{ overflow: 'auto' }}>
        <table className="tabela">
          <thead>
            <tr>
              <th>Data</th><th>Pré-venda</th><th>Conexão</th><th>Cliente</th><th>Pedido de compra</th>
              <th>Itens</th><th className="num">Total</th><th className="num">Com ST</th><th>Usuário</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((h) => (
              <tr key={h.id}>
                <td>{h.criado_em ? new Date(h.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td>
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
            {!carregando && lista.length === 0 && (
              <tr><td colSpan={9} style={{ height: 80, textAlign: 'center' }} className="fraco">Nenhuma pré-venda encontrada neste período.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
