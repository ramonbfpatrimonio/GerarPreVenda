import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClienteErp, FiltroST, PedidoPdf, PreVendaExistente, ProdutoErp, ResultadoGeracao, ResultadoPdf } from '@shared/tipos'
import { calcularLinha, passaFiltro, resumir, type LinhaPedido, type ModoConversao } from '@shared/regras'
import { cnpj14, formatarCnpj, moeda, numero, numeroBR, qtd, soDigitos } from '@shared/numeros'
import { useAviso, useConexoes, useSessao } from '../contexto'
import { nuvem, type RegistroHistorico } from '../servicos'
import { Icone } from '../componentes/Icone'
import { Alerta, Modal } from '../componentes/Modal'
import { nomeDoModelo } from '@shared/pdf/modelos'

// ----------------------------------------------------------------- estado
interface Geracao { ano: string; numero: string; filtro: FiltroST; conexao: string; nomeConexao?: string; qtd?: number }

interface EstadoPedido {
  chave: string
  origem: 'pdf' | 'manual'
  pdf?: PedidoPdf
  arquivo: string
  cnpj: string
  pedidoCompra: string
  linhas: LinhaPedido[]
  enviados: string[] // ids das linhas já enviadas
  envioDe: Record<string, string> // linha -> "COMERCIO 000413"
  fora: string[] // linhas deixadas de fora pelo usuário (continuam na lista)
  geracoes: Geracao[]
  produtosDe: string // id da conexão de onde vieram os produtos
  cache: Record<string, Record<string, ProdutoErp | null>> // produtos já consultados em cada banco
  // conversão é de cada pedido
  modo: ModoConversao
  abaterST: boolean
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
    envioDe: {},
    fora: [],
    geracoes: [],
    produtosDe: '',
    cache: {},
    modo: 'ORIGINAL',
    abaterST: false
  }
}

const NOMES_FILTRO: Record<FiltroST, string> = { TODOS: 'todos os itens', ST: 'só itens com ST', SEM_ST: 'só itens sem ST' }

