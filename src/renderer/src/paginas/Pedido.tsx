import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClienteErp, FiltroST, PedidoPdf, PreVendaExistente, ResultadoGeracao, ResultadoPdf } from '@shared/tipos'
import { calcularLinha, passaFiltro, resumir, type LinhaPedido, type ModoConversao } from '@shared/regras'
import { cnpj14, formatarCnpj, moeda, numero, numeroBR, qtd, soDigitos } from '@shared/numeros'
import { useAviso, useConexoes, useSessao } from '../contexto'
import { nuvem, type RegistroHistorico } from '../servicos'
import { Icone } from '../componentes/Icone'
import { Alerta, Modal } from '../componentes/Modal'

// ----------------------------------------------------------------- estado
interface Geracao { ano: string; numero: string; filtro: FiltroST; conexao: string }

interface EstadoPedido {
  chave: string
  origem: 'pdf' | 'manual'
  pdf?: PedidoPdf
  arquivo: string
  cnpj: string
  pedidoCompra: string
  linhas: LinhaPedido[]
  enviados: string[] // ids das linhas já enviadas
  geracoes: Geracao[]
  produtosDe: string // id da conexão de onde vieram os produtos
}

let seq = 0
const novoId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`

function deItensPdf(p: PedidoPdf, arquivo: string): EstadoPedido {
  return {
    chave: p.numero,
    origem: 'pdf',
    pdf: p,
    arquivo,
    cnpj: p.cnpjLoja,
    pedidoCompra: p.numero,
    linhas: p.itens.map((it) => ({
      id: novoId(),
      codigoLido: it.gtin,
      quantidadeOriginal: it.quantidade,
      precoOriginal: it.valorUnitario,
      descricaoPdf: it.descricao,
      totalPdf: it.total
    })),
    enviados: [],
    geracoes: [],
    produtosDe: ''
  }
}

function pedidoManual(): EstadoPedido {
  return {
    chave: `manual-${Date.now()}`,
    origem: 'manual',
    arquivo: '',
    cnpj: '',
    pedidoCompra: '',
    linhas: [{ id: novoId(), codigoLido: '', quantidadeOriginal: 0, precoOriginal: 0 }],
    enviados: [],
    geracoes: [],
    produtosDe: ''
  }
}

const NOMES_FILTRO: Record<FiltroST, string> = { TODOS: 'todos os itens', ST: 'só itens com ST', SEM_ST: 'só itens sem ST' }

// ----------------------------------------------------------------- página
export function Pagina_Pedido({ visivel }: { visivel: boolean }) {
  const { ativa, status, perfis, selecionar } = useConexoes()
  const { perfil } = useSessao()
  const avisar = useAviso()

  const [arquivo, setArquivo] = useState<ResultadoPdf | null>(null)
  const [pedidos, setPedidos] = useState<Record<string, EstadoPedido>>({})
  const [atual, setAtual] = useState<string | null>(null)
  const [modo, setModo] = useState<ModoConversao>('ORIGINAL')
  const [abaterST, setAbaterST] = useState(false)
  const [qtdInteira, setQtdInteira] = useState(false)
  const [lendoPdf, setLendoPdf] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const [soProblemas, setSoProblemas] = useState(false)
  const [colar, setColar] = useState(false)

  const est = atual ? pedidos[atual] : null
  const alterar = useCallback(
    (f: (e: EstadoPedido) => EstadoPedido) => setPedidos((ps) => (atual && ps[atual] ? { ...ps, [atual]: f(ps[atual]) } : ps)),
    [atual]
  )

  // ---------------- abrir PDF
  const carregarResultado = (r: ResultadoPdf | null) => {
    if (!r) return
    r.avisos.forEach((a) => avisar(a, 'erro'))
    if (r.pedidos.length === 0) return
    setArquivo(r)
    const novos: Record<string, EstadoPedido> = {}
    for (const p of r.pedidos) novos[p.numero] = deItensPdf(p, r.arquivo)
    setPedidos(novos)
    setAtual(r.pedidos[0].numero)
    setModo('ORIGINAL')
    setAbaterST(false)
    setQtdInteira(false)
    const itens = r.pedidos.reduce((s, p) => s + p.itens.length, 0)
    avisar(`${r.arquivo}: ${r.pedidos.length} pedido(s), ${itens} itens lidos.`, 'ok')
  }

  const abrirPdf = async () => {
    setLendoPdf(true)
    try {
      carregarResultado(await window.api.pdf.abrir())
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setLendoPdf(false)
    }
  }

  const soltarArquivo = async (f: File | undefined) => {
    setArrastando(false)
    if (!f) return
    if (!/\.pdf$/i.test(f.name)) return avisar('Solte um arquivo PDF.', 'erro')
    setLendoPdf(true)
    try {
      carregarResultado(await window.api.pdf.lerArquivo(f))
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setLendoPdf(false)
    }
  }

  const novoManual = () => {
    const p = pedidoManual()
    setArquivo(null)
    setPedidos({ [p.chave]: p })
    setAtual(p.chave)
    setModo('ORIGINAL')
  }

  // ---------------- produtos no ERP (uma consulta para o pedido inteiro)
  const buscarProdutos = useCallback(
    async (forcar = false) => {
      if (!est || !ativa) return
      if (!forcar && est.produtosDe === ativa.id) return
      const codigos = est.linhas.map((l) => l.codigoLido.trim()).filter(Boolean)
      if (codigos.length === 0) return
      setBuscando(true)
      try {
        const achados = await window.api.erp.produtos(ativa.id, codigos)
        alterar((e) => ({
          ...e,
          produtosDe: ativa.id,
          linhas: e.linhas.map((l) => (l.codigoLido.trim() ? { ...l, produto: achados[l.codigoLido.trim()] ?? null } : l))
        }))
      } catch (e) {
        avisar(`Não foi possível buscar os produtos: ${(e as Error).message}`, 'erro')
      } finally {
        setBuscando(false)
      }
    },
    [est, ativa, alterar, avisar]
  )

  useEffect(() => {
    if (est && ativa && status.estado === 'on' && est.produtosDe !== ativa.id) void buscarProdutos()
  }, [est?.chave, est?.produtosDe, ativa?.id, status.estado]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- cliente no ERP
  const [cliente, setCliente] = useState<{ carregando: boolean; dado: ClienteErp | null; erro?: string }>({ carregando: false, dado: null })
  const [limitePedido, setLimitePedido] = useState(15)
  useEffect(() => {
    const cnpj = est ? soDigitos(est.cnpj) : ''
    if (!ativa || status.estado !== 'on' || cnpj.length < 11) {
      setCliente({ carregando: false, dado: null })
      return
    }
    let vivo = true
    setCliente({ carregando: true, dado: null })
    const t = setTimeout(() => {
      window.api.erp
        .cliente(ativa.id, cnpj)
        .then((dado) => vivo && setCliente({ carregando: false, dado }))
        .catch((e: Error) => vivo && setCliente({ carregando: false, dado: null, erro: e.message }))
    }, 350)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [est?.cnpj, ativa?.id, status.estado]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ativa && status.estado === 'on') window.api.erp.limitePedido(ativa.id).then(setLimitePedido).catch(() => setLimitePedido(15))
  }, [ativa?.id, status.estado]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- cálculos
  const opcoes = useMemo(
    () => ({ modo, abaterST, quantidadeInteira: qtdInteira, regras: { cstsComST: ativa?.regras.cstsComST ?? ['10', '70'] } }),
    [modo, abaterST, qtdInteira, ativa?.regras.cstsComST]
  )
  const calcs = useMemo(() => (est ? est.linhas.map((l) => calcularLinha(l, opcoes)) : []), [est, opcoes])
  const resumo = useMemo(() => resumir(calcs), [calcs])
  const temEdicaoManual = !!est?.linhas.some((l) => l.manual && Object.keys(l.manual).length)

  // Fornecedor do PDF x empresa da conexão
  const fornecedorDiferente =
    est?.pdf?.cnpjFornecedor && ativa && ativa.cnpjsEmpresa.length > 0 && !ativa.cnpjsEmpresa.map(cnpj14).includes(cnpj14(est.pdf.cnpjFornecedor))

  // Conexão cadastrada com o CNPJ do fornecedor do PDF (para sugerir a troca)
  const conexaoSugerida = useMemo(() => {
    const forn = est?.pdf?.cnpjFornecedor ? cnpj14(est.pdf.cnpjFornecedor) : ''
    if (!forn || (ativa && ativa.cnpjsEmpresa.map(cnpj14).includes(forn))) return null
    return perfis.find((p) => p.cnpjsEmpresa.map(cnpj14).includes(forn)) ?? null
  }, [est?.pdf?.cnpjFornecedor, ativa, perfis])

  // ---------------- edição
  const editarLinha = (id: string, campo: 'quantidade' | 'quantidadeUnid' | 'preco', valor: string) => {
    alterar((e) => ({
      ...e,
      linhas: e.linhas.map((l) => (l.id === id ? { ...l, manual: { ...l.manual, [campo]: numeroBR(valor) } } : l))
    }))
  }
  const editarCodigo = (id: string, valor: string) => {
    alterar((e) => ({
      ...e,
      produtosDe: '',
      linhas: e.linhas.map((l) => (l.id === id ? { ...l, codigoLido: valor.trim(), produto: undefined } : l))
    }))
  }
  const removerLinha = (id: string) => alterar((e) => ({ ...e, linhas: e.linhas.filter((l) => l.id !== id) }))
  const removerNaoEncontrados = () => {
    alterar((e) => ({ ...e, linhas: e.linhas.filter((l) => l.produto !== null) }))
    setSoProblemas(false)
  }
  const adicionarLinha = () =>
    alterar((e) => ({ ...e, linhas: [...e.linhas, { id: novoId(), codigoLido: '', quantidadeOriginal: 0, precoOriginal: 0 }] }))
  const desfazerEdicoes = () => alterar((e) => ({ ...e, linhas: e.linhas.map((l) => ({ ...l, manual: undefined })) }))

  const aplicarColagem = (texto: string) => {
    const novas: LinhaPedido[] = []
    for (const bruta of texto.split(/\r?\n/)) {
      const cols = bruta.split(/\t|;/).map((c) => c.trim())
      if (!cols[0]) continue
      novas.push({ id: novoId(), codigoLido: soDigitos(cols[0]) || cols[0], quantidadeOriginal: numeroBR(cols[1] ?? '0'), precoOriginal: numeroBR(cols[2] ?? '0') })
    }
    if (!novas.length) return avisar('Nada para colar: use uma linha por item (código, quantidade, valor).', 'erro')
    alterar((e) => ({ ...e, produtosDe: '', linhas: [...e.linhas.filter((l) => l.codigoLido), ...novas] }))
    setColar(false)
    avisar(`${novas.length} itens adicionados.`, 'ok')
  }

  // ---------------- geração
  const [confirmar, setConfirmar] = useState<FiltroST | null>(null)
  const [existentes, setExistentes] = useState<{ erp: PreVendaExistente[]; nuvem: RegistroHistorico[] } | null>(null)
  const [mesmoAssim, setMesmoAssim] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [resultado, setResultado] = useState<{ r: ResultadoGeracao; filtro: FiltroST; avisoHistorico?: string } | null>(null)

  const idsParaEnviar = (filtro: FiltroST) => (est ? est.linhas.filter((_, i) => calcs[i].status === 'ok' && passaFiltro(calcs[i], filtro)).map((l) => l.id) : [])

  const bloqueio = (() => {
    if (!est) return 'Abra um pedido.'
    if (!ativa) return 'Selecione uma conexão na faixa superior.'
    if (status.estado !== 'on') return 'Sem conexão com o banco.'
    if (resumo.pendentes > 0 || buscando) return 'Aguardando a busca dos produtos.'
    if (resumo.naoEncontrados > 0) return `${resumo.naoEncontrados} produto(s) não localizado(s) no ERP: corrija ou remova antes de gerar.`
    if (resumo.comProblema > 0) return `${resumo.comProblema} item(ns) sem quantidade ou valor.`
    if (!soDigitos(est.cnpj)) return 'Informe o CNPJ do cliente.'
    if (!cliente.dado) return cliente.carregando ? 'Procurando o cliente…' : 'Cliente não encontrado neste banco.'
    if (!est.pedidoCompra.trim()) return 'Informe o nº do pedido de compra.'
    if (est.pedidoCompra.trim().length > limitePedido) return `Nº do pedido de compra com mais de ${limitePedido} caracteres.`
    return ''
  })()

  const abrirConfirmacao = async (filtro: FiltroST) => {
    if (!est || !ativa || !cliente.dado) return
    if (idsParaEnviar(filtro).length === 0) {
      avisar(`Nenhum item ${filtro === 'ST' ? 'com ST' : 'sem ST'} neste pedido. Nenhuma pré-venda foi criada.`, 'erro')
      return
    }
    setMesmoAssim(false)
    setExistentes(null)
    setConfirmar(filtro)
    const [erp, hist] = await Promise.all([
      window.api.erp.verificarPedido(ativa.id, cliente.dado.codigo, est.pedidoCompra.trim()).catch(() => []),
      nuvem.jaGeradoNoHistorico(ativa.cliente, cnpj14(est.cnpj), est.pedidoCompra.trim()).catch(() => [])
    ])
    setExistentes({ erp, nuvem: hist })
  }

  const gerar = async () => {
    if (!est || !ativa || !confirmar || !perfil) return
    const filtro = confirmar
    const ids = new Set(idsParaEnviar(filtro))
    const itens = est.linhas
      .map((l, i) => ({ l, c: calcs[i] }))
      .filter(({ l }) => ids.has(l.id))
      .map(({ l, c }) => ({ codigo: l.produto!.codigo, quantidade: c.quantidade, quantidadeUnid: c.quantidadeUnid, preco: c.preco }))
    setGerando(true)
    try {
      const r = await window.api.erp.gerar(ativa.id, { cnpj: est.cnpj, pedidoCompra: est.pedidoCompra.trim(), filtro, itens, usuario: perfil.nome })
      let avisoHistorico: string | undefined
      try {
        await nuvem.registrarPreVenda({
          usuario_nome: perfil.nome,
          estacao: await window.api.sistema.estacao(),
          conexao_cliente: ativa.cliente,
          conexao_nome: ativa.nome,
          banco: ativa.banco,
          ano: r.ano,
          numero: r.numero,
          cliente_codigo: r.clienteCodigo,
          cliente_nome: r.clienteNome,
          cliente_cnpj: cnpj14(est.cnpj),
          pedido_compra: est.pedidoCompra.trim(),
          filtro,
          qtd_itens: r.qtdItens,
          total: r.total,
          total_com_st: r.totalComST,
          arquivo_pdf: est.arquivo
        })
      } catch (e) {
        avisoHistorico = `A pré-venda foi criada no ERP, mas não entrou no histórico da nuvem: ${(e as Error).message}`
      }
      alterar((e) => ({
        ...e,
        enviados: [...new Set([...e.enviados, ...ids])],
        geracoes: [...e.geracoes, { ano: r.ano, numero: r.numero, filtro, conexao: `${ativa.cliente} › ${ativa.nome}` }]
      }))
      setConfirmar(null)
      setResultado({ r, filtro, avisoHistorico })
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setGerando(false)
    }
  }

  // ---------------- render
  const refArquivo = useRef<HTMLDivElement>(null)
  if (!visivel) return null

  if (!est) {
    return (
      <div className="pagina">
        <div
          ref={refArquivo}
          className={`vazio ${arrastando ? 'arrastando' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); void soltarArquivo(e.dataTransfer.files[0]) }}
        >
          <h2>Abra o pedido de compra</h2>
          <p>Arraste o PDF aqui ou clique em abrir. Se o arquivo tiver pedidos de várias lojas, você escolhe qual gerar.</p>
          <div className="acoes">
            <button className="botao primario grande" onClick={abrirPdf} disabled={lendoPdf}>
              {lendoPdf ? <span className="spinner" /> : <Icone nome="pdf" />} Abrir PDF
            </button>
            <button className="botao grande" onClick={novoManual}>
              <Icone nome="colar" /> Digitar ou colar itens
            </button>
          </div>
          {!ativa && <p className="mini" style={{ marginTop: 18, marginBottom: 0 }}>Antes de gerar, escolha a conexão do cliente na faixa superior.</p>}
        </div>
      </div>
    )
  }

  const linhasVisiveis = est.linhas.map((l, i) => ({ l, c: calcs[i], i })).filter(({ c }) => !soProblemas || c.status !== 'ok')
  const qtdComST = idsParaEnviar('ST').length
  const qtdSemST = idsParaEnviar('SEM_ST').length

  return (
    <div className="pagina cheia">
      <div className="pedido-topo">
        <div className="arquivo-linha">
          {est.origem === 'pdf' ? <span className="nome-arquivo">{est.arquivo}</span> : <span className="nome-arquivo">Pedido digitado</span>}
          {arquivo && <span className="fraco mini">{arquivo.pedidos.length} pedido(s) no arquivo</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="botao" onClick={abrirPdf} disabled={lendoPdf}><Icone nome="pdf" /> Abrir outro PDF</button>
            <button className="botao" onClick={novoManual}><Icone nome="mais" /> Pedido em branco</button>
          </span>
        </div>

        {arquivo && arquivo.pedidos.length > 1 && (
          <div className="pedidos-arquivo">
            {arquivo.pedidos.map((p) => {
              const e = pedidos[p.numero]
              const gerado = (e?.geracoes.length ?? 0) > 0
              return (
                <button key={p.numero} className={`pedido-chip ${p.numero === atual ? 'atual' : ''} ${gerado ? 'gerado' : ''}`} onClick={() => setAtual(p.numero)}>
                  <b>{p.numero}</b>
                  <span>{p.loja || formatarCnpj(p.cnpjLoja)}</span>
                  <span style={{ display: 'block' }}>
                    {p.itens.length} itens{p.totalPdf !== null ? `, ${moeda(p.totalPdf)}` : ''}
                    {gerado ? `, gerada ${e.geracoes.map((g) => g.numero).join(', ')}` : ''}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="dados-pedido">
          <label className="campo">
            <span>CNPJ do cliente</span>
            <input className="entrada" value={est.origem === 'pdf' && soDigitos(est.cnpj).length === 14 ? formatarCnpj(est.cnpj) : est.cnpj}
              onChange={(e) => alterar((x) => ({ ...x, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" />
          </label>
          <div className="cliente-erp">
            {cliente.carregando ? (
              <span className="fraco"><span className="spinner" /> Procurando o cliente no ERP…</span>
            ) : cliente.dado ? (
              <>
                <div className="nome">{cliente.dado.nome || 'Cliente'} <span className="etiqueta neutra">cód. {cliente.dado.codigo}</span> <span className="etiqueta neutra">setor {cliente.dado.setor}</span></div>
                <div className="mini fraco">{est.pdf?.loja ? `${est.pdf.loja}. ` : ''}{est.pdf?.entregaPrevista ? `Entrega prevista ${est.pdf.entregaPrevista}.` : ''}</div>
              </>
            ) : soDigitos(est.cnpj).length >= 11 && status.estado === 'on' ? (
              <span style={{ color: 'var(--erro)', fontWeight: 600 }}>Cliente não encontrado em {ativa?.cliente} › {ativa?.nome}{cliente.erro ? `: ${cliente.erro}` : ''}</span>
            ) : (
              <span className="fraco">O cliente aparece aqui quando o CNPJ for localizado no ERP.</span>
            )}
          </div>
          <label className="campo">
            <span>Nº do pedido de compra</span>
            <input className={`entrada ${est.pedidoCompra.length > limitePedido ? 'invalida' : ''}`} value={est.pedidoCompra}
              onChange={(e) => alterar((x) => ({ ...x, pedidoCompra: e.target.value }))} />
            <small>{est.pedidoCompra.length} de {limitePedido} caracteres</small>
          </label>
        </div>

        {!ativa && !conexaoSugerida && <Alerta tipo="aviso">Escolha na faixa superior em qual banco gerar este pedido.</Alerta>}
        {conexaoSugerida && (
          <Alerta tipo="aviso" acoes={<button className="botao" onClick={() => selecionar(conexaoSugerida.id)}>Usar {conexaoSugerida.cliente} › {conexaoSugerida.nome}</button>}>
            Este pedido é para <b>{est.pdf?.fornecedor}</b>, cadastrado na conexão <b>{conexaoSugerida.cliente} › {conexaoSugerida.nome}</b>{ativa ? <>, mas você está em <b>{ativa.cliente} › {ativa.nome}</b></> : ''}.
          </Alerta>
        )}
        {fornecedorDiferente && !conexaoSugerida && (
          <Alerta tipo="aviso">
            Este PDF é um pedido para o fornecedor <b>{est.pdf?.fornecedor} ({formatarCnpj(est.pdf!.cnpjFornecedor)})</b>, que não está cadastrado na conexão <b>{ativa?.cliente} › {ativa?.nome}</b>. Confira se o banco está certo.
          </Alerta>
        )}
        {est.pdf?.avisos.map((a) => <Alerta key={a} tipo="erro">{a}</Alerta>)}
        {est.geracoes.length > 0 && (
          <Alerta tipo="ok">
            Pré-venda gerada neste pedido: {est.geracoes.map((g) => `${g.numero}/${g.ano} (${NOMES_FILTRO[g.filtro]}, ${g.conexao})`).join('; ')}.
          </Alerta>
        )}
        {resumo.naoEncontrados > 0 && (
          <Alerta tipo="erro" acoes={<>
            <button className="botao" onClick={() => setSoProblemas((s) => !s)}>{soProblemas ? 'Mostrar todos' : 'Mostrar só eles'}</button>
            <button className="botao perigo" onClick={removerNaoEncontrados}>Remover do pedido</button>
          </>}>
            <b>{resumo.naoEncontrados} produto(s) não localizado(s)</b> em {ativa?.cliente} › {ativa?.nome}. A planilha deixava esses itens de fora sem avisar; aqui a geração fica bloqueada até você decidir.
          </Alerta>
        )}
      </div>

      <div className="barra-ferramentas">
        <div className="grupo">
          <span className="rotulo">Conversão</span>
          <div className="segmentos" role="group" aria-label="Conversão">
            {([['ORIGINAL', 'Como no pedido'], ['CAIXA', 'Pedido em caixa'], ['UNIDADE', 'Pedido em unidade']] as const).map(([m, t]) => (
              <button key={m} className={modo === m ? 'ativo' : ''} onClick={() => setModo(m)} aria-pressed={modo === m}>{t}</button>
            ))}
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={abaterST} onChange={(e) => setAbaterST(e.target.checked)} /> Abater ST do valor</label>
        <label className="check"><input type="checkbox" checked={qtdInteira} onChange={(e) => setQtdInteira(e.target.checked)} /> Qtd. sem decimais</label>
        <div className="direita">
          {temEdicaoManual && <button className="botao leve" onClick={desfazerEdicoes}>Desfazer edições</button>}
          <button className="botao leve" onClick={() => setColar(true)}><Icone nome="colar" /> Colar</button>
          <button className="botao leve" onClick={adicionarLinha}><Icone nome="mais" /> Item</button>
          <button className="botao leve" onClick={() => void buscarProdutos(true)} disabled={buscando || status.estado !== 'on'}>
            {buscando ? <span className="spinner" /> : <Icone nome="atualizar" />} Buscar de novo
          </button>
        </div>
      </div>

      <div className="area-tabela">
        <table className="tabela">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Cód. barras</th>
              <th className="num">Quantidade</th>
              <th className="num">Qtd. unid.</th>
              <th className="num">Valor unit.</th>
              <th>Código</th>
              <th>Descrição</th>
              <th>Unid.</th>
              <th className="num">Unidades</th>
              <th className="num">Und. fornec.</th>
              <th className="num">ICMS-ST</th>
              <th className="num">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhasVisiveis.map(({ l, c, i }) => {
              const enviado = est.enviados.includes(l.id)
              const p = l.produto
              const classe = [c.status === 'nao-encontrado' ? 'nao-encontrado' : '', enviado ? 'enviado' : c.temST ? 'com-st' : ''].join(' ')
              return (
                <tr key={l.id} className={classe}>
                  <td className="idx num">{i + 1}</td>
                  <td>
                    {est.origem === 'manual' || c.status === 'nao-encontrado' ? (
                      <input className="celula esq" defaultValue={l.codigoLido} onBlur={(e) => e.target.value.trim() !== l.codigoLido && editarCodigo(l.id, e.target.value)} aria-label="Código de barras" style={{ width: 140 }} />
                    ) : (
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{l.codigoLido}</span>
                    )}
                  </td>
                  <CelulaNum valor={c.quantidade} casas={4} convertido={c.convertidaQtd} editado={l.manual?.quantidade !== undefined} aoMudar={(v) => editarLinha(l.id, 'quantidade', v)} rotulo="Quantidade" />
                  <CelulaNum valor={c.quantidadeUnid} casas={4} convertido={false} editado={l.manual?.quantidadeUnid !== undefined} aoMudar={(v) => editarLinha(l.id, 'quantidadeUnid', v)} rotulo="Quantidade em unidades" />
                  <CelulaNum valor={c.preco} casas={2} moeda convertido={c.convertidaPreco || c.stAbatido} editado={l.manual?.preco !== undefined} aoMudar={(v) => editarLinha(l.id, 'preco', v)} rotulo="Valor unitário" />
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p?.codigo ?? ''}</td>
                  <td className="desc">
                    {p === undefined ? <span className="fraco">{l.descricaoPdf ?? (l.codigoLido ? 'Buscando…' : '')}</span> :
                      p === null ? <>Código não localizado no ERP{l.descricaoPdf ? <div className="mini" style={{ fontWeight: 400 }}>No PDF: {l.descricaoPdf}</div> : null}</> :
                      <>{p.descricao}{' '}{c.temST && <span className="etiqueta st">ST {p.sitTrib}</span>}{enviado && <span className="etiqueta ok">enviado</span>}{c.aviso && <div className="mini" style={{ color: 'var(--aviso)', fontWeight: 400 }}>{c.aviso}</div>}</>}
                  </td>
                  <td>{p?.unid ?? ''}</td>
                  <td className="num">{p ? qtd(p.unidades) : ''}</td>
                  <td className="num">{p ? qtd(p.qtUndFor) : ''}</td>
                  <td className="num">{c.icmsf ? numero(c.icmsf) : ''}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{numero(c.total)}</td>
                  <td>
                    <button className="botao leve remover" onClick={() => removerLinha(l.id)} title="Remover item" aria-label="Remover item"><Icone nome="lixo" tamanho={15} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="rodape-pedido">
        <div className="indicador"><small>Itens</small><b>{resumo.linhas}</b></div>
        <div className={`indicador ${resumo.naoEncontrados ? 'erro' : ''}`}><small>Não localizados</small><b>{resumo.naoEncontrados}</b></div>
        <div className="indicador st"><small>Com ST</small><b>{resumo.comST}</b></div>
        <span className="divisor" />
        <div className="indicador"><small>Total</small><b>{moeda(resumo.total)}</b></div>
        <div className="indicador"><small>Total com ST</small><b>{moeda(resumo.totalComST)}</b></div>
        {est.pdf?.totalPdf != null && <div className="indicador"><small>Total no PDF</small><b>{moeda(est.pdf.totalPdf)}</b></div>}
        <div className="acoes">
          {bloqueio && <span className="mini" style={{ color: 'var(--grafite)', maxWidth: 300, textAlign: 'right' }}>{bloqueio}</span>}
          <button className="botao" disabled={!!bloqueio || qtdComST === 0} onClick={() => void abrirConfirmacao('ST')} title="Gera uma pré-venda só com os produtos com ST">Só com ST ({qtdComST})</button>
          <button className="botao" disabled={!!bloqueio || qtdSemST === 0} onClick={() => void abrirConfirmacao('SEM_ST')} title="Gera uma pré-venda só com os produtos sem ST">Só sem ST ({qtdSemST})</button>
          <button className="botao primario grande" disabled={!!bloqueio} onClick={() => void abrirConfirmacao('TODOS')}>Gerar pré-venda</button>
        </div>
      </div>

      {/* ---------- confirmação ---------- */}
      <Modal aberto={!!confirmar} aoFechar={() => !gerando && setConfirmar(null)} faixaBanco rotulo="Confirmar geração"
        botoes={<>
          <button className="botao" onClick={() => setConfirmar(null)} disabled={gerando}>Cancelar</button>
          <button className="botao primario" onClick={() => void gerar()}
            disabled={gerando || !existentes || ((existentes.erp.length > 0 || existentes.nuvem.length > 0) && !mesmoAssim)}>
            {gerando ? <><span className="spinner" /> Gerando…</> : 'Gerar no ERP'}
          </button>
        </>}>
        {confirmar && est && ativa && (
          <>
            <h2>Gerar pré-venda em {ativa.cliente} › {ativa.nome}?</h2>
            <dl className="resumo-geracao">
              <dt>Banco</dt><dd>{ativa.servidor}{ativa.instancia ? '\\' + ativa.instancia : ''} / {ativa.banco}</dd>
              <dt>Cliente</dt><dd>{cliente.dado?.nome} (cód. {cliente.dado?.codigo}, setor {cliente.dado?.setor})</dd>
              <dt>CNPJ</dt><dd>{formatarCnpj(est.cnpj)}</dd>
              <dt>Pedido de compra</dt><dd>{est.pedidoCompra}</dd>
              <dt>Itens</dt><dd>{idsParaEnviar(confirmar).length} ({NOMES_FILTRO[confirmar]})</dd>
              <dt>Total</dt><dd>{moeda(calcs.filter((c) => c.status === 'ok' && passaFiltro(c, confirmar)).reduce((s, c) => s + c.total, 0))}</dd>
            </dl>
            {!existentes && <span className="fraco mini"><span className="spinner" /> Conferindo se este pedido já foi lançado…</span>}
            {existentes && (existentes.erp.length > 0 || existentes.nuvem.length > 0) && (
              <Alerta tipo="aviso">
                <b>Este pedido de compra já foi lançado para este cliente.</b>
                {existentes.erp.map((x) => <div key={x.ano + x.numero}>Pré-venda {x.numero}/{x.ano} no ERP{x.data ? `, em ${x.data}` : ''}</div>)}
                {existentes.nuvem.map((x) => <div key={x.id}>Gerada pelo programa: {x.numero}/{x.ano} por {x.usuario_nome} em {new Date(x.criado_em!).toLocaleString('pt-BR')}</div>)}
                <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={mesmoAssim} onChange={(e) => setMesmoAssim(e.target.checked)} /> Gerar mesmo assim</label>
              </Alerta>
            )}
            <p className="mini fraco">Tudo é gravado de uma vez. Se qualquer item falhar, nada fica no ERP.</p>
          </>
        )}
      </Modal>

      {/* ---------- resultado ---------- */}
      <Modal aberto={!!resultado} aoFechar={() => setResultado(null)} faixaBanco rotulo="Pré-venda criada"
        botoes={<button className="botao primario" onClick={() => setResultado(null)} autoFocus>Fechar</button>}>
        {resultado && (
          <>
            <p className="fraco">Pré-venda criada em {ativa?.cliente} › {ativa?.nome}</p>
            <div className="numero-gerado">{resultado.r.numero}/{resultado.r.ano}</div>
            <dl className="resumo-geracao">
              <dt>Cliente</dt><dd>{resultado.r.clienteNome || resultado.r.clienteCodigo} (setor {resultado.r.setor})</dd>
              <dt>Itens</dt><dd>{resultado.r.qtdItens} ({NOMES_FILTRO[resultado.filtro]})</dd>
              <dt>Total</dt><dd>{moeda(resultado.r.total)}</dd>
              <dt>Total com ST</dt><dd>{moeda(resultado.r.totalComST)}</dd>
            </dl>
            {resultado.avisoHistorico && <Alerta tipo="aviso">{resultado.avisoHistorico}</Alerta>}
          </>
        )}
      </Modal>

      <ModalColar aberto={colar} aoFechar={() => setColar(false)} aoColar={aplicarColagem} />
    </div>
  )
}

// ----------------------------------------------------------------- célula editável
function CelulaNum({ valor, casas, moeda: ehMoeda, convertido, editado, aoMudar, rotulo }: {
  valor: number; casas: number; moeda?: boolean; convertido: boolean; editado: boolean; aoMudar: (v: string) => void; rotulo: string
}) {
  const texto = ehMoeda ? numero(valor, casas) : qtd(valor, casas)
  const [rascunho, setRascunho] = useState<string | null>(null)
  return (
    <td className={`num ${convertido ? 'convertido' : ''} ${editado ? 'editado' : ''}`} style={{ width: 110 }}>
      <input
        className="celula"
        aria-label={rotulo}
        value={rascunho ?? texto}
        onFocus={(e) => { setRascunho(texto); requestAnimationFrame(() => e.target.select()) }}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => { if (rascunho !== null && rascunho !== texto) aoMudar(rascunho); setRascunho(null) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setRascunho(null); (e.target as HTMLInputElement).blur() }
        }}
      />
    </td>
  )
}

function ModalColar({ aberto, aoFechar, aoColar }: { aberto: boolean; aoFechar: () => void; aoColar: (t: string) => void }) {
  const [texto, setTexto] = useState('')
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} largo rotulo="Colar itens"
      botoes={<><button className="botao" onClick={aoFechar}>Cancelar</button><button className="botao primario" onClick={() => { aoColar(texto); setTexto('') }}>Adicionar itens</button></>}>
      <h2>Colar itens</h2>
      <p className="fraco">Copie do Excel três colunas: código de barras (ou código do produto), quantidade e valor unitário. Uma linha por item.</p>
      <textarea className="entrada" rows={12} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'7898717040944\t2\t8,99\n7898717040340\t1\t1,69'} style={{ fontVariantNumeric: 'tabular-nums' }} autoFocus />
    </Modal>
  )
}
