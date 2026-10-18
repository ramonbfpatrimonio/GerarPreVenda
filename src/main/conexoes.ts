// Armazenamento dos perfis de conexão neste computador.
//
// As senhas dos bancos NUNCA saem da máquina nem vão para o Supabase:
// ficam cifradas com o safeStorage do Electron (DPAPI do Windows, atrelada ao
// usuário do Windows). Para levar conexões a outro PC existe a exportação,
// cifrada com AES-256-GCM e uma senha escolhida na hora.

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, rename } from 'fs/promises'
import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv } from 'crypto'
import { REGRAS_PADRAO, type DadosConexaoNuvem, type PerfilConexao } from '@shared/tipos'

interface PerfilArmazenado extends Omit<PerfilConexao, 'temSenha'> {
  senhaCifrada?: string // base64 (safeStorage)
  senhaTextoBase64?: string // só se o sistema não tiver cofre disponível
}

interface Arquivo {
  versao: 1
  perfis: PerfilArmazenado[]
}

const caminho = () => join(app.getPath('userData'), 'conexoes.json')
let cache: Arquivo | null = null

/** Força reler o arquivo de conexões. */
export function esquecerCache() {
  cache = null
}

async function carregar(): Promise<Arquivo> {
  if (cache) return cache
  if (!existsSync(caminho())) {
    cache = { versao: 1, perfis: [] }
    return cache
  }
  const dados = JSON.parse(await readFile(caminho(), 'utf8')) as Arquivo
  dados.perfis = (dados.perfis ?? []).map((p) => ({ ...p, empresaId: p.empresaId ?? '', ativo: p.ativo ?? true, regras: { ...REGRAS_PADRAO, ...p.regras } }))
  cache = dados
  return cache
}

async function gravar(dados: Arquivo): Promise<void> {
  const tmp = caminho() + '.tmp'
  await writeFile(tmp, JSON.stringify(dados, null, 2), 'utf8')
  await rename(tmp, caminho())
  cache = dados
}

function cifrar(senha: string): Pick<PerfilArmazenado, 'senhaCifrada' | 'senhaTextoBase64'> {
  if (safeStorage.isEncryptionAvailable()) {
    return { senhaCifrada: safeStorage.encryptString(senha).toString('base64') }
  }
  return { senhaTextoBase64: Buffer.from(senha, 'utf8').toString('base64') }
}

function decifrar(p: PerfilArmazenado): string {
  if (p.senhaCifrada) return safeStorage.decryptString(Buffer.from(p.senhaCifrada, 'base64'))
  if (p.senhaTextoBase64) return Buffer.from(p.senhaTextoBase64, 'base64').toString('utf8')
  return ''
}

function publico(p: PerfilArmazenado): PerfilConexao {
  const { senhaCifrada, senhaTextoBase64, ...resto } = p
  return { ...resto, temSenha: !!(senhaCifrada || senhaTextoBase64) }
}

export async function listarPerfis(): Promise<PerfilConexao[]> {
  const d = await carregar()
  return d.perfis.map(publico).sort((a, b) => (a.cliente + a.nome).localeCompare(b.cliente + b.nome, 'pt-BR'))
}

export async function obterPerfil(id: string): Promise<{ perfil: PerfilConexao; senha: string }> {
  const d = await carregar()
  const p = d.perfis.find((x) => x.id === id)
  if (!p) throw new Error('Conexão não encontrada. Ela pode ter sido excluída.')
  return { perfil: publico(p), senha: decifrar(p) }
}

/** Senha a usar num teste: a digitada agora ou, se vazia, a já salva. */
export async function senhaParaTeste(perfil: PerfilConexao, senhaDigitada?: string): Promise<string> {
  if (senhaDigitada) return senhaDigitada
  if (!perfil.id) return ''
  const d = await carregar()
  const p = d.perfis.find((x) => x.id === perfil.id)
  return p ? decifrar(p) : ''
}

/** Salva o perfil. `senha` undefined mantém a atual; '' apaga. */
export async function salvarPerfil(perfil: PerfilConexao, senha?: string): Promise<PerfilConexao> {
  const d = await carregar()
  const id = perfil.id || randomUUID()
  const anterior = d.perfis.find((x) => x.id === id)
  const { temSenha, ...dados } = perfil
  let armazenado: PerfilArmazenado = {
    ...dados,
    id,
    empresaId: perfil.empresaId ?? '',
    ativo: perfil.ativo ?? true,
    cliente: perfil.cliente.trim(),
    nome: perfil.nome.trim(),
    servidor: perfil.servidor.trim(),
    instancia: perfil.instancia.trim(),
    usuario: perfil.usuario.trim(),
    banco: perfil.banco.trim(),
    regras: { ...REGRAS_PADRAO, ...perfil.regras },
    atualizadoEm: new Date().toISOString()
  }
  if (senha === undefined) {
    armazenado = { ...armazenado, senhaCifrada: anterior?.senhaCifrada, senhaTextoBase64: anterior?.senhaTextoBase64 }
  } else if (senha !== '') {
    armazenado = { ...armazenado, ...cifrar(senha) }
  }
  d.perfis = [...d.perfis.filter((x) => x.id !== id), armazenado]
  await gravar(d)
  return publico(armazenado)
}

