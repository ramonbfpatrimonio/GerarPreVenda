// Conexão com o SQL Server de cada cliente.
//
// Dois drivers:
//  - tedious (padrão, embutido no `mssql`): conecta por TCP/IP. Precisa do
//    TCP/IP habilitado no SQL Server e, para instância nomeada sem porta, do
//    serviço SQL Server Browser.
//  - msnodesqlv8 (opcional, usa o ODBC do Windows): funciona com autenticação
//    do Windows e com SQL Express local mesmo com o TCP desligado (memória
//    compartilhada / named pipes). Tenta os drivers ODBC instalados, terminando
//    no "{SQL Server}", que existe em todo Windows (é o mesmo que a planilha usava).
//
// No modo "auto" tenta o tedious e, se não conectar, o msnodesqlv8.

import type * as MSSQL from 'mssql'
import type { DiagnosticoItem, PerfilConexao, ResultadoTeste } from '@shared/tipos'

type Modulo = typeof MSSQL
export interface Conexao {
  sql: Modulo
  pool: MSSQL.ConnectionPool
  driver: string
  meta: Metadados
}

export interface Coluna {
  tipo: string
  tamanho: number | null
}
export interface Metadados {
  colunas: Map<string, Map<string, Coluna>> // tabela(minúsc) -> coluna(minúsc) -> info
  colunaNomeCliente: string | null
}

const pools = new Map<string, { chave: string; conexao: Promise<Conexao> }>()

let tedious: Modulo | null = null
let nativo: Modulo | null | undefined

function moduloTedious(): Modulo {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (!tedious) tedious = require('mssql') as Modulo
  return tedious
}

function moduloNativo(): Modulo | null {
  if (nativo === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nativo = require('mssql/msnodesqlv8') as Modulo
    } catch {
      nativo = null
    }
  }
  return nativo
}

export function nativoDisponivel(): boolean {
  return moduloNativo() !== null
}

function servidorOdbc(p: PerfilConexao): string {
  let s = p.servidor
  if (p.instancia) s += `\\${p.instancia}`
  if (p.porta) s += `,${p.porta}`
  return s
}

const DRIVERS_ODBC = [
  'ODBC Driver 18 for SQL Server',
  'ODBC Driver 17 for SQL Server',
  'SQL Server Native Client 11.0',
  'SQL Server'
]

async function conectarTedious(p: PerfilConexao, senha: string, banco: string): Promise<Conexao> {
  const sql = moduloTedious()
  if (p.autenticacao === 'windows') {
    throw new Error('Autenticação do Windows precisa do driver nativo (msnodesqlv8).')
  }
  const config: MSSQL.config = {
    server: p.servidor,
    port: p.porta ?? undefined,
    database: banco || undefined,
    user: p.usuario,
    password: senha,
    connectionTimeout: 10000,
    requestTimeout: 60000,
    pool: { max: 4, min: 0, idleTimeoutMillis: 60000 },
    options: {
      encrypt: p.criptografar,
      trustServerCertificate: true,
      enableArithAbort: true,
      instanceName: p.instancia || undefined,
      appName: 'Gerar Pre-Venda'
    }
  }
  const pool = new sql.ConnectionPool(config)
  await pool.connect()
  return { sql, pool, driver: 'tedious (TCP/IP)', meta: await lerMetadados(pool) }
}

async function conectarNativo(p: PerfilConexao, senha: string, banco: string): Promise<Conexao> {
  const sql = moduloNativo()
  if (!sql) throw new Error('Driver nativo (msnodesqlv8) não está instalado neste computador.')
  const erros: string[] = []
  for (const driver of DRIVERS_ODBC) {
    const partes = [`Driver={${driver}}`, `Server=${servidorOdbc(p)}`]
    if (banco) partes.push(`Database=${banco}`)
    if (p.autenticacao === 'windows') partes.push('Trusted_Connection=Yes')
    else partes.push(`Uid=${p.usuario}`, `Pwd={${senha.replace(/}/g, '}}')}}`)
    if (driver.startsWith('ODBC Driver 18')) partes.push(p.criptografar ? 'Encrypt=Yes' : 'Encrypt=No', 'TrustServerCertificate=Yes')
    partes.push('APP=Gerar Pre-Venda')
    const pool = new sql.ConnectionPool({
      connectionString: partes.join(';') + ';',
      connectionTimeout: 10000,
      requestTimeout: 60000,
      pool: { max: 4, min: 0, idleTimeoutMillis: 60000 }
    } as unknown as MSSQL.config)
    try {
      await pool.connect()
      return { sql, pool, driver: `ODBC nativo (${driver})`, meta: await lerMetadados(pool) }
    } catch (e) {
      const msg = (e as Error).message
      erros.push(`${driver}: ${msg}`)
      try {
        await pool.close()
      } catch {
        /* ignora */
      }
      // Driver não instalado: tenta o próximo. Outro erro (login, servidor): para.
      if (!/IM002|Data source name not found|não foi encontrado|not found/i.test(msg)) break
    }
  }
  throw new Error(erros[erros.length - 1] ?? 'Falha no driver nativo.')
}

