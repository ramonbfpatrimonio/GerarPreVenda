// Modo offline.
//
// 1) Acesso sem internet: depois de um login online, guardamos neste computador
//    uma verificação da senha (scrypt com sal, nunca a senha) e o perfil do
//    usuário, cifrados pelo Windows (safeStorage). Sem internet, quem já entrou
//    aqui consegue entrar de novo por até DIAS_OFFLINE dias desde o último login online.
//
// 2) Fila do histórico: pré-vendas geradas sem internet ficam guardadas e são
//    enviadas ao Supabase quando a conexão volta (cada uma com uma chave única,
//    então reenviar não duplica).

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, rename } from 'fs/promises'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

export const DIAS_OFFLINE = 7

export interface PerfilOffline {
  id: string
  nome: string
  email: string
  papel: string
  ativo: boolean
  empresa_id: string | null
  empresa_nome: string
  empresa_ativa: boolean
  licenca?: unknown // situação da cobrança no último acesso online
}

interface Credencial {
  sal: string
  hash: string
  perfil: PerfilOffline
  validoAte: string
}

type Credenciais = Record<string, Credencial> // chave: e-mail em minúsculas

const arq = (nome: string) => join(app.getPath('userData'), nome)

async function lerCifrado<T>(nome: string, padrao: T): Promise<T> {
  if (!existsSync(arq(nome))) return padrao
  try {
    const bruto = await readFile(arq(nome))
    const txt = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(bruto)
      : Buffer.from(bruto.toString('utf8'), 'base64').toString('utf8')
    return JSON.parse(txt) as T
  } catch {
    return padrao
  }
}

async function gravarCifrado(nome: string, dados: unknown): Promise<void> {
  const txt = JSON.stringify(dados)
  const conteudo = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(txt)
    : Buffer.from(Buffer.from(txt, 'utf8').toString('base64'), 'utf8')
  const tmp = arq(nome) + '.tmp'
  await writeFile(tmp, conteudo)
  await rename(tmp, arq(nome))
}

const ARQ_CRED = 'acesso-offline.dat'
const ARQ_FILA = 'fila-historico.dat'

function derivar(senha: string, sal: Buffer): Buffer {
  return scryptSync(senha, sal, 32, { N: 16384, r: 8, p: 1 })
}

/** Chamado após cada login online bem-sucedido. */
export async function lembrar(email: string, senha: string, perfil: PerfilOffline): Promise<void> {
  const creds = await lerCifrado<Credenciais>(ARQ_CRED, {})
  const sal = randomBytes(16)
  creds[email.trim().toLowerCase()] = {
    sal: sal.toString('base64'),
    hash: derivar(senha, sal).toString('base64'),
    perfil,
    validoAte: new Date(Date.now() + DIAS_OFFLINE * 86400000).toISOString()
  }
  await gravarCifrado(ARQ_CRED, creds)
}

/** Atualiza o perfil guardado (sem mexer na senha nem no prazo). */
export async function atualizarPerfil(perfil: PerfilOffline): Promise<void> {
  const creds = await lerCifrado<Credenciais>(ARQ_CRED, {})
  const c = creds[perfil.email.trim().toLowerCase()]
  if (!c) return
  c.perfil = perfil
  await gravarCifrado(ARQ_CRED, creds)
}

export async function entrar(email: string, senha: string): Promise<PerfilOffline> {
  const creds = await lerCifrado<Credenciais>(ARQ_CRED, {})
  const c = creds[email.trim().toLowerCase()]
  if (!c) {
    throw new Error('Sem internet, e este usuário ainda não entrou neste computador com internet. Conecte-se para o primeiro acesso.')
  }
  if (new Date(c.validoAte).getTime() < Date.now()) {
    throw new Error(`Sem internet há mais de ${DIAS_OFFLINE} dias desde o último acesso online. Conecte à internet para entrar.`)
  }
  const calc = derivar(senha, Buffer.from(c.sal, 'base64'))
  const esperado = Buffer.from(c.hash, 'base64')
  if (calc.length !== esperado.length || !timingSafeEqual(calc, esperado)) throw new Error('E-mail ou senha incorretos.')
  if (!c.perfil.ativo || (c.perfil.papel !== 'super_admin' && !c.perfil.empresa_ativa)) throw new Error('Acesso bloqueado.')
  return c.perfil
}

/** Sessão salva + sem internet: segue com o perfil guardado, se ainda no prazo. */
export async function perfilPorId(id: string): Promise<PerfilOffline | null> {
  const creds = await lerCifrado<Credenciais>(ARQ_CRED, {})
  const c = Object.values(creds).find((x) => x.perfil.id === id)
  if (!c || new Date(c.validoAte).getTime() < Date.now()) return null
  return c.perfil
}

export async function esquecer(email: string): Promise<void> {
  const creds = await lerCifrado<Credenciais>(ARQ_CRED, {})
  delete creds[email.trim().toLowerCase()]
  await gravarCifrado(ARQ_CRED, creds)
}

// ---------------------------------------------------------------- fila do histórico
type Registro = Record<string, unknown> & { chave_local: string }

export async function filaAdicionar(r: Registro): Promise<number> {
  const fila = await lerCifrado<Registro[]>(ARQ_FILA, [])
  if (!fila.some((x) => x.chave_local === r.chave_local)) fila.push(r)
  await gravarCifrado(ARQ_FILA, fila)
  return fila.length
}

export async function filaListar(): Promise<Registro[]> {
  return lerCifrado<Registro[]>(ARQ_FILA, [])
}

export async function filaRemover(chaves: string[]): Promise<number> {
  const fila = (await lerCifrado<Registro[]>(ARQ_FILA, [])).filter((x) => !chaves.includes(x.chave_local))
  await gravarCifrado(ARQ_FILA, fila)
  return fila.length
}
