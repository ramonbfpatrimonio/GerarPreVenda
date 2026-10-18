import { useEffect, useRef, useState } from 'react'
import { useAviso, useSessao } from '../contexto'
import { useAdmin } from '../admin'
import { Icone } from '../componentes/Icone'
import { Alerta } from '../componentes/Modal'
import { FundoLogin, type Ajuste } from '../componentes/FundoLogin'
import logoPadrao from '../assets/logo.png'

interface Imagem {
  dados: string
  largura: number
  altura: number
}

const lerComoDataUrl = (f: Blob) =>
  new Promise<string>((ok, falha) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result))
    r.onerror = () => falha(new Error('Não foi possível ler o arquivo.'))
    r.readAsDataURL(f)
  })

const abrirImagem = (src: string) =>
  new Promise<HTMLImageElement>((ok, falha) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = () => falha(new Error('Não foi possível abrir esta imagem.'))
    i.src = src
  })

/**
 * Prepara a imagem sem perder qualidade:
 *  - até `maxLado` px (e arquivo até `maxBytes`) fica o arquivo ORIGINAL, sem recomprimir;
 *  - maior que isso, reduz em etapas (metade por vez, que preserva a nitidez) até `maxLado`
 *    e salva com qualidade alta. Nunca estica: a proporção é sempre mantida.
 */
async function preparar(arquivo: File, maxLado: number, maxBytes: number, saida: 'image/jpeg' | 'image/png'): Promise<Imagem> {
  const original = await lerComoDataUrl(arquivo)
  const img = await abrirImagem(original)
  const largura = img.naturalWidth
  const altura = img.naturalHeight
  if (!largura || !altura) throw new Error('Imagem sem tamanho válido.')
  const formatoComum = /^image\/(jpeg|png|webp)$/.test(arquivo.type)
  if (formatoComum && Math.max(largura, altura) <= maxLado && arquivo.size <= maxBytes) return { dados: original, largura, altura }

  const escala = Math.min(1, maxLado / Math.max(largura, altura))
  const alvoL = Math.round(largura * escala)
  const alvoA = Math.round(altura * escala)
  // redução em etapas: evita o serrilhado de reduzir muito de uma vez
  let fonte: CanvasImageSource = img
  let l = largura
  let a = altura
  while (l / 2 >= alvoL && a / 2 >= alvoA) {
    const c = document.createElement('canvas')
    c.width = Math.round(l / 2)
    c.height = Math.round(a / 2)
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(fonte, 0, 0, c.width, c.height)
    fonte = c
    l = c.width
    a = c.height
  }
  const c = document.createElement('canvas')
  c.width = alvoL
  c.height = alvoA
  const ctx = c.getContext('2d')!
  if (saida === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, alvoL, alvoA)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fonte, 0, 0, alvoL, alvoA)
  return { dados: c.toDataURL(saida, 0.93), largura: alvoL, altura: alvoA }
}

