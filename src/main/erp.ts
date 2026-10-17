// Consultas e gravações no ERP (mesmas tabelas em todos os clientes).
//
// Tudo com parâmetros (nada de SQL montado juntando texto) e a gravação da
// pré-venda numa única transação, com o número reservado sob trava.

import { hostname } from 'os'
import type * as MSSQL from 'mssql'
import type {
  ClienteErp, PedidoEnvio, PerfilConexao, PreVendaExistente, ProdutoErp, ResultadoGeracao
} from '@shared/tipos'
import { arred, cnpj14, zeros } from '@shared/numeros'
import { calcularICMSF, temST, quantidadeEfetiva } from '@shared/regras'
import { infoColuna, mensagemAmigavel, obterConexao, temColuna, temTabela, type Conexao } from './db'

const LOTE = 500 // parâmetros por consulta (limite do SQL Server: 2100)

function linhaParaProduto(r: Record<string, unknown>, digitos: number): ProdutoErp {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
  const n = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  return {
    codigo: zeros(s(r.Codigo), digitos),
    codBarras: s(r.CodBarras),
    descricao: s(r.Descricao),
    unid: s(r.Unid),
    unidades: n(r.Unidades),
    qtUndFor: n(r.QUTUNDFOR),
    precoVenda: n(r.PrecoVenda),
    sitTrib: s(r.SitTrib),
    aliqIcmsN: n(r.Aliq_ICMSN),
    aliqIcmsF: n(r.AliqICMSF),
    percAgrega: n(r.PercAgrega),
    percRed: n(r.PercRed)
  }
}

const SELECT_PRODUTO = `
  SELECT Codigo, CodBarras, Descricao, Unid, Unidades, QUTUNDFOR, PrecoVenda,
         ISNULL(SitTrib,'') AS SitTrib, ISNULL(Aliq_ICMSN,0) AS Aliq_ICMSN, ISNULL(AliqICMSF,0) AS AliqICMSF,
         ISNULL(PercAgrega,0) AS PercAgrega, ISNULL(PercRed,0) AS PercRed
  FROM dbo.Produtos`

/**
 * Busca vários produtos de uma vez (a planilha fazia uma conexão e 2–3
 * consultas por célula). Como na planilha, procura primeiro pelo código de
 * barras e depois pelo código do produto.
 * Retorna um objeto: código lido -> produto (ou null se não achou).
 */
export async function buscarProdutos(
  perfil: PerfilConexao,
  senha: string,
  codigos: string[]
): Promise<Record<string, ProdutoErp | null>> {
  const c = await obterConexao(perfil, senha)
  const dig = perfil.regras.digitosCodigoProduto
  const unicos = [...new Set(codigos.map((x) => x.trim()).filter(Boolean))]
  const porBarras = new Map<string, ProdutoErp>()
  const porCodigo = new Map<string, ProdutoErp>()

  // Se Codigo/CodBarras forem numéricos neste banco, só compara valores que cabem
  // no tipo (evita erro de conversão/overflow ao procurar um GTIN em Codigo int).
  const cabe = (coluna: string, v: string) => {
    const tipo = infoColuna(c.meta, 'Produtos', coluna)?.tipo ?? 'varchar'
    if (tipo === 'int') return /^\d{1,9}$/.test(v)
    if (tipo === 'smallint' || tipo === 'tinyint') return /^\d{1,4}$/.test(v) && Number(v) < 32768
    if (tipo === 'bigint') return /^\d{1,18}$/.test(v)
    if (/numeric|decimal|float|real|money/.test(tipo)) return /^\d{1,18}$/.test(v)
    return true
  }

  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE)
    const req = c.pool.request()
    const pb: string[] = []
    const pc: string[] = []
    lote.forEach((cod, j) => {
      if (cabe('CodBarras', cod)) {
        req.input(`b${j}`, c.sql.VarChar(60), cod)
        pb.push(`@b${j}`)
      }
      if (cabe('Codigo', cod)) {
        req.input(`c${j}`, c.sql.VarChar(60), cod)
        pc.push(`@c${j}`)
      }
      const z = zeros(cod, dig)
      if (z !== cod && /^\d+$/.test(cod) && cod.length <= dig && cabe('Codigo', z)) {
        req.input(`z${j}`, c.sql.VarChar(60), z)
        pc.push(`@z${j}`)
      }
    })
    const filtros = [pb.length && `CodBarras IN (${pb.join(',')})`, pc.length && `Codigo IN (${pc.join(',')})`].filter(Boolean)
    if (!filtros.length) continue
    const r = await req.query(`${SELECT_PRODUTO} WHERE ${filtros.join(' OR ')} ORDER BY Codigo`)
    for (const row of r.recordset as Record<string, unknown>[]) {
      const p = linhaParaProduto(row, dig)
      if (p.codBarras && !porBarras.has(p.codBarras)) porBarras.set(p.codBarras, p)
      const codBruto = String(row.Codigo ?? '').trim()
      if (!porCodigo.has(codBruto)) porCodigo.set(codBruto, p)
      if (!porCodigo.has(p.codigo)) porCodigo.set(p.codigo, p)
    }
  }

  const resultado: Record<string, ProdutoErp | null> = {}
  for (const cod of unicos) {
    resultado[cod] = porBarras.get(cod) ?? porCodigo.get(cod) ?? porCodigo.get(zeros(cod, dig)) ?? null
  }
  return resultado
}

