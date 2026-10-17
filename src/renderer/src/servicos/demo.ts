// MODO DEMONSTRAÇÃO — só entra no build com VITE_DEMO=1 (npm run demo).
// Simula o processo principal e o Supabase para testar as telas sem banco.
import type { Api } from '../../../preload/api'
import type { PerfilConexao, ProdutoErp, ResultadoPdf } from '@shared/tipos'
import { REGRAS_PADRAO } from '@shared/tipos'
import type { Nuvem, Perfil, RegistroHistorico } from './nuvem'
import pedidosDemo from './demo-pedidos.json'

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

const perfis: PerfilConexao[] = [
  {
    id: 'hage-com', cliente: 'Hage', nome: 'COMERCIO', cor: '#1f5f9e', servidor: 'THIAGO-DELL', instancia: '', porta: null,
    autenticacao: 'sql', usuario: 'sa', temSenha: true, banco: 'Hage.0001.Log', driver: 'auto', criptografar: false,
    cnpjsEmpresa: ['39648061000103'], regras: { ...REGRAS_PADRAO }, atualizadoEm: new Date().toISOString()
  },
  {
    id: 'hage-ind', cliente: 'Hage', nome: 'INDUSTRIA', cor: '#7a3fb5', servidor: 'THIAGO-DELL', instancia: '', porta: null,
    autenticacao: 'sql', usuario: 'sa', temSenha: true, banco: 'Hage.0002.Log', driver: 'auto', criptografar: false,
    cnpjsEmpresa: [], regras: { ...REGRAS_PADRAO }, atualizadoEm: new Date().toISOString()
  },
  {
    id: 'cli-x', cliente: 'Distribuidora Norte', nome: 'Matriz', cor: '#0e7c5a', servidor: 'localhost', instancia: 'SQLEXPRESS', porta: null,
    autenticacao: 'windows', usuario: '', temSenha: false, banco: 'NorteERP', driver: 'auto', criptografar: false,
    cnpjsEmpresa: [], regras: { ...REGRAS_PADRAO }, atualizadoEm: new Date().toISOString()
  }
]

const pdf = pedidosDemo as ResultadoPdf
const produtos = new Map<string, ProdutoErp>()
let seq = 300
for (const p of pdf.pedidos)
  for (const it of p.itens) {
    if (produtos.has(it.gtin) || it.gtin === '7898717041118') continue // um produto "não cadastrado"
    const st = it.icmsSt > 0
    produtos.set(it.gtin, {
      codigo: String(seq++).padStart(6, '0'),
      codBarras: it.gtin,
      descricao: it.descricao.replace(/\s+CX\s+[\d.]+$/, ''),
      unid: 'CX',
      unidades: it.fatorEmbalagem,
      qtUndFor: it.fatorEmbalagem,
      precoVenda: it.custoBase,
      sitTrib: st ? '70' : '00',
      aliqIcmsN: 20,
      aliqIcmsF: 0,
      percAgrega: st ? 34 : 0,
      percRed: st ? 65 : 0
    })
  }

let numero = 412
const historico: RegistroHistorico[] = [
  {
    id: 1, criado_em: new Date(Date.now() - 86400000 * 2).toISOString(), usuario_nome: 'Deyse', estacao: 'CAIXA-02',
    conexao_cliente: 'Hage', conexao_nome: 'COMERCIO', banco: 'Hage.0001.Log', ano: '2026', numero: '000410',
    cliente_codigo: '01450', cliente_nome: 'SUPERMERCADOS DB LTDA', cliente_cnpj: '22991939000106', pedido_compra: '132270- 001',
    filtro: 'TODOS', qtd_itens: 37, total: 9876.4, total_com_st: 9911.02, arquivo_pdf: 'pedido (10).pdf'
  },
  {
    id: 2, criado_em: new Date(Date.now() - 86400000).toISOString(), usuario_nome: 'Mateus', estacao: 'VENDAS-01',
    conexao_cliente: 'Hage', conexao_nome: 'COMERCIO', banco: 'Hage.0001.Log', ano: '2026', numero: '000411',
    cliente_codigo: '01462', cliente_nome: 'SUPERMERCADOS DB LTDA', cliente_cnpj: '22991939002907', pedido_compra: '153331- 029',
    filtro: 'TODOS', qtd_itens: 31, total: 2261.86, total_com_st: 2261.86, arquivo_pdf: 'HAGE RR.pdf'
  }
]

