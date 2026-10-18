// MODO DEMONSTRAÇÃO — só entra no build com VITE_DEMO=1 (npm run demo).
// Simula o processo principal e o Supabase para testar as telas sem banco.
// Parâmetros da URL: ?logado (entra como super admin), ?operador (entra como operador),
// ?offline (simula sem internet).
import type { Api, RegistroFila } from '../../../preload/api'
import type { DadosConexaoNuvem, PerfilConexao, ProdutoErp, ResultadoPdf } from '@shared/tipos'
import { REGRAS_PADRAO } from '@shared/tipos'
import type { Empresa, Evento, NovoEvento, Nuvem, Perfil, RegistroHistorico } from './nuvem'
import type { AparenciaLocal } from '../../../preload/api'
import pedidosDemo from './demo-pedidos.json'

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const params = new URLSearchParams(location.search)
const semInternet = params.has('offline')

const HAGE = 'emp-hage'
const NORTE = 'emp-norte'

const empresas: Empresa[] = [
  { id: HAGE, nome: 'Hage', cnpj: '39648061000103', ativa: true, retencao_meses: 24, usuarios: 4, prevendas_mes: 38, total_mes: 112480.55, ultima_atividade: new Date(Date.now() - 3600000).toISOString() },
  { id: NORTE, nome: 'Distribuidora Norte', cnpj: '11222333000181', ativa: true, retencao_meses: 24, usuarios: 2, prevendas_mes: 12, total_mes: 31877.1, ultima_atividade: new Date(Date.now() - 86400000 * 2).toISOString() }
]

if (params.has('vazio')) empresas.length = 0 // ?vazio: banco da nuvem zerado

const base = (o: Partial<PerfilConexao>): PerfilConexao => ({
  id: '', empresaId: HAGE, cliente: 'Hage', nome: '', cor: '#1f5f9e', servidor: 'THIAGO-DELL', instancia: '', porta: null,
  autenticacao: 'sql', usuario: 'sa', temSenha: true, banco: '', driver: 'auto', criptografar: false,
  cnpjsEmpresa: [], regras: { ...REGRAS_PADRAO }, atualizadoEm: new Date().toISOString(), ativo: true, ...o
})

// "Nuvem": cadastro das conexões por empresa (sem senha)
const conexoesNuvem: { id: string; empresa_id: string; dados: DadosConexaoNuvem }[] = [
  base({ id: 'hage-com', nome: 'COMERCIO', banco: 'Hage.0001.Log', cnpjsEmpresa: ['39648061000103'] }),
  base({ id: 'hage-ind', nome: 'INDUSTRIA', cor: '#7a3fb5', banco: 'Hage.0002.Log' }),
  base({ id: 'hage-teste', nome: 'TESTE (homologação)', cor: '#8a8f98', banco: 'Hage.Teste', ativo: false }),
  base({ id: 'norte-mat', empresaId: NORTE, cliente: 'Distribuidora Norte', nome: 'Matriz', cor: '#0e7c5a', servidor: 'localhost', instancia: 'SQLEXPRESS', autenticacao: 'windows', usuario: '', banco: 'NorteERP' })
].map(({ temSenha: _t, atualizadoEm: _a, ...dados }) => ({ id: dados.id, empresa_id: dados.empresaId, dados }))