function formatarSetor(valor: string, digitos: number): string {
  const v = valor.trim()
  if (/^\d+$/.test(v)) return v.replace(/^0+(?=\d)/, '').padStart(digitos, '0')
  return v.padStart(digitos, '0').slice(-digitos)
}

async function lerCliente(c: Conexao, perfil: PerfilConexao, cnpj: string, tx?: MSSQL.Transaction): Promise<ClienteErp | null> {
  const regras = perfil.regras
  const colsVend = [1, 2, 3, 4, 5].map((i) => `Vendedor${i}`).filter((col) => temColuna(c.meta, 'Clientes', col))
  const nomeCol = c.meta.colunaNomeCliente
  const select = [
    'RTRIM(Codigo) AS Codigo',
    nomeCol ? `RTRIM(${nomeCol}) AS Nome` : `'' AS Nome`,
    ...colsVend.map((col) => `RTRIM(${col}) AS ${col}`)
  ].join(', ')
  const req = tx ? new c.sql.Request(tx) : c.pool.request()
  req.input('cnpj', c.sql.VarChar(20), cnpj14(cnpj))
  const r = await req.query(`SELECT TOP 1 ${select} FROM dbo.Clientes WHERE RTRIM(NroInsc) = @cnpj`)
  const row = r.recordset[0] as Record<string, string | null> | undefined
  if (!row) return null
  let setor = regras.setorPadrao
  if (regras.setorPelasColunasVendedor) {
    for (const col of colsVend) {
      const v = (row[col] ?? '').trim()
      if (v) {
        setor = formatarSetor(v, regras.digitosSetor)
        break
      }
    }
  }
  return { codigo: String(row.Codigo).trim(), nome: (row.Nome ?? '').trim(), setor }
}

export async function buscarCliente(perfil: PerfilConexao, senha: string, cnpj: string): Promise<ClienteErp | null> {
  const c = await obterConexao(perfil, senha)
  return lerCliente(c, perfil, cnpj)
}

/** Pré-vendas que já usam este nº de pedido de compra para o cliente. */
export async function verificarPedido(
  perfil: PerfilConexao,
  senha: string,
  clienteCodigo: string,
  pedidoCompra: string
): Promise<PreVendaExistente[]> {
  const c = await obterConexao(perfil, senha)
  const req = c.pool.request()
  req.input('cli', c.sql.VarChar(20), clienteCodigo)
  req.input('ped', c.sql.VarChar(60), pedidoCompra.trim())
  const r = await req.query(`
    SELECT TOP 20 RTRIM(Ano) AS Ano, RTRIM(Numero) AS Numero, Data
    FROM dbo.Prevendas WHERE Codigo = @cli AND RTRIM(NroPedClie) = @ped
    ORDER BY Ano DESC, Numero DESC`)
  return (r.recordset as { Ano: string; Numero: string; Data: unknown }[]).map((x) => ({
    ano: String(x.Ano),
    numero: String(x.Numero),
    data: x.Data instanceof Date ? x.Data.toLocaleDateString('pt-BR') : String(x.Data ?? '')
  }))
}