export function instalarApiDemo() {
  const api: Api = {
    conexoes: {
      listar: async () => perfis.map((p) => ({ ...p })),
      salvar: async (p) => {
        const id = p.id || crypto.randomUUID()
        const novo = { ...p, id, temSenha: true }
        const i = perfis.findIndex((x) => x.id === id)
        if (i >= 0) perfis[i] = novo
        else perfis.push(novo)
        return novo
      },
      excluir: async (id) => {
        const i = perfis.findIndex((x) => x.id === id)
        if (i >= 0) perfis.splice(i, 1)
      },
      testar: async (p) => {
        await espera(700)
        return {
          ok: true,
          driverUsado: 'tedious (TCP/IP)',
          versao: 'Express Edition (64-bit) 16.0.1000.6',
          bancos: ['Hage.0001.Log', 'Hage.0002.Log', 'NorteERP'],
          itens: [
            { ok: true, titulo: 'Conexão com o servidor', detalhe: 'Driver: tedious (TCP/IP)' },
            { ok: true, titulo: `Banco ${p.banco}`, detalhe: 'Acesso liberado' },
            { ok: true, titulo: 'dbo.Produtos', detalhe: 'busca de produtos e cálculo do ST' },
            { ok: true, titulo: 'dbo.Clientes', detalhe: 'cliente pelo CNPJ' },
            { ok: true, titulo: 'dbo.PrevendasIndice', detalhe: 'numeração das pré-vendas' },
            { ok: true, titulo: 'dbo.Prevendas', detalhe: 'cabeçalho da pré-venda' },
            { ok: true, titulo: 'dbo.PrevendasItens', detalhe: 'itens da pré-venda' },
            { ok: true, aviso: true, titulo: 'dbo.EventosSistema', detalhe: 'Não encontrada: registro de eventos (log) ficará desativado.' },
            { ok: true, titulo: 'Nome do cliente', detalhe: 'Coluna Clientes.Nome' },
            { ok: true, titulo: 'Permissões do usuário', detalhe: 'Leitura de produtos e gravação de pré-vendas liberadas' },
            { ok: true, titulo: 'Cadastros', detalhe: '4.812 produtos · 1.236 clientes' }
          ]
        }
      },
      nativoDisponivel: async () => true,
      exportar: async () => true,
      importar: async () => 0
    },
    pdf: {
      abrir: async () => {
        await espera(400)
        return structuredClone(pdf)
      },
      lerArquivo: async () => structuredClone(pdf)
    },
    erp: {
      produtos: async (_id, codigos) => {
        await espera(300)
        return Object.fromEntries(codigos.map((c) => [c, produtos.get(c) ?? null]))
      },
      cliente: async (_id, cnpj) => {
        await espera(200)
        return cnpj.startsWith('22991939') ? { codigo: '014' + cnpj.slice(10, 12), nome: 'SUPERMERCADOS DB LTDA', setor: '004' } : null
      },
      verificarPedido: async (_id, _cli, ped) => (ped === '153331- 029' ? [{ ano: '2026', numero: '000411', data: '20/09/2026' }] : []),
      limitePedido: async () => 15,
      status: async (id) => {
        await espera(150)
        if (id === 'cli-x') throw new Error('O servidor não respondeu a tempo.')
        return 'tedious (TCP/IP)'
      },
      gerar: async (_id, envio) => {
        await espera(900)
        numero++
        return {
          ano: '2026', numero: String(numero).padStart(6, '0'), clienteCodigo: '01455', clienteNome: 'SUPERMERCADOS DB LTDA',
          setor: '004', qtdItens: envio.itens.length,
          total: envio.itens.reduce((s, i) => s + i.quantidade * i.preco, 0), totalComST: envio.itens.reduce((s, i) => s + i.quantidade * i.preco, 0)
        }
      }
    },
    sistema: { estacao: async () => 'VENDAS-01' },
    atualizacao: {
      versao: async () => '1.0.0',
      instalar: async () => undefined,
      verificar: async () => ({ ok: true }),
      aoMudar: () => () => undefined
    }
  }
  ;(window as unknown as { api: Api }).api = api
}

const eu: Perfil = { id: 'u1', nome: 'Ramon', email: 'ramon@exemplo.com', papel: 'admin', ativo: true }
const usuarios: Perfil[] = [
  eu,
  { id: 'u2', nome: 'Deyse', email: 'deyse@exemplo.com', papel: 'operador', ativo: true },
  { id: 'u3', nome: 'Mateus', email: 'mateus@exemplo.com', papel: 'operador', ativo: true },
  { id: 'u4', nome: 'Thiago', email: 'thiago@exemplo.com', papel: 'operador', ativo: false }
]
let logado = new URLSearchParams(location.search).has('logado')
const ouvintes = new Set<(l: boolean) => void>()

export const nuvemDemo: Nuvem = {
  configurada: true,
  async entrar(email, senha) {
    await espera(400)
    if (!email || !senha) throw new Error('E-mail ou senha incorretos.')
    logado = true
    ouvintes.forEach((f) => f(true))
  },
  async sair() {
    logado = false
    ouvintes.forEach((f) => f(false))
  },
  async usuarioAtualId() {
    return logado ? eu.id : null
  },
  aoMudarSessao(fn) {
    ouvintes.add(fn)
    return () => ouvintes.delete(fn)
  },
  async meuPerfil() {
    return logado ? eu : null
  },
  async registrarPreVenda(r) {
    historico.unshift({ ...r, id: historico.length + 1, criado_em: new Date().toISOString() })
  },
  async historico({ texto }) {
    const t = (texto ?? '').toLowerCase()
    return historico.filter((h) => !t || JSON.stringify(h).toLowerCase().includes(t))
  },
  async jaGeradoNoHistorico(cli, cnpj, ped) {
    return historico.filter((h) => h.conexao_cliente === cli && h.cliente_cnpj === cnpj && h.pedido_compra === ped)
  },
  async usuarios() {
    return usuarios
  },
  async criarUsuario(d) {
    usuarios.push({ id: crypto.randomUUID(), nome: d.nome, email: d.email, papel: d.papel, ativo: true })
  },
  async alterarUsuario(id, d) {
    const u = usuarios.find((x) => x.id === id)
    if (u) Object.assign(u, d)
  },
  async trocarSenha() {
    await espera(300)
  }
}
