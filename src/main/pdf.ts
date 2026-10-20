// Extrai as células de texto do PDF com pdfjs e entrega ao leitor Bluesoft.
import { basename } from 'path'
import { readFile } from 'fs/promises'
import type { ResultadoPdf } from '@shared/tipos'
import { lerPedidosBluesoft, type PaginaPdf } from '@shared/pdf/bluesoft'
import { ehPedido210, lerPedidos210 } from '@shared/pdf/pedido210'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsCache: PdfJs | null = null

async function pdfjs(): Promise<PdfJs> {
  if (!pdfjsCache) pdfjsCache = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsCache
}

export async function extrairPaginas(dados: Uint8Array): Promise<PaginaPdf[]> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: dados, verbosity: 0, isEvalSupported: false }).promise
  const paginas: PaginaPdf[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n)
      // A viewport já considera a rotação da página (o PDF do DB vem girado 90°).
      const vp = pg.getViewport({ scale: 1 })
      const conteudo = await pg.getTextContent()
      const celulas = []
      for (const it of conteudo.items) {
        if (!('str' in it) || !it.str.trim()) continue
        const [x, y] = lib.Util.applyTransform([it.transform[4], it.transform[5]], vp.transform)
        celulas.push({ x, y, texto: it.str })
      }
      paginas.push({ numero: n, celulas })
      pg.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return paginas
}

export async function lerPdf(caminho: string): Promise<ResultadoPdf> {
  const buf = await readFile(caminho)
  const paginas = await extrairPaginas(new Uint8Array(buf))
  return lerPaginas(paginas, basename(caminho))
}

/** Escolhe o leitor pelo layout do PDF. */
export function lerPaginas(paginas: PaginaPdf[], arquivo: string): ResultadoPdf {
  // Cada modelo de pedido (aba "Modelos de Pedido") tem o seu leitor.
  if (ehPedido210(paginas)) return { ...lerPedidos210(paginas, arquivo), modelo: 'pedido210' }
  const r: ResultadoPdf = { ...lerPedidosBluesoft(paginas, arquivo), modelo: 'bluesoft' }
  if (r.pedidos.length === 0) {
    r.modelo = undefined
    r.avisos.push(
      'Modelo de pedido não reconhecido. Verifique se o PDF tem texto (não escaneado) ou envie este modelo para ser incluído.'
    )
  }
  return r
}