async function conectar(p: PerfilConexao, senha: string, banco = p.banco): Promise<Conexao> {
  if (p.driver === 'tedious') return conectarTedious(p, senha, banco)
  if (p.driver === 'msnodesqlv8') return conectarNativo(p, senha, banco)
  // auto
  if (p.autenticacao === 'windows') return conectarNativo(p, senha, banco)
  try {
    return await conectarTedious(p, senha, banco)
  } catch (e1) {
    if (!nativoDisponivel() || /Login failed|Falha de logon|ELOGIN/i.test((e1 as Error).message)) throw e1
    try {
      return await conectarNativo(p, senha, banco)
    } catch (e2) {
      throw new Error(`TCP/IP: ${(e1 as Error).message}\nODBC: ${(e2 as Error).message}`)
    }
  }
}

function chavePerfil(p: PerfilConexao, senha: string): string {
  return JSON.stringify([p.servidor, p.instancia, p.porta, p.autenticacao, p.usuario, senha, p.banco, p.driver, p.criptografar])
}

/** Pool reaproveitado por perfil (recriado se o perfil mudar). */
export async function obterConexao(p: PerfilConexao, senha: string): Promise<Conexao> {
  if (!p.banco) throw new Error('Esta conexão não tem banco de dados selecionado.')
  const chave = chavePerfil(p, senha)
  const atual = pools.get(p.id)
  if (atual && atual.chave === chave) {
    try {
      const c = await atual.conexao
      if (c.pool.connected) return c
    } catch {
      /* recria abaixo */
    }
  }
  if (atual) void fecharPool(p.id)
  const conexao = conectar(p, senha)
  pools.set(p.id, { chave, conexao })
  conexao.catch(() => pools.delete(p.id))
  return conexao
}

export async function fecharPool(id: string): Promise<void> {
  const atual = pools.get(id)
  pools.delete(id)
  if (atual) {
    try {
      await (await atual.conexao).pool.close()
    } catch {
      /* ignora */
    }
  }
}

export async function fecharTodos(): Promise<void> {
  await Promise.all([...pools.keys()].map(fecharPool))
}

// ---------------------------------------------------------------------------
// Metadados e diagnóstico
// ---------------------------------------------------------------------------

export const TABELAS_NECESSARIAS: Record<string, { colunas: string[]; opcional?: boolean; uso: string }> = {
  Produtos: {
    uso: 'busca de produtos e cálculo do ST',
    colunas: ['Codigo', 'CodBarras', 'Descricao', 'Unid', 'Unidades', 'QUTUNDFOR', 'PrecoVenda', 'SitTrib', 'Aliq_ICMSN', 'AliqICMSF', 'PercAgrega', 'PercRed']
  },
  Clientes: { uso: 'cliente pelo CNPJ', colunas: ['Codigo', 'NroInsc'] },
  PrevendasIndice: { uso: 'numeração das pré-vendas', colunas: ['Ano', 'Numero'] },
  Prevendas: {
    uso: 'cabeçalho da pré-venda',
    colunas: ['Ano', 'Numero', 'Data', 'Equipe', 'Setor', 'Vendedor', 'TeleOpera', 'Situacao', 'Codigo', 'Operacao', 'ObsInterna', 'ObsFatura', 'Pedido', 'DataMovSai', 'NroMovSai', 'NroPedClie', 'ModDescCon', 'Origem', 'AnoOrigem', 'NroOrigem', 'SiglaOL', 'DataVisita', 'HoraVisita', 'Latitude', 'Longitude', 'NroLocEnt']
  },
  PrevendasItens: {
    uso: 'itens da pré-venda',
    colunas: ['Ano', 'Numero', 'Produto', 'Combo', 'Quant', 'QuantUnid', 'PrecoTab', 'PerDesInc', 'PerDesRep', 'DescProm', 'PerDesProm', 'PerDesCom', 'Preco', 'ICMSF', 'CustoComer', 'BloqFamEsc']
  },
  EventosSistema: { uso: 'registro de eventos (log)', opcional: true, colunas: ['Data', 'Hora', 'Tipo', 'Usuario', 'Estacao', 'Descricao'] }
}