const tamanho = (s: string | null) => {
  if (!s) return ''
  const b = (s.length * 3) / 4
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`
}

/**
 * Papel de parede do login (3/4 esquerdo da tela) e logo do cliente.
 * Fica só neste computador (pasta do programa): não vai para a nuvem.
 * Cada computador tem a sua.
 */
export function Pagina_Aparencia({ visivel }: { visivel: boolean }) {
  const { empresaAtual, aparencia, recarregarAparencia } = useSessao()
  const adm = useAdmin()
  const avisar = useAviso()
  const [fundo, setFundo] = useState<string | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [ajuste, setAjuste] = useState<Ajuste>('preencher')
  const [resolucao, setResolucao] = useState<{ largura: number; altura: number } | null>(null)
  const [mudou, setMudou] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const inFundo = useRef<HTMLInputElement>(null)
  const inLogo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!visivel || mudou) return
    setFundo(aparencia?.fundo ?? null)
    setLogo(aparencia?.logo ?? null)
    setAjuste(aparencia?.ajuste ?? 'preencher')
  }, [visivel, aparencia]) // eslint-disable-line react-hooks/exhaustive-deps

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>, qual: 'fundo' | 'logo') => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      if (qual === 'fundo') {
        // até 4K fica o arquivo original; maior que isso, reduz para 3840 px com qualidade alta
        const r = await preparar(f, 3840, 12 * 1048576, 'image/jpeg')
        setFundo(r.dados)
        setResolucao({ largura: r.largura, altura: r.altura })
      } else {
        setLogo((await preparar(f, 1000, 3 * 1048576, 'image/png')).dados)
      }
      setMudou(true)
    } catch (err) {
      avisar((err as Error).message, 'erro')
    }
  }

  const salvar = async () => {
    setSalvando(true)
    try {
      await window.api.aparencia.salvar(
        fundo || logo ? { empresaId: empresaAtual?.id ?? '', empresaNome: empresaAtual?.nome ?? '', fundo, logo, ajuste, atualizadoEm: new Date().toISOString() } : null
      )
      void adm.registrar({ acao: 'alterou', entidade: 'aparência', descricao: `Alterou a aparência deste computador: ${fundo ? 'papel de parede próprio' : 'papel de parede padrão'}, ${logo ? 'logo própria' : 'logo padrão'}` })
      setMudou(false)
      await recarregarAparencia()
      avisar('Aparência salva neste computador.', 'ok')
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const desfazer = () => {
    setMudou(false)
    setFundo(aparencia?.fundo ?? null)
    setLogo(aparencia?.logo ?? null)
    setAjuste(aparencia?.ajuste ?? 'preencher')
    setResolucao(null)
  }

  // mostra a resolução também do fundo já salvo
  useEffect(() => {
    if (!fundo) return setResolucao(null)
    let vivo = true
    abrirImagem(fundo).then((i) => vivo && setResolucao({ largura: i.naturalWidth, altura: i.naturalHeight })).catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [fundo])
  const tela = { largura: Math.round(window.screen.width * window.devicePixelRatio * 0.75), altura: Math.round(window.screen.height * window.devicePixelRatio) }
  const pequena = !!resolucao && (resolucao.largura < tela.largura * 0.8 || resolucao.altura < tela.altura * 0.8)

  if (!visivel) return null

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Aparência</h1>
          <p className="fraco">Papel de parede e logo da tela de login deste computador. Ficam salvos só aqui (não vão para a nuvem) e a logo também aparece na barra superior.</p>
        </div>
        <div className="acoes">
          {mudou && <button className="botao" onClick={desfazer} disabled={salvando}>Desfazer</button>}
          <button className="botao primario" onClick={() => void salvar()} disabled={!mudou || salvando }>{salvando ? <span className="spinner" /> : null} Salvar aparência</button>
        </div>
      </div>

      <div className="grade-aparencia">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="caixa bloco">
            <h2>Papel de parede</h2>
            <p className="fraco mini">
              Ocupa 3/4 da tela, à esquerda do login, e acompanha o tamanho da janela sem esticar. Imagens até 4K (3840 px) ficam
              com o arquivo original; maiores são reduzidas para 4K com qualidade alta. Para esta tela, o ideal é ao menos {tela.largura}×{tela.altura}.
            </p>
            <div className="ajuste-fundo" role="radiogroup" aria-label="Ajuste do papel de parede">
              <label className={ajuste === 'preencher' ? 'marcado' : ''}>
                <input type="radio" name="ajuste" checked={ajuste === 'preencher'} onChange={() => { setAjuste('preencher'); setMudou(true) }} />
                <strong>Preencher</strong><small>Cobre toda a área; recorta só as sobras das bordas</small>
              </label>
              <label className={ajuste === 'inteira' ? 'marcado' : ''}>
                <input type="radio" name="ajuste" checked={ajuste === 'inteira'} onChange={() => { setAjuste('inteira'); setMudou(true) }} />
                <strong>Imagem inteira</strong><small>Mostra a imagem toda; as sobras ficam com a própria imagem desfocada</small>
              </label>
            </div>
            {pequena && <Alerta tipo="aviso">Imagem de {resolucao!.largura}×{resolucao!.altura}: menor que a área desta tela, pode perder nitidez. Prefira ao menos {tela.largura}×{tela.altura}.</Alerta>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="botao" onClick={() => inFundo.current?.click()}><Icone nome="imagem" /> Importar imagem</button>
              {fundo && <button className="botao leve" onClick={() => { setFundo(null); setMudou(true) }}>Usar o padrão</button>}
              <span className="fraco mini" style={{ marginLeft: 'auto' }}>{resolucao && fundo ? `${resolucao.largura}×${resolucao.altura} · ` : ''}{tamanho(fundo)}</span>
            </div>
            <input ref={inFundo} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden onChange={(e) => void escolher(e, 'fundo')} />
          </section>

          <section className="caixa bloco">
            <h2>Logo do cliente</h2>
            <p className="fraco mini">PNG com fundo transparente fica melhor. Até 1000 px fica o arquivo original.</p>
            <div className="miniatura logo" style={{ backgroundImage: `url(${logo || logoPadrao})` }}>{!logo && <span>padrão do programa</span>}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="botao" onClick={() => inLogo.current?.click()}><Icone nome="imagem" /> Importar logo</button>
              {logo && <button className="botao leve" onClick={() => { setLogo(null); setMudou(true) }}>Usar o padrão</button>}
              <span className="fraco mini" style={{ marginLeft: 'auto' }}>{tamanho(logo)}</span>
            </div>
            <input ref={inLogo} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => void escolher(e, 'logo')} />
          </section>
        </div>

        <section className="caixa bloco">
          <h2>Prévia da tela de login</h2>
          <p className="fraco mini">Mesma proporção desta tela. A imagem acompanha qualquer tamanho de janela.</p>
          <div className="previa-login">
            <FundoLogin src={fundo} ajuste={ajuste} className="previa-fundo" />
            <div className="previa-form">
              <img src={logo || logoPadrao} alt="" />
              <strong style={{ fontSize: 13 }}>Gerar Pré-Venda</strong>
              <div className="ficticio" />
              <div className="ficticio" />
              <div className="ficticio botao-f" />
            </div>
          </div>
          {mudou && <Alerta tipo="aviso">Alterações ainda não salvas.</Alerta>}
        </section>
      </div>
    </div>
  )
}