// "Computador": cópia local com as senhas deste PC (como se já tivesse sincronizado antes)
const locais: PerfilConexao[] = conexoesNuvem.map((c) => ({ ...c.dados, temSenha: false, atualizadoEm: new Date().toISOString() }))
const senhasLocais = new Set(['hage-com'])

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
    id: 1, criado_em: new Date(Date.now() - 86400000 * 2).toISOString(), empresa_id: HAGE, usuario_nome: 'Deyse', estacao: 'CAIXA-02',
    conexao_cliente: 'Hage', conexao_nome: 'COMERCIO', banco: 'Hage.0001.Log', ano: '2026', numero: '000410',
    cliente_codigo: '01450', cliente_nome: 'SUPERMERCADOS DB LTDA', cliente_cnpj: '22991939000106', pedido_compra: '132270- 001',
    filtro: 'TODOS', qtd_itens: 37, total: 9876.4, total_com_st: 9911.02, arquivo_pdf: 'pedido (10).pdf'
  },
  {
    id: 2, criado_em: new Date(Date.now() - 86400000).toISOString(), empresa_id: HAGE, usuario_nome: 'Mateus', estacao: 'VENDAS-01',
    conexao_cliente: 'Hage', conexao_nome: 'COMERCIO', banco: 'Hage.0001.Log', ano: '2026', numero: '000411',
    cliente_codigo: '01462', cliente_nome: 'SUPERMERCADOS DB LTDA', cliente_cnpj: '22991939002907', pedido_compra: '153331- 029',
    filtro: 'TODOS', qtd_itens: 31, total: 2261.86, total_com_st: 2261.86, arquivo_pdf: 'HAGE RR.pdf'
  },
  {
    id: 3, criado_em: new Date(Date.now() - 86400000 * 3).toISOString(), empresa_id: NORTE, usuario_nome: 'Carla', estacao: 'NORTE-01',
    conexao_cliente: 'Distribuidora Norte', conexao_nome: 'Matriz', banco: 'NorteERP', ano: '2026', numero: '000087',
    cliente_codigo: '00321', cliente_nome: 'MERCADINHO BOA ESPERANÇA', cliente_cnpj: '45111222000190', pedido_compra: 'A-7781',
    filtro: 'TODOS', qtd_itens: 12, total: 3480, total_com_st: 3480, arquivo_pdf: ''
  }
]
const fila: RegistroFila[] = []

let aparenciaLocal: AparenciaLocal | null = null

let idEvento = 1
const eventos: Evento[] = []
const semente = (min: number, empresa: string, usuario: string, estacao: string, acao: string, entidade: string, descricao: string) =>
  eventos.push({ id: idEvento++, criado_em: new Date(Date.now() - min * 60000 - 17000).toISOString(), empresa_id: empresa, usuario_nome: usuario, estacao, acao, entidade, descricao, detalhes: {} })
semente(3200, HAGE, 'Ramon', 'RAMON-NOTE', 'criou', 'conexão', 'Criou a conexão Hage › INDUSTRIA')
semente(2890, HAGE, 'Deyse', 'CAIXA-02', 'gerou', 'pré-venda', 'Pré-venda 000410/2026 · SUPERMERCADOS DB LTDA · pedido 132270- 001 · R$ 9.911,02')
semente(1500, HAGE, 'Deyse', 'CAIXA-02', 'alterou', 'usuário', 'Alterou o usuário Thiago: desativado')
semente(1440, HAGE, 'Mateus', 'VENDAS-01', 'gerou', 'pré-venda', 'Pré-venda 000411/2026 · SUPERMERCADOS DB LTDA · pedido 153331- 029 · R$ 2.261,86')
semente(600, HAGE, 'Ramon', 'RAMON-NOTE', 'alterou', 'conexão', 'Alterou a conexão Hage › TESTE (homologação): desativada')
eventos[4].detalhes = { antes: { ativo: true }, depois: { ativo: false } }
semente(95, HAGE, 'Mateus', 'VENDAS-01', 'entrou', 'sessão', 'Entrou no programa')
semente(40, HAGE, 'Mateus', 'VENDAS-01', 'negou', 'área administrativa', 'Acesso negado para mateus@hage.com: este usuário não é administrador')
semente(4300, NORTE, 'Carla', 'NORTE-01', 'gerou', 'pré-venda', 'Pré-venda 000087/2026 · MERCADINHO BOA ESPERANÇA · pedido A-7781 · R$ 3.480,00')
eventos.sort((a, b) => b.criado_em.localeCompare(a.criado_em))
const registrar = (quem: Perfil | null, e: NovoEvento) => {
  if (!quem) return
  if (e.chave_local && eventos.some((x) => (x.detalhes as { chave?: string }).chave === e.chave_local)) return
  eventos.unshift({
    id: idEvento++, criado_em: e.criado_em ?? new Date().toISOString(), empresa_id: (quem.papel === 'super_admin' ? e.empresa_id : quem.empresa_id) ?? HAGE,
    usuario_nome: quem.nome, estacao: 'VENDAS-01', acao: e.acao, entidade: e.entidade, descricao: e.descricao ?? '', detalhes: { ...(e.detalhes ?? {}), ...(e.chave_local ? { chave: e.chave_local } : {}) }
  })
}

