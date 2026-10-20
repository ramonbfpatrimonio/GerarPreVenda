import { useState } from 'react'
import { MODELOS, type ModeloPedido } from '@shared/pdf/modelos'

/** Modelos de pedido em PDF que o programa sabe ler, com o layout de cada um. */
export function Pagina_Modelos({ visivel }: { visivel: boolean }) {
  const [aberto, setAberto] = useState(MODELOS[0]?.id ?? '')
  if (!visivel) return null
  const m = MODELOS.find((x) => x.id === aberto) ?? MODELOS[0]

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Modelos de Pedido</h1>
          <p className="fraco">
            Layouts de pedido de compra em PDF que o programa lê. Ao abrir um PDF, o modelo é reconhecido sozinho.
            Chegou um PDF de outro layout? Envie para ser estudado e virar um novo modelo.
          </p>
        </div>
      </div>

      <div className="grade-modelos">
        <div className="caixa lista-modelos">
          {MODELOS.map((x, i) => (
            <button key={x.id} className={x.id === m.id ? 'atual' : ''} onClick={() => setAberto(x.id)}>
              <span className="numero-modelo">{i + 1}</span>
              <span>
                <b>{x.nome}</b>
                <small>{x.emitidoPor}</small>
              </span>
            </button>
          ))}
        </div>
        {m && <DetalheModelo m={m} />}
      </div>
    </div>
  )
}

function DetalheModelo({ m }: { m: ModeloPedido }) {
  return (
    <div className="caixa bloco detalhe-modelo">
      <div>
        <h2>{m.nome}</h2>
        <p className="fraco mini">{m.emitidoPor} · incluído em {m.adicionadoEm}</p>
      </div>
      <p>{m.descricao}</p>

      <dl className="fichas-modelo">
        <div><dt>Como é reconhecido</dt><dd>{m.reconhece}</dd></div>
        <div><dt>Quantidade e preço</dt><dd>{m.unidade}</dd></div>
        <div><dt>Conversão</dt><dd>{m.conversao}</dd></div>
      </dl>

      <div>
        <h3>Dados do pedido</h3>
        <table className="tabela tabela-compacta">
          <thead><tr><th>O que o programa pega</th><th>Onde está no PDF</th></tr></thead>
          <tbody>{m.cabecalho.map((c) => <tr key={c.campo}><td style={{ fontWeight: 600 }}>{c.campo}</td><td>{c.onde}</td></tr>)}</tbody>
        </table>
      </div>

      <div>
        <h3>Layout dos itens</h3>
        <p className="fraco mini">Colunas na ordem em que aparecem no PDF. <span className="marca-usada">Em destaque</span> as que o programa usa; as outras são ignoradas.</p>
        <div className="layout-modelo">
          <table>
            <thead>
              <tr>{m.colunas.map((c) => <th key={c.nome} className={c.uso ? 'usada' : ''} title={c.uso ? `Usada como: ${c.uso}` : 'Ignorada'}>{c.nome}</th>)}</tr>
            </thead>
            <tbody>
              {m.exemplo.map((linha, i) => (
                <tr key={i}>{linha.map((v, j) => <td key={j} className={m.colunas[j]?.uso ? 'usada' : ''}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="usos-modelo">
          {m.colunas.filter((c) => c.uso).map((c) => <li key={c.nome}><b>{c.nome}</b> → {c.uso}</li>)}
        </ul>
      </div>

      {m.observacoes.length > 0 && (
        <div>
          <h3>Conferências e cuidados</h3>
          <ul className="usos-modelo">{m.observacoes.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