// ----------------------------------------------------------------- página
export function Pagina_Pedido({ visivel }: { visivel: boolean }) {
  const { ativa, status, ativos: perfis, selecionar } = useConexoes()
  const { perfil, empresaAtual, registrarNoHistorico, internet } = useSessao()
  const avisar = useAviso()

  const [arquivo, setArquivo] = useState<ResultadoPdf | null>(null)
  const [pedidos, setPedidos] = useState<Record<string, EstadoPedido>>({})
  const [atual, setAtual] = useState<string | null>(null)
  const [lendoPdf, setLendoPdf] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const [layoutIndisponivel, setLayoutIndisponivel] = useState<string | null>(null) // nome do PDF sem layout cadastrado
  // filtros da lista (menu "Exibir")
  const [exibir, setExibir] = useState({ localizados: false, naoLocalizados: false, ocultarEnviados: false })
  useEffect(() => {
    // fecha o menu "Exibir" ao clicar fora dele
    const fora = (e: MouseEvent) =>
      document.querySelectorAll<HTMLDetailsElement>('details.menu-exibir[open]').forEach((d) => !d.contains(e.target as Node) && d.removeAttribute('open'))
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const est = atual ? pedidos[atual] : null
  const alterar = useCallback(
    (f: (e: EstadoPedido) => EstadoPedido) => setPedidos((ps) => (atual && ps[atual] ? { ...ps, [atual]: f(ps[atual]) } : ps)),
    [atual]
  )
  // conversão de cada pedido (trocar num pedido não mexe nos outros)
  const modo: ModoConversao = est?.modo ?? 'ORIGINAL'
  const abaterST = est?.abaterST ?? false
  const setModo = (m: ModoConversao) => alterar((e) => ({ ...e, modo: m }))
  const setAbaterST = (v: boolean) => alterar((e) => ({ ...e, abaterST: v }))

  // ---------------- abrir PDF
  const carregarResultado = (r: ResultadoPdf | null) => {
    if (!r) return
    // PDF de um layout que o sistema ainda não tem: aviso no centro da tela
    if (r.pedidos.length === 0 && !r.modelo) return setLayoutIndisponivel(r.arquivo)
    r.avisos.forEach((a) => avisar(a, 'erro'))
    if (r.pedidos.length === 0) return
    setArquivo(r)
    const novos: Record<string, EstadoPedido> = {}
    for (const p of r.pedidos) novos[p.numero] = deItensPdf(p, r.arquivo)
    setPedidos(novos)
    setAtual(r.pedidos[0].numero)
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


  // Fecha o arquivo/pedido aberto (para importar outro)
  const fecharArquivo = () => {
    const pendentes = Object.values(pedidos).reduce(
      (s, e) => s + e.linhas.filter((l) => l.produto && !e.enviados.includes(l.id) && !e.fora.includes(l.id)).length,
      0
    )
    const algumGerado = Object.values(pedidos).some((e) => e.geracoes.length > 0)
    if ((pendentes > 0 || !algumGerado) && !confirm(pendentes > 0 ? `Fechar este pedido? ${pendentes} item(ns) localizado(s) ainda não foram gerados.` : 'Fechar este pedido sem gerar a pré-venda?')) return
    setPedidos({})
    setAtual(null)
    setArquivo(null)
    setExibir({ localizados: false, naoLocalizados: false, ocultarEnviados: false })
  }

  // ---------------- produtos no ERP (uma consulta para o pedido inteiro)
  const buscarProdutos = useCallback(
    async (forcar = false) => {
      if (!est || !ativa) return
      if (!forcar && est.produtosDe === ativa.id) return
      const codigos = [...new Set(est.linhas.map((l) => l.codigoLido.trim()).filter(Boolean))]
      if (codigos.length === 0) return
      // cada banco é consultado uma vez; ao voltar para um banco, usa o que já foi lido
      const jaLidos = forcar ? {} : est.cache[ativa.id] ?? {}
      const faltam = codigos.filter((c) => !(c in jaLidos))
      setBuscando(faltam.length > 0)
      try {
        const novos = faltam.length ? await window.api.erp.produtos(ativa.id, faltam) : {}
        const doBanco: Record<string, ProdutoErp | null> = { ...jaLidos }
        for (const c of faltam) doBanco[c] = novos[c] ?? null
        alterar((e) => ({
          ...e,
          produtosDe: ativa.id,
          cache: { ...e.cache, [ativa.id]: doBanco },
          // linhas já enviadas mantêm o produto do banco em que foram geradas
          linhas: e.linhas.map((l) =>
            e.enviados.includes(l.id) || !l.codigoLido.trim() ? l : { ...l, produto: doBanco[l.codigoLido.trim()] ?? null }
          )
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
    () => ({ modo, abaterST, quantidadeInteira: false, regras: { cstsComST: ativa?.regras.cstsComST ?? ['10', '70'] } }),
    [modo, abaterST, ativa?.regras.cstsComST]
  )
  const calcs = useMemo(() => (est ? est.linhas.map((l) => calcularLinha(l, opcoes)) : []), [est, opcoes])
  // Linhas "em aberto": nem enviadas nem deixadas de fora. O resumo e a geração olham só para elas.
  const emAberto = (id: string) => !!est && !est.enviados.includes(id) && !est.fora.includes(id)
  const resumo = useMemo(() => {
    const abertos = est ? calcs.filter((_, i) => emAberto(est.linhas[i].id)) : []
    // os totais são do que vai nesta pré-venda (só os localizados)
    const r = resumir(abertos)
    const ok = resumir(abertos.filter((c) => c.status === 'ok'))
    return { ...r, total: ok.total, totalComST: ok.totalComST, comST: ok.comST }
  }, [calcs, est]) // eslint-disable-line react-hooks/exhaustive-deps
  const qtdEnviados = est?.enviados.length ?? 0
  const qtdFora = est?.fora.length ?? 0
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
  const removerLinha = (id: string) =>
    alterar((e) => (e.origem === 'manual' ? { ...e, linhas: e.linhas.filter((l) => l.id !== id) } : { ...e, fora: e.fora.includes(id) ? e.fora.filter((x) => x !== id) : [...e.fora, id] }))
  const desfazerEdicoes = () => alterar((e) => ({ ...e, linhas: e.linhas.map((l) => ({ ...l, manual: undefined })) }))

  // ---------------- geração
  const [confirmar, setConfirmar] = useState<FiltroST | null>(null)
  const [existentes, setExistentes] = useState<{ erp: PreVendaExistente[]; nuvem: RegistroHistorico[] } | null>(null)
  const [mesmoAssim, setMesmoAssim] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [resultado, setResultado] = useState<{ r: ResultadoGeracao; filtro: FiltroST; avisoHistorico?: string } | null>(null)

  const idsParaEnviar = (filtro: FiltroST) => (est ? est.linhas.filter((l, i) => emAberto(l.id) && calcs[i].status === 'ok' && passaFiltro(calcs[i], filtro)).map((l) => l.id) : [])

  const bloqueio = (() => {
    if (!est) return 'Abra um pedido.'
    if (!empresaAtual) return 'Escolha a empresa na faixa superior.'
    if (!ativa) return 'Selecione uma conexão na faixa superior.'
    if (status.estado === 'sem-senha') return 'Falta a senha do SQL neste computador: peça ao super administrador.'
    if (status.estado !== 'on') return 'Sem conexão com o banco.'
    if (resumo.pendentes > 0 || buscando) return 'Aguardando a busca dos produtos.'
    if (resumo.comProblema > 0) return `${resumo.comProblema} item(ns) sem quantidade ou valor.`
    if (resumo.ok === 0) return resumo.naoEncontrados > 0 ? 'Nenhum item localizado neste banco para enviar.' : 'Todos os itens deste pedido já foram gerados.'
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
      internet ? nuvem.jaGeradoNoHistorico(empresaAtual?.id ?? null, cnpj14(est.cnpj), est.pedidoCompra.trim()).catch(() => []) : Promise.resolve([])
    ])
    // pré-vendas geradas agora, deste mesmo pedido (complemento), não contam como repetição
    const deste = (ano: string, num: string) => est.geracoes.some((g) => g.ano === ano && g.numero === num)
    setExistentes({ erp: erp.filter((x) => !deste(x.ano, x.numero)), nuvem: hist.filter((x) => !deste(x.ano, x.numero)) })
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
        const destino = await registrarNoHistorico({
          empresa_id: empresaAtual?.id,
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
        if (destino === 'na-fila') avisoHistorico = 'Sem internet: a pré-venda foi criada no ERP e entra no histórico da nuvem assim que a conexão voltar.'
      } catch (e) {
        avisoHistorico = `A pré-venda foi criada no ERP, mas não entrou no histórico da nuvem: ${(e as Error).message}`
      }
      alterar((e) => ({
        ...e,
        enviados: [...new Set([...e.enviados, ...ids])],
        envioDe: { ...e.envioDe, ...Object.fromEntries([...ids].map((id) => [id, `${ativa.nome} ${r.numero}`])) },
        geracoes: [...e.geracoes, { ano: r.ano, numero: r.numero, filtro, conexao: `${ativa.cliente} › ${ativa.nome}`, nomeConexao: ativa.nome, qtd: ids.size }]
      }))
      setConfirmar(null)
      setResultado({ r, filtro, avisoHistorico })
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setGerando(false)
    }
  }

  // ---------------- situação de cada pedido do arquivo (cor da caixinha e balão)
  // branco = nada gerado · amarelo = gerado em parte (ainda há itens não enviados) · verde = tudo enviado
  const situacao = (e: EstadoPedido) => {
    const total = e.linhas.length
    const enviados = e.linhas.filter((l) => e.enviados.includes(l.id)).length
    const nomeBanco = (id: string) => perfis.find((x) => x.id === id)?.nome ?? 'outro banco'
    const pend = e.linhas.filter((l) => !e.enviados.includes(l.id))
    const grupos = new Map<string, number>()
    for (const l of pend) {
      let motivo: string
      if (e.fora.includes(l.id)) motivo = 'deixado de fora'
      else {
        const cod = l.codigoLido.trim()
        const bancos = Object.entries(e.cache).filter(([, m]) => m[cod] === null).map(([id]) => nomeBanco(id))
        const achadoEm = Object.entries(e.cache).filter(([, m]) => m[cod]).map(([id]) => nomeBanco(id))
        motivo = achadoEm.length ? `localizado em ${achadoEm.join(' e ')}, ainda não gerado` : bancos.length ? `não localizado em ${bancos.join(' e ')}` : 'ainda não consultado'
      }
      grupos.set(motivo, (grupos.get(motivo) ?? 0) + 1)
    }
    const estado: 'novo' | 'parcial' | 'completo' = enviados === 0 ? 'novo' : enviados === total ? 'completo' : 'parcial'
    return { estado, total, enviados, pendentes: [...grupos].map(([motivo, n]) => ({ motivo, n })) }
  }
  const [balao, setBalao] = useState<{ chave: string; x: number; y: number } | null>(null)

  // ---------------- altura da parte de cima (puxe a barra para cima para a lista crescer)
  const refTopo = useRef<HTMLDivElement>(null)
  const [alturaTopo, setAlturaTopo] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem('pedido:alturaTopo'))
      return v > 0 ? v : null
    } catch {
      return null
    }
  })
  const guardarAltura = (h: number | null) => {
    setAlturaTopo(h)
    try {
      if (h === null) localStorage.removeItem('pedido:alturaTopo')
      else localStorage.setItem('pedido:alturaTopo', String(Math.round(h)))
    } catch {
      /* só não lembra */
    }
  }
  const comecarArraste = (ev: React.PointerEvent) => {
    const topo = refTopo.current
    if (!topo) return
    ev.preventDefault()
    const y0 = ev.clientY
    const h0 = topo.getBoundingClientRect().height
    const natural = topo.scrollHeight
    const mover = (e: PointerEvent) => {
      const h = Math.max(0, Math.min(natural, h0 + (e.clientY - y0)))
      setAlturaTopo(h >= natural - 2 ? null : h)
    }
    const soltar = (e: PointerEvent) => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      const h = Math.max(0, Math.min(natural, h0 + (e.clientY - y0)))
      guardarAltura(h >= natural - 2 ? null : h < 24 ? 0 : h)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }

  // ---------------- render
  const refArquivo = useRef<HTMLDivElement>(null)
  if (!visivel) return null

  const janelaLayout = (
    <Modal aberto={!!layoutIndisponivel} aoFechar={() => setLayoutIndisponivel(null)} rotulo="Layout de pedido indisponível"
      botoes={<button className="botao primario" onClick={() => setLayoutIndisponivel(null)} autoFocus>Entendi</button>}>
      <div className="layout-indisponivel">
        <div className="icone-layout" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 12v3M12 18h.01" /></svg>
        </div>
        <h2>Layout de pedido indisponível</h2>
        <p>O sistema ainda não tem o layout deste PDF, por isso não consegue ler o pedido.</p>
        <p className="arquivo-layout">{layoutIndisponivel}</p>
        <p className="fraco">Entre em contato com o suporte e envie este PDF para que o layout seja incluído no sistema.</p>
      </div>
    </Modal>
  )

  if (!est) {
    return (
      <div className="pagina">
        {janelaLayout}
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
          </div>
          {!ativa && <p className="mini" style={{ marginTop: 18, marginBottom: 0 }}>Antes de gerar, escolha a conexão do cliente na faixa superior.</p>}
        </div>
      </div>
    )
  }

  // situação de cada código no banco escolhido agora (undefined = ainda não consultado)
  const noBanco = (l: LinhaPedido) => (ativa ? est.cache[ativa.id]?.[l.codigoLido.trim()] : undefined)
  const linhasVisiveis = est.linhas
    .map((l, i) => ({ l, c: calcs[i], i }))
    .filter(({ l }) => {
      const achado = noBanco(l)
      if (exibir.localizados && !achado) return false
      if (exibir.naoLocalizados && achado !== null) return false
      if (exibir.ocultarEnviados && est.enviados.includes(l.id)) return false
      return true
    })
  const filtroAtivo = exibir.localizados ? 'somente localizados' : exibir.naoLocalizados ? 'somente não localizados' : exibir.ocultarEnviados ? 'sem os enviados' : 'todos os itens'
  const qtdComST = idsParaEnviar('ST').length
  const qtdSemST = idsParaEnviar('SEM_ST').length

  return (
    <div className="pagina cheia">
      {janelaLayout}
      <div className="pedido-barra-arquivo">
          <div className="arquivo-linha">
            {est.origem === 'pdf' ? <span className="nome-arquivo">{est.arquivo}</span> : <span className="nome-arquivo">Pedido digitado</span>}
            {arquivo && <span className="fraco mini">{arquivo.pedidos.length} pedido(s) no arquivo</span>}
            {arquivo?.modelo && <span className="etiqueta neutra" title="Modelo de pedido reconhecido (veja a aba Modelos de Pedido)">{nomeDoModelo(arquivo.modelo)}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="botao fechar-pedido" onClick={fecharArquivo} title="Fechar este pedido para importar outro" aria-label="Fechar pedido">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg> Fechar
              </button>
            </span>
          </div>
      </div>
      <div className={`pedido-topo ${alturaTopo === 0 ? 'recolhido' : ''}`} ref={refTopo} style={alturaTopo !== null ? { maxHeight: alturaTopo, overflow: 'auto' } : undefined}>

        {arquivo && arquivo.pedidos.length > 0 && (
          <div className="pedidos-arquivo">
            {arquivo.pedidos.map((p) => {
              const e = pedidos[p.numero]
              const sit = e ? situacao(e) : null
              return (
                <button key={p.numero} className={`pedido-chip ${p.numero === atual ? 'atual' : ''} ${sit?.estado === 'completo' ? 'gerado' : sit?.estado === 'parcial' ? 'parcial' : ''}`}
                  // cor direto no botão: laranja = gerado em parte, verde = tudo gerado
                  style={sit?.estado === 'completo' ? { background: '#dff3e5', borderColor: '#6cc08a' } : sit?.estado === 'parcial' ? { background: '#ffe8d1', borderColor: '#f0a050' } : undefined}
                  onClick={() => setAtual(p.numero)}
                  onMouseEnter={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setBalao({ chave: p.numero, x: r.left, y: r.bottom + 6 }) }}
                  onMouseLeave={() => setBalao(null)}>
                  <b>{p.numero}</b>
                  <span>{p.loja || formatarCnpj(p.cnpjLoja)}</span>
                  <span style={{ display: 'block' }}>
                    {p.itens.length} itens{p.totalPdf !== null ? `, ${moeda(p.totalPdf)}` : ''}
                    {e && e.geracoes.length > 0 ? `, gerada ${e.geracoes.map((g) => g.numero).join(', ')}` : ''}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {balao && pedidos[balao.chave] && (() => {
          const sit = situacao(pedidos[balao.chave])
          return (
            <div className="balao-pedido" style={{ left: Math.min(balao.x, window.innerWidth - 220), top: balao.y }} role="tooltip">
              <div>Gerados: <b>{sit.enviados}</b></div>
              <div>Pendentes: <b>{sit.total - sit.enviados}</b></div>
            </div>
          )
        })()}

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
          <Alerta tipo={situacao(est).estado === 'completo' ? 'ok' : 'aviso'}>
            Pré-venda gerada neste pedido: {est.geracoes.map((g) => `${g.numero}/${g.ano} (${NOMES_FILTRO[g.filtro]}, ${g.conexao})`).join('; ')}.
          </Alerta>
        )}
        {resumo.naoEncontrados > 0 && (
          <Alerta tipo="aviso" acoes={<button className="botao" onClick={() => setExibir((x) => ({ ...x, localizados: false, naoLocalizados: !x.naoLocalizados }))}>{exibir.naoLocalizados ? 'Mostrar todos' : 'Mostrar só eles'}</button>}>
            <b>{resumo.naoEncontrados} produto(s) não localizado(s)</b> em {ativa?.cliente} › {ativa?.nome}. Eles <b>continuam na lista</b> e não vão nesta pré-venda: troque de banco, corrija o código ou ajuste e gere depois.
          </Alerta>
        )}
      </div>

      <div className="puxador" onPointerDown={comecarArraste} onDoubleClick={() => guardarAltura(alturaTopo === 0 ? null : 0)}
        title="Arraste para cima para aumentar a lista (duplo clique recolhe/abre)" role="separator" aria-orientation="horizontal">
        <span />
        {alturaTopo === 0 && <small>{est.pdf?.loja || est.pedidoCompra} · {formatarCnpj(est.cnpj)} · clique duas vezes para mostrar os dados do pedido</small>}
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
        <details className="menu-exibir">
          <summary className={filtroAtivo !== 'todos os itens' ? 'ativo' : ''}>Exibir: {filtroAtivo} <Icone nome="seta" tamanho={13} /></summary>
          <div className="menu-exibir-lista">
            <label className="check"><input type="checkbox" checked={exibir.localizados} onChange={(e) => setExibir((x) => ({ ...x, localizados: e.target.checked, naoLocalizados: false }))} /> Exibir somente localizados</label>
            <label className="check"><input type="checkbox" checked={exibir.naoLocalizados} onChange={(e) => setExibir((x) => ({ ...x, naoLocalizados: e.target.checked, localizados: false }))} /> Exibir somente não localizados</label>
            <label className="check"><input type="checkbox" checked={exibir.ocultarEnviados} onChange={(e) => setExibir((x) => ({ ...x, ocultarEnviados: e.target.checked }))} /> Ocultar os já enviados</label>
            <small>{linhasVisiveis.length} de {est.linhas.length} itens na lista</small>
          </div>
        </details>
        <div className="direita">
          {temEdicaoManual && <button className="botao leve" onClick={desfazerEdicoes}>Desfazer edições</button>}
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
              const deFora = est.fora.includes(l.id)
              const p = l.produto
              const classe = [!enviado && c.status === 'nao-encontrado' ? 'nao-encontrado' : '', enviado ? 'enviado' : c.temST ? 'com-st' : '', deFora ? 'de-fora' : ''].join(' ')
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
                      <>{p.descricao}{' '}{c.temST && <span className="etiqueta st">ST {p.sitTrib}</span>}{noBanco(l) ? <span className="etiqueta localizado">código localizado</span> : enviado && noBanco(l) === null ? <span className="etiqueta erro">código não localizado neste banco</span> : null}{enviado && <span className="etiqueta ok">enviado · {est.envioDe[l.id] ?? ''}</span>}{deFora && <span className="etiqueta neutra">fora desta geração</span>}{c.aviso && <div className="mini" style={{ color: 'var(--aviso)', fontWeight: 400 }}>{c.aviso}</div>}</>}
                  </td>
                  <td>{p?.unid ?? ''}</td>
                  <td className="num">{p ? qtd(p.unidades) : ''}</td>
                  <td className="num">{p ? qtd(p.qtUndFor) : ''}</td>
                  <td className="num">{c.icmsf ? numero(c.icmsf) : ''}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{numero(c.total)}</td>
                  <td>
                    {!enviado && (est.origem === 'manual' || !deFora
                      ? <button className="botao leve remover" onClick={() => removerLinha(l.id)} title={est.origem === 'manual' ? 'Remover item' : 'Deixar fora desta geração (continua na lista)'} aria-label="Deixar de fora"><Icone nome="lixo" tamanho={15} /></button>
                      : <button className="botao leve" onClick={() => removerLinha(l.id)} title="Incluir de novo" aria-label="Incluir de novo" style={{ fontSize: 12, padding: '3px 8px' }}>Incluir</button>)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="rodape-pedido">
        <div className="indicador"><small>A enviar</small><b>{resumo.ok}</b></div>
        <div className={`indicador ${resumo.naoEncontrados ? 'erro' : ''}`}><small>Não localizados</small><b>{resumo.naoEncontrados}</b></div>
        {qtdEnviados > 0 && <div className="indicador ok"><small>Já enviados</small><b>{qtdEnviados}</b></div>}
        {qtdFora > 0 && <div className="indicador"><small>Fora</small><b>{qtdFora}</b></div>}
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
            {est.geracoes.length > 0 && <p className="mini fraco">Complemento de {est.geracoes.map((g) => `${g.numero}/${g.ano}`).join(', ')}: vão só os itens que ainda não foram gerados.</p>}
            {resumo.naoEncontrados > 0 && <p className="mini" style={{ color: 'var(--aviso)' }}>{resumo.naoEncontrados} item(ns) não localizado(s) neste banco ficam na lista para você resolver depois.</p>}
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