export function instalarApiDemo() {
  const api: Api = {
    conexoes: {
      listar: async () => locais.map((p) => ({ ...p, temSenha: p.autenticacao === 'windows' || senhasLocais.has(p.id) })),
      salvar: async (p, senha) => {
        const id = p.id || crypto.randomUUID()
        const novo = { ...p, id }
        const i = locais.findIndex((x) => x.id === id)
        if (i >= 0) locais[i] = novo
        else locais.push(novo)
        if (senha) senhasLocais.add(id)
        return { ...novo, temSenha: senhasLocais.has(id) }
      },
      excluir: async (id) => {
        const i = locais.findIndex((x) => x.id === id)
        if (i >= 0) locais.splice(i, 1)
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
            { ok: true, titulo: 'Permissões do usuário', detalhe: 'Leitura de produtos e gravação de pré-vendas liberadas' }
          ]
        }
      },
      nativoDisponivel: async () => true,
      sincronizar: async (empresaId, lista) => {
        for (let i = locais.length - 1; i >= 0; i--) if (locais[i].empresaId === empresaId) locais.splice(i, 1)
        for (const d of lista) locais.push({ ...d, empresaId, temSenha: false, atualizadoEm: new Date().toISOString() })
      },
      salvarSenha: async (id) => {
        senhasLocais.add(id)
        const p = locais.find((x) => x.id === id)!
        return { ...p, temSenha: true }
      },
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
        if (id === 'norte-mat') throw new Error('O servidor não respondeu a tempo.')
        return 'tedious (TCP/IP)'
      },
      gerar: async (_id, envio) => {
        await espera(900)
        numero++
        const total = envio.itens.reduce((s, i) => s + i.quantidade * i.preco, 0)
        return { ano: '2026', numero: String(numero).padStart(6, '0'), clienteCodigo: '01455', clienteNome: 'SUPERMERCADOS DB LTDA', setor: '004', qtdItens: envio.itens.length, total, totalComST: total }
      }
    },
    sistema: { estacao: async () => 'VENDAS-01' },
    aparencia: {
      ler: async () => aparenciaLocal,
      salvar: async (a) => {
        aparenciaLocal = a
      }
    },
    offline: {
      lembrar: async () => undefined,
      atualizarPerfil: async () => undefined,
      entrar: async (email: string) => {
        const u = usuarios.find((x) => x.email === email.trim())
        if (!u) throw new Error('E-mail ou senha incorretos.')
        return u
      },
      perfilPorId: async () => perfilAtual(),
      esquecer: async () => undefined
    },
    fila: {
      adicionar: async (r) => {
        fila.push(r)
        return fila.length
      },
      listar: async () => [...fila],
      remover: async (chaves) => {
        for (let i = fila.length - 1; i >= 0; i--) if (chaves.includes(fila[i].chave_local)) fila.splice(i, 1)
        return fila.length
      }
    },
    atualizacao: {
      versao: async () => '1.2.0',
      instalar: async () => undefined,
      verificar: async () => ({ ok: true }),
      aoMudar: () => () => undefined
    }
  }
  ;(window as unknown as { api: Api }).api = api
}