/**
 * Sincroniza com o cadastro da empresa na nuvem: as conexões daquela empresa
 * passam a ser exatamente as da nuvem, mantendo as senhas já digitadas neste
 * computador. Também serve de cópia para trabalhar sem internet.
 */
export async function sincronizar(empresaId: string, lista: DadosConexaoNuvem[]): Promise<void> {
  if (!empresaId) return
  const d = await carregar()
  const anteriores = new Map(d.perfis.map((p) => [p.id, p]))
  const daNuvem: PerfilArmazenado[] = lista.map((dados) => {
    const antes = anteriores.get(dados.id)
    return {
      ...dados,
      empresaId,
      ativo: dados.ativo ?? true,
      regras: { ...REGRAS_PADRAO, ...dados.regras },
      atualizadoEm: new Date().toISOString(),
      senhaCifrada: antes?.senhaCifrada,
      senhaTextoBase64: antes?.senhaTextoBase64
    }
  })
  const ids = new Set(daNuvem.map((p) => p.id))
  d.perfis = [...d.perfis.filter((p) => p.empresaId !== empresaId && !ids.has(p.id)), ...daNuvem]
  await gravar(d)
}

/** Grava só a senha deste computador para uma conexão já existente. */
export async function salvarSenha(id: string, senha: string): Promise<PerfilConexao> {
  const d = await carregar()
  const p = d.perfis.find((x) => x.id === id)
  if (!p) throw new Error('Conexão não encontrada neste computador.')
  return salvarPerfil(publico(p), senha)
}

export async function excluirPerfil(id: string): Promise<void> {
  const d = await carregar()
  d.perfis = d.perfis.filter((x) => x.id !== id)
  await gravar(d)
}

// ---------------------------------------------------------------------------
// Exportar / importar (arquivo .gpvconn)
// ---------------------------------------------------------------------------

interface Pacote {
  formato: 'gerar-pre-venda/conexoes'
  versao: 1
  salt: string
  iv: string
  tag: string
  dados: string
}

export async function exportar(ids: string[], senhaArquivo: string): Promise<string> {
  if (senhaArquivo.length < 4) throw new Error('A senha do arquivo precisa ter pelo menos 4 caracteres.')
  const d = await carregar()
  const selecionados = d.perfis
    .filter((p) => ids.length === 0 || ids.includes(p.id))
    .map((p) => ({ ...publico(p), senha: decifrar(p) }))
  if (selecionados.length === 0) throw new Error('Nenhuma conexão para exportar.')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const chave = scryptSync(senhaArquivo, salt, 32)
  const c = createCipheriv('aes-256-gcm', chave, iv)
  const dados = Buffer.concat([c.update(JSON.stringify(selecionados), 'utf8'), c.final()])
  const pacote: Pacote = {
    formato: 'gerar-pre-venda/conexoes',
    versao: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    dados: dados.toString('base64')
  }
  return JSON.stringify(pacote)
}

export async function importar(conteudo: string, senhaArquivo: string): Promise<number> {
  let pacote: Pacote
  try {
    pacote = JSON.parse(conteudo)
  } catch {
    throw new Error('Arquivo inválido.')
  }
  if (pacote.formato !== 'gerar-pre-venda/conexoes') throw new Error('Este arquivo não é uma exportação de conexões.')
  let lista: (PerfilConexao & { senha: string })[]
  try {
    const chave = scryptSync(senhaArquivo, Buffer.from(pacote.salt, 'base64'), 32)
    const dc = createDecipheriv('aes-256-gcm', chave, Buffer.from(pacote.iv, 'base64'))
    dc.setAuthTag(Buffer.from(pacote.tag, 'base64'))
    const txt = Buffer.concat([dc.update(Buffer.from(pacote.dados, 'base64')), dc.final()]).toString('utf8')
    lista = JSON.parse(txt)
  } catch {
    throw new Error('Senha do arquivo incorreta.')
  }
  for (const { senha, ...p } of lista) await salvarPerfil(p, senha)
  return lista.length
}