const COLUNAS_NOME_CLIENTE = ['Nome', 'RazaoSocial', 'Razao', 'RazSocial', 'NomeRazao', 'Fantasia', 'NomeFantasia', 'Descricao']

async function lerMetadados(pool: MSSQL.ConnectionPool): Promise<Metadados> {
  const r = await pool.request().query(`
    SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, DATA_TYPE AS tipo, CHARACTER_MAXIMUM_LENGTH AS tamanho
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME IN ('Produtos','Clientes','PrevendasIndice','Prevendas','PrevendasItens','EventosSistema')`)
  const colunas = new Map<string, Map<string, Coluna>>()
  for (const row of r.recordset as { tabela: string; coluna: string; tipo: string; tamanho: number | null }[]) {
    const t = row.tabela.toLowerCase()
    if (!colunas.has(t)) colunas.set(t, new Map())
    colunas.get(t)!.set(row.coluna.toLowerCase(), { tipo: row.tipo.toLowerCase(), tamanho: row.tamanho })
  }
  const cli = colunas.get('clientes')
  const colunaNomeCliente = COLUNAS_NOME_CLIENTE.find((c) => cli?.has(c.toLowerCase())) ?? null
  return { colunas, colunaNomeCliente }
}

export function temTabela(meta: Metadados, tabela: string): boolean {
  return meta.colunas.has(tabela.toLowerCase())
}
export function temColuna(meta: Metadados, tabela: string, coluna: string): boolean {
  return !!meta.colunas.get(tabela.toLowerCase())?.has(coluna.toLowerCase())
}
export function infoColuna(meta: Metadados, tabela: string, coluna: string): Coluna | undefined {
  return meta.colunas.get(tabela.toLowerCase())?.get(coluna.toLowerCase())
}

function mensagemAmigavel(msg: string): string {
  if (/Login failed|Falha de logon/i.test(msg)) return `Usuário ou senha do SQL Server recusados. (${msg})`
  if (/ETIMEOUT|timeout|tempo limite/i.test(msg))
    return `O servidor não respondeu a tempo. Verifique o nome do servidor/instância, se o TCP/IP está habilitado no SQL Server e o firewall (porta 1433 / UDP 1434 para instância nomeada). (${msg})`
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) return `Servidor não encontrado na rede: confira o nome ou IP. (${msg})`
  if (/ESOCKET|ECONNREFUSED|Could not connect|Failed to connect/i.test(msg))
    return `Conexão recusada. O SQL Server pode estar com TCP/IP desligado ou em outra porta. Em conexão local, tente o driver "ODBC nativo". (${msg})`
  if (/Cannot open database|Não é possível abrir o banco/i.test(msg)) return `O banco informado não existe ou o usuário não tem acesso a ele. (${msg})`
  return msg
}