export async function limitePedidoCompra(perfil: PerfilConexao, senha: string): Promise<number> {
  const c = await obterConexao(perfil, senha)
  return infoColuna(c.meta, 'Prevendas', 'NroPedClie')?.tamanho ?? 15
}

// ---------------------------------------------------------------------------
// Geração da pré-venda
// ---------------------------------------------------------------------------

function hojeLocal() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    data: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    ano: String(d.getFullYear()),
    hora: `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }
}

/** Data no tipo da coluna: Date para colunas de data, texto 'yyyy-mm-dd' (como a planilha) para texto. */
function valorData(c: Conexao, tabela: string, coluna: string, hoje: ReturnType<typeof hojeLocal>): [MSSQL.ISqlType | (() => MSSQL.ISqlType), Date | string] {
  const tipo = infoColuna(c.meta, tabela, coluna)?.tipo ?? 'datetime'
  if (/date|time/.test(tipo)) return [c.sql.DateTime, hoje.data]
  return [c.sql.VarChar(20), hoje.iso]
}

function cortar(c: Conexao, tabela: string, coluna: string, valor: string): string {
  const t = infoColuna(c.meta, tabela, coluna)?.tamanho
  return t && t > 0 ? valor.slice(0, t) : valor
}

export async function gerarPreVenda(perfil: PerfilConexao, senha: string, envio: PedidoEnvio): Promise<ResultadoGeracao> {
  const regras = perfil.regras
  const hoje = hojeLocal()

  // ---- validações (antes de tocar no banco) ----
  const cnpj = cnpj14(envio.cnpj)
  const pedido = envio.pedidoCompra.trim()
  if (!/[1-9]/.test(cnpj)) throw new Error('Informe o CNPJ do cliente.')
  if (!pedido) throw new Error('Informe o número do pedido de compra.')
  if (envio.itens.length === 0) throw new Error('O pedido não tem itens. Nenhuma pré-venda foi criada.')
  const c = await obterConexao(perfil, senha)
  const limite = infoColuna(c.meta, 'Prevendas', 'NroPedClie')?.tamanho ?? 15
  if (limite > 0 && pedido.length > limite) throw new Error(`O nº do pedido de compra pode ter no máximo ${limite} caracteres neste banco.`)

  // Relê os produtos no banco (não confia nos dados da tela para o ST).
  const codigos = envio.itens.map((i) => zeros(i.codigo, regras.digitosCodigoProduto))
  const produtos = await buscarProdutosPorCodigo(c, codigos, regras.digitosCodigoProduto)
  const faltando = codigos.filter((cod) => !produtos.has(cod))
  if (faltando.length) throw new Error(`Produtos não encontrados no ERP: ${[...new Set(faltando)].join(', ')}. Nada foi gravado.`)

  const itens = envio.itens
    .map((i) => {
      const codigo = zeros(i.codigo, regras.digitosCodigoProduto)
      const p = produtos.get(codigo)!
      const st = temST(p, regras.cstsComST)
      const qEf = quantidadeEfetiva(i.quantidade, i.quantidadeUnid, p)
      const icmsf = arred(calcularICMSF(p, i.preco, qEf, regras.cstsComST), 2)
      return { ...i, codigo, st, icmsf, total: qEf * i.preco }
    })
    .filter((i) => (envio.filtro === 'ST' ? i.st : envio.filtro === 'SEM_ST' ? !i.st : true))

  if (itens.length === 0) {
    const desc = envio.filtro === 'ST' ? 'com ST' : envio.filtro === 'SEM_ST' ? 'sem ST' : ''
    throw new Error(`Nenhum item ${desc} para enviar. Nenhuma pré-venda foi criada.`.replace('  ', ' '))
  }
  const invalidos = itens.filter((i) => !(i.quantidade > 0 || i.quantidadeUnid > 0) || !(i.preco > 0))
  if (invalidos.length) throw new Error(`Itens sem quantidade ou preço: ${invalidos.map((i) => i.codigo).join(', ')}.`)

  const cliente = await lerCliente(c, perfil, cnpj)
  if (!cliente) throw new Error(`Cliente com CNPJ ${cnpj} não encontrado no banco ${perfil.cliente} › ${perfil.nome}.`)

  // ---- transação ----
  const tx = new c.sql.Transaction(c.pool)
  await tx.begin(c.sql.ISOLATION_LEVEL.READ_COMMITTED)
  let numeroFormatado = ''
  try {
    const r1 = new c.sql.Request(tx)
    r1.input('ano', c.sql.VarChar(4), hoje.ano)
    // UPDLOCK + HOLDLOCK: quem chegar depois espera esta transação terminar.
    const idx = await r1.query(`SELECT Numero FROM dbo.PrevendasIndice WITH (UPDLOCK, HOLDLOCK) WHERE Ano = @ano`)
    let numero: number
    if (idx.recordset.length === 0) {
      const ri = new c.sql.Request(tx)
      ri.input('ano', c.sql.VarChar(4), hoje.ano)
      await ri.query(`INSERT INTO dbo.PrevendasIndice (Ano, Numero) VALUES (@ano, 0)`)
      numero = 0
    } else {
      numero = Number(idx.recordset[0].Numero) || 0
    }

    // Pula números que por algum motivo já existam em Prevendas.
    for (let tentativa = 0; ; tentativa++) {
      numero += 1
      numeroFormatado = String(numero).padStart(6, '0')
      const rx = new c.sql.Request(tx)
      rx.input('ano', c.sql.VarChar(4), hoje.ano)
      rx.input('num', c.sql.VarChar(10), numeroFormatado)
      const ex = await rx.query(`SELECT 1 AS x FROM dbo.Prevendas WITH (UPDLOCK, HOLDLOCK) WHERE Ano = @ano AND Numero = @num`)
      if (ex.recordset.length === 0) break
      if (tentativa > 50) throw new Error('Não foi possível obter um número livre de pré-venda.')
    }
    const ru = new c.sql.Request(tx)
    ru.input('ano', c.sql.VarChar(4), hoje.ano)
    ru.input('n', c.sql.Int, numero)
    await ru.query(`UPDATE dbo.PrevendasIndice SET Numero = @n WHERE Ano = @ano`)

    // Cabeçalho — mesmos campos e valores fixos da planilha.
    const rh = new c.sql.Request(tx)
    const [tipoData, valData] = valorData(c, 'Prevendas', 'Data', hoje)
    rh.input('ano', c.sql.VarChar(4), hoje.ano)
    rh.input('num', c.sql.VarChar(10), numeroFormatado)
    rh.input('data', tipoData, valData)
    rh.input('equipe', c.sql.VarChar(10), regras.equipe)
    rh.input('setor', c.sql.VarChar(10), cliente.setor)
    rh.input('vendedor', c.sql.VarChar(10), regras.vendedor)
    rh.input('cli', c.sql.VarChar(20), cliente.codigo)
    rh.input('ped', c.sql.VarChar(60), pedido)
    await rh.query(`
      INSERT INTO dbo.Prevendas (
        Ano, Numero, Data, Equipe, Setor, Vendedor, TeleOpera, Situacao, Codigo, Operacao,
        ObsInterna, ObsFatura, Pedido, DataMovSai, NroMovSai, NroPedClie, ModDescCon, Origem,
        AnoOrigem, NroOrigem, SiglaOL, DataVisita, HoraVisita, Latitude, Longitude, NroLocEnt
      ) VALUES (
        @ano, @num, @data, @equipe, @setor, @vendedor, '', '', @cli, '',
        '', '', '', NULL, '', @ped, '', '',
        '', '', '', NULL, '', 0, 0, 0
      )`)

    for (const it of itens) {
      const ri = new c.sql.Request(tx)
      ri.input('ano', c.sql.VarChar(4), hoje.ano)
      ri.input('num', c.sql.VarChar(10), numeroFormatado)
      ri.input('prod', c.sql.VarChar(20), it.codigo)
      ri.input('q', c.sql.Float, arred(it.quantidade, 6))
      ri.input('qu', c.sql.Float, arred(it.quantidadeUnid, 6))
      ri.input('preco', c.sql.Float, arred(it.preco, 6))
      ri.input('icmsf', c.sql.Float, it.icmsf)
      await ri.query(`
        INSERT INTO dbo.PrevendasItens (
          Ano, Numero, Produto, Combo, Quant, QuantUnid,
          PrecoTab, PerDesInc, PerDesRep, DescProm, PerDesProm, PerDesCom,
          Preco, ICMSF, CustoComer, BloqFamEsc
        ) VALUES (
          @ano, @num, @prod, '', @q, @qu,
          @preco, 0, 0, 0, 0, 0,
          @preco, @icmsf, 0, 0
        )`)
    }
    await tx.commit()
  } catch (e) {
    try {
      await tx.rollback()
    } catch {
      /* a transação pode já ter sido desfeita pelo servidor */
    }
    throw new Error(`Nada foi gravado no ERP. ${mensagemAmigavel((e as Error).message)}`)
  }

  const total = arred(itens.reduce((s, i) => s + i.total, 0))
  const totalComST = arred(total + itens.reduce((s, i) => s + i.icmsf, 0))

  // Log no ERP (fora da transação, como na planilha: falha aqui não desfaz a pré-venda).
  if (regras.registrarEvento && temTabela(c.meta, 'EventosSistema')) {
    try {
      const filtroTxt = envio.filtro === 'TODOS' ? '' : ` - Filtro: ${envio.filtro}`
      const descricao =
        `Pré-venda gerada via Gerar Pré-Venda${filtroTxt} | Numero: ${numeroFormatado}/${hoje.ano}` +
        ` | Cliente: ${cliente.codigo} | Pedido Compra: ${pedido} | Itens: ${itens.length}` +
        ` | Conexao: ${perfil.cliente} ${perfil.nome}`
      const re = c.pool.request()
      const [tipoData, valData] = valorData(c, 'EventosSistema', 'Data', hoje)
      re.input('data', tipoData, valData)
      re.input('hora', c.sql.VarChar(10), hoje.hora)
      re.input('tipo', c.sql.VarChar(10), regras.tipoEvento)
      re.input('usuario', c.sql.VarChar(60), cortar(c, 'EventosSistema', 'Usuario', envio.usuario.toUpperCase()))
      re.input('estacao', c.sql.VarChar(60), cortar(c, 'EventosSistema', 'Estacao', hostname().toUpperCase()))
      re.input('desc', c.sql.VarChar(4000), cortar(c, 'EventosSistema', 'Descricao', descricao))
      await re.query(`INSERT INTO dbo.EventosSistema (Data, Hora, Tipo, Usuario, Estacao, Descricao) VALUES (@data, @hora, @tipo, @usuario, @estacao, @desc)`)
    } catch {
      /* igual à planilha: log é opcional */
    }
  }

  return {
    ano: hoje.ano,
    numero: numeroFormatado,
    clienteCodigo: cliente.codigo,
    clienteNome: cliente.nome,
    setor: cliente.setor,
    qtdItens: itens.length,
    total,
    totalComST
  }
}

async function buscarProdutosPorCodigo(c: Conexao, codigos: string[], digitos: number): Promise<Map<string, ProdutoErp>> {
  const mapa = new Map<string, ProdutoErp>()
  const unicos = [...new Set(codigos)]
  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE)
    const req = c.pool.request()
    lote.forEach((cod, j) => req.input(`c${j}`, c.sql.VarChar(20), cod))
    const r = await req.query(`${SELECT_PRODUTO} WHERE Codigo IN (${lote.map((_, j) => `@c${j}`).join(',')})`)
    for (const row of r.recordset as Record<string, unknown>[]) {
      const p = linhaParaProduto(row, digitos)
      if (!mapa.has(p.codigo)) mapa.set(p.codigo, p)
    }
  }
  return mapa
}

export const estacao = () => hostname().toUpperCase()
