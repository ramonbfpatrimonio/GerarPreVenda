// Extrai as células de texto do PDF com pdfjs e entrega ao leitor Bluesoft.
import { basename } from 'path'
import { readFile } from 'fs/promises'
import type { ResultadoPdf } from '@shared/tipos'
import { lerPedidosBluesoft, type PaginaPdf } from '@shared/pdf/bluesoft'

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
  const r = lerPedidosBluesoft(paginas, basename(caminho))
  if (r.pedidos.length === 0) {
    r.avisos.push(
      'Nenhum pedido no layout Bluesoft foi encontrado. Verifique se o PDF é um pedido de compra com texto (não escaneado).'
    )
  }
  return r
}