const usuarios: Perfil[] = [
  { id: 'u1', nome: 'Ramon', email: 'adm@patrimonio.com', papel: 'super_admin', ativo: true, empresa_id: null, empresa_nome: '', empresa_ativa: false },
  { id: 'u2', nome: 'Deyse', email: 'deyse@hage.com', papel: 'admin', ativo: true, empresa_id: HAGE, empresa_nome: 'Hage', empresa_ativa: true },
  { id: 'u3', nome: 'Mateus', email: 'mateus@hage.com', papel: 'operador', ativo: true, empresa_id: HAGE, empresa_nome: 'Hage', empresa_ativa: true },
  { id: 'u4', nome: 'Thiago', email: 'thiago@hage.com', papel: 'operador', ativo: false, empresa_id: HAGE, empresa_nome: 'Hage', empresa_ativa: true },
  { id: 'u5', nome: 'Carla', email: 'carla@norte.com', papel: 'admin', ativo: true, empresa_id: NORTE, empresa_nome: 'Distribuidora Norte', empresa_ativa: true }
]
const perfilAtual = () => (params.has('operador') ? usuarios[2] : usuarios[0])
let logado = params.has('logado') || params.has('operador')
const ouvintes = new Set<(l: boolean) => void>()
const redeOk = () => {
  if (semInternet) throw new Error('Sem conexão com a internet.')
}