export async function testar(p: PerfilConexao, senha: string): Promise<ResultadoTeste> {
  const itens: DiagnosticoItem[] = []
  let c: Conexao
  try {
    // Primeiro conecta sem banco (master) para listar os bancos disponíveis.
    c = await conectar(p, senha, p.banco || '')
  } catch (e) {
    return { ok: false, itens: [{ ok: false, titulo: 'Conexão com o servidor', detalhe: mensagemAmigavel((e as Error).message) }], erro: mensagemAmigavel((e as Error).message) }
  }
  try {
    itens.push({ ok: true, titulo: 'Conexão com o servidor', detalhe: `Driver: ${c.driver}` })
    const v = await c.pool.request().query(`SELECT CAST(SERVERPROPERTY('ProductVersion') AS varchar(50)) AS versao, CAST(SERVERPROPERTY('Edition') AS varchar(100)) AS edicao, DB_NAME() AS banco`)
    const versao = `${v.recordset[0].edicao} ${v.recordset[0].versao}`
    const b = await c.pool.request().query(`SELECT name FROM sys.databases WHERE state = 0 AND database_id > 4 AND HAS_DBACCESS(name) = 1 ORDER BY name`)
    const bancos = (b.recordset as { name: string }[]).map((x) => x.name)

    if (!p.banco) {
      itens.push({ ok: false, aviso: true, titulo: 'Banco de dados', detalhe: 'Escolha o banco na lista e teste novamente para conferir as tabelas.' })
      return { ok: true, driverUsado: c.driver, versao, bancos, itens }
    }
    itens.push({ ok: true, titulo: `Banco ${v.recordset[0].banco}`, detalhe: 'Acesso liberado' })

    let ok = true
    for (const [tabela, def] of Object.entries(TABELAS_NECESSARIAS)) {
      if (!temTabela(c.meta, tabela)) {
        if (def.opcional) itens.push({ ok: true, aviso: true, titulo: `dbo.${tabela}`, detalhe: `Não encontrada: ${def.uso} ficará desativado.` })
        else {
          ok = false
          itens.push({ ok: false, titulo: `dbo.${tabela}`, detalhe: `Tabela não encontrada (${def.uso}).` })
        }
        continue
      }
      const faltando = def.colunas.filter((col) => !temColuna(c.meta, tabela, col))
      if (faltando.length) {
        if (!def.opcional) ok = false
        itens.push({ ok: !!def.opcional, aviso: !!def.opcional, titulo: `dbo.${tabela}`, detalhe: `Colunas ausentes: ${faltando.join(', ')}` })
      } else {
        itens.push({ ok: true, titulo: `dbo.${tabela}`, detalhe: def.uso })
      }
    }

    if (temTabela(c.meta, 'Clientes')) {
      const vend = [1, 2, 3, 4, 5].filter((i) => temColuna(c.meta, 'Clientes', `Vendedor${i}`))
      if (p.regras.setorPelasColunasVendedor && vend.length === 0)
        itens.push({ ok: true, aviso: true, titulo: 'Setor do cliente', detalhe: `Colunas Vendedor1..5 não existem: será usado o setor padrão ${p.regras.setorPadrao}.` })
      itens.push({
        ok: true,
        aviso: !c.meta.colunaNomeCliente,
        titulo: 'Nome do cliente',
        detalhe: c.meta.colunaNomeCliente ? `Coluna Clientes.${c.meta.colunaNomeCliente}` : 'Nenhuma coluna de nome reconhecida: será mostrado só o código.'
      })
    }

    if (ok) {
      const perm = await c.pool.request().query(`
        SELECT HAS_PERMS_BY_NAME('dbo.Prevendas','OBJECT','INSERT') AS insPv,
               HAS_PERMS_BY_NAME('dbo.PrevendasItens','OBJECT','INSERT') AS insIt,
               HAS_PERMS_BY_NAME('dbo.PrevendasIndice','OBJECT','UPDATE') AS updIdx,
               HAS_PERMS_BY_NAME('dbo.Produtos','OBJECT','SELECT') AS selProd`)
      const pr = perm.recordset[0]
      const semPerm = [
        !pr.selProd && 'SELECT em Produtos',
        !pr.insPv && 'INSERT em Prevendas',
        !pr.insIt && 'INSERT em PrevendasItens',
        !pr.updIdx && 'UPDATE em PrevendasIndice'
      ].filter(Boolean)
      if (semPerm.length) {
        ok = false
        itens.push({ ok: false, titulo: 'Permissões do usuário', detalhe: `Sem permissão: ${semPerm.join(', ')}` })
      } else itens.push({ ok: true, titulo: 'Permissões do usuário', detalhe: 'Leitura de produtos e gravação de pré-vendas liberadas' })

      const cont = await c.pool.request().query(`
        SELECT OBJECT_NAME(object_id) AS t, SUM(rows) AS n FROM sys.partitions
        WHERE index_id IN (0,1) AND object_id IN (OBJECT_ID('dbo.Produtos'), OBJECT_ID('dbo.Clientes'))
        GROUP BY object_id`)
      const n = Object.fromEntries((cont.recordset as { t: string; n: number }[]).map((x) => [x.t.toLowerCase(), Number(x.n)]))
      itens.push({ ok: true, titulo: 'Cadastros', detalhe: `${(n.produtos ?? 0).toLocaleString('pt-BR')} produtos · ${(n.clientes ?? 0).toLocaleString('pt-BR')} clientes` })
    }
    return { ok, driverUsado: c.driver, versao, bancos, itens }
  } catch (e) {
    return { ok: false, itens: [...itens, { ok: false, titulo: 'Erro no diagnóstico', detalhe: mensagemAmigavel((e as Error).message) }], erro: (e as Error).message }
  } finally {
    await c.pool.close().catch(() => undefined)
  }
}

export { mensagemAmigavel }
