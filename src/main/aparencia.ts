// Aparência do login (papel de parede e logo): guardada só neste computador.
import { app } from 'electron'
import { join } from 'path'
import { readFile, rename, rm, writeFile } from 'fs/promises'

const dados = (nome: string) => join(app.getPath('userData'), nome)

export interface Aparencia {
  empresaId: string
  empresaNome: string
  fundo: string | null
  logo: string | null
  /** 'preencher': cobre toda a área (recorta as sobras); 'inteira': mostra a imagem toda */
  ajuste?: 'preencher' | 'inteira'
  atualizadoEm: string
}

export async function lerAparencia(): Promise<Aparencia | null> {
  try {
    return JSON.parse(await readFile(dados('aparencia.json'), 'utf8')) as Aparencia
  } catch {
    return null
  }
}

export async function salvarAparencia(a: Aparencia | null): Promise<void> {
  if (!a) {
    await rm(dados('aparencia.json'), { force: true })
    return
  }
  const tmp = dados('aparencia.json') + '.tmp'
  await writeFile(tmp, JSON.stringify(a), 'utf8')
  await rename(tmp, dados('aparencia.json'))
}