function fabricarDemo(quem: () => Perfil | null): Nuvem {
  return {
  configurada: true,
  async entrar(email, senha) {
    await espera(300)
    redeOk()
    if (!email || !senha) throw new Error('E-mail ou senha incorretos.')
    logado = true
    ouvintes.forEach((f) => f(true))
  },
  async sair() {
    logado = false
    ouvintes.forEach((f) => f(false))
  },
  async usuarioAtualId() {
    return logado ? perfilAtual().id : null
  },
  aoMudarSessao(fn) {
    ouvintes.add(fn)
    return () => ouvintes.delete(fn)
  },
  async meuPerfil() {
    redeOk()
    return logado ? perfilAtual() : null
  },
  async online() {
    return !semInternet
  },
  async registrarPreVenda(r) {
    redeOk()
    if (r.chave_local && historico.some((h) => h.chave_local === r.chave_local)) return
    const empresa_id = quem()?.papel === 'super_admin' ? r.empresa_id : quem()?.empresa_id ?? undefined
    historico.unshift({ ...r, empresa_id, id: historico.length + 1, criado_em: r.criado_em ?? new Date().toISOString() })
    registrar(quem(), { acao: 'gerou', entidade: 'pré-venda', descricao: `Pré-venda ${r.numero}/${r.ano} · ${r.cliente_nome} · pedido ${r.pedido_compra}`, empresa_id })
  },
  async historico({ texto, empresaId }) {
    redeOk()
    const t = (texto ?? '').toLowerCase()
    const meu = quem()?.papel === 'super_admin' ? null : quem()?.empresa_id
    return historico
      .filter((h) => (!meu || h.empresa_id === meu) && (!empresaId || h.empresa_id === empresaId))
      .filter((h) => !t || JSON.stringify(h).toLowerCase().includes(t))
      .map((h) => ({ ...h, empresas: { nome: empresas.find((e) => e.id === h.empresa_id)?.nome ?? '' } }))
  },
  async jaGeradoNoHistorico(empresaId, cnpj, ped) {
    redeOk()
    return historico.filter((h) => (!empresaId || h.empresa_id === empresaId) && h.cliente_cnpj === cnpj && h.pedido_compra === ped)
  },
  async usuarios(empresaId) {
    redeOk()
    return usuarios.filter((u) => !empresaId || u.empresa_id === empresaId)
  },
  async criarUsuario(d) {
    const e = empresas.find((x) => x.id === d.empresa_id)
    usuarios.push({ id: crypto.randomUUID(), nome: d.nome, email: d.email, papel: d.papel, ativo: true, empresa_id: d.empresa_id ?? null, empresa_nome: e?.nome ?? '', empresa_ativa: true })
  },
  async alterarUsuario(id, d) {
    const u = usuarios.find((x) => x.id === id)
    if (u) Object.assign(u, d)
    if (u) registrar(quem(), { acao: 'alterou', entidade: 'usuário', descricao: `Alterou o usuário ${u.nome}: ${Object.entries(d).map(([k, v]) => `${k} = ${v}`).join(', ')}`, empresa_id: u.empresa_id })
  },
  async trocarSenha() {
    await espera(300)
  },
  async empresas() {
    redeOk()
    return empresas.map((e) => ({ ...e }))
  },
  async criarEmpresa(d) {
    const id = 'emp-' + crypto.randomUUID().slice(0, 8)
    empresas.push({ id, nome: d.nome, cnpj: d.cnpj, ativa: true, retencao_meses: 24, usuarios: 1, prevendas_mes: 0, total_mes: 0, ultima_atividade: null })
    usuarios.push({ id: crypto.randomUUID(), nome: d.admin_nome, email: d.admin_email, papel: 'admin', ativo: true, empresa_id: id, empresa_nome: d.nome, empresa_ativa: true })
    return id
  },
  async alterarEmpresa(id, d) {
    const e = empresas.find((x) => x.id === id)
    if (e) Object.assign(e, d)
  },
  async conexoes(empresaId) {
    redeOk()
    return conexoesNuvem.filter((c) => c.empresa_id === empresaId).map((c) => ({ ...c, dados: { ...c.dados } }))
  },
  async salvarConexao(empresaId, dados) {
    redeOk()
    const i = conexoesNuvem.findIndex((c) => c.id === dados.id)
    const reg = { id: dados.id, empresa_id: empresaId, dados: { ...dados, empresaId } }
    const antes = i >= 0 ? conexoesNuvem[i].dados : null
    if (i >= 0) conexoesNuvem[i] = reg
    else conexoesNuvem.push(reg)
    const desc = !antes ? 'Criou' : antes.ativo !== false && dados.ativo === false ? 'Desativou' : antes.ativo === false && dados.ativo !== false ? 'Ativou' : 'Alterou'
    registrar(quem(), { acao: antes ? 'alterou' : 'criou', entidade: 'conexão', descricao: `${desc} a conexão ${dados.cliente} › ${dados.nome}`, empresa_id: empresaId })
  },
  async excluirConexao(id) {
    const i = conexoesNuvem.findIndex((c) => c.id === id)
    if (i >= 0) registrar(quem(), { acao: 'excluiu', entidade: 'conexão', descricao: `Excluiu a conexão ${conexoesNuvem[i].dados.cliente} › ${conexoesNuvem[i].dados.nome}`, empresa_id: conexoesNuvem[i].empresa_id })
    if (i >= 0) conexoesNuvem.splice(i, 1)
  }
  ,
  async registrarEvento(e) {
    redeOk()
    registrar(quem(), e)
  },
  async eventos({ desde, texto, acao, entidade, empresaId }) {
    redeOk()
    await espera(200)
    const eu = quem()
    const t = (texto ?? '').toLowerCase()
    return eventos
      .filter((e) => (eu?.papel === 'super_admin' || e.empresa_id === eu?.empresa_id) && (!empresaId || e.empresa_id === empresaId))
      .filter((e) => (!desde || e.criado_em >= desde) && (!acao || e.acao === acao) && (!entidade || e.entidade === entidade))
      .filter((e) => !t || `${e.descricao} ${e.usuario_nome} ${e.estacao}`.toLowerCase().includes(t))
      .map((e) => ({ ...e, empresas: { nome: empresas.find((x) => x.id === e.empresa_id)?.nome ?? '' } }))
  },
  }
}

export const nuvemDemo: Nuvem = fabricarDemo(() => (logado ? perfilAtual() : null))

/** Sessão separada da área administrativa (Ctrl+Shift+B). Senha de demonstração: qualquer uma com 3+ letras. */
export function criarNuvemAdminDemo(): Nuvem {
  let eu: Perfil | null = null
  const n = fabricarDemo(() => eu)
  return {
    ...n,
    async entrar(email, senha) {
      await espera(300)
      redeOk()
      const u = usuarios.find((x) => x.email === email.trim())
      if (!u || senha.length < 3) throw new Error('E-mail ou senha incorretos.')
      eu = u
    },
    async sair() {
      eu = null
    },
    async usuarioAtualId() {
      return eu?.id ?? null
    },
    aoMudarSessao: () => () => undefined,
    async meuPerfil() {
      redeOk()
      return eu
    }
  }
}
