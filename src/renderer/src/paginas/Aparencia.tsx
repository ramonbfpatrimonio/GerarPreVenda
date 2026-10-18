import { useEffect, useRef, useState } from 'react'
import { useAviso, useSessao } from '../contexto'
import { useAdmin } from '../admin'
import { Icone } from '../componentes/Icone'
import { Alerta } from '../componentes/Modal'
import fundoPadrao from '../assets/fundo-padrao.jpg'
import logoPadrao from '../assets/logo.png'

/** Lê a imagem e reduz para caber no limite, devolvendo data URL. */
async function reduzir(arquivo: File, maxLado: number, tipo: 'image/jpeg' | 'image/png', qualidade = 0.82): Promise<string> {
  const url = URL.createObjectURL(arquivo)
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => falha(new Error('Não foi possível abrir esta imagem.'))
      i.src = url
    })
    const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * escala))
    c.height = Math.max(1, Math.round(img.naturalHeight * escala))
    const ctx = c.getContext('2d')!
    if (tipo === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, c.width, c.height)
    let q = qualidade
    let dados = c.toDataURL(tipo, q)
    // garante o limite guardado na nuvem (fundo ≤ 4 MB, logo ≤ 1 MB em texto)
    const limite = tipo === 'image/jpeg' ? 3_800_000 : 950_000
    while (dados.length > limite && tipo === 'image/jpeg' && q > 0.4) {
      q -= 0.1
      dados = c.toDataURL(tipo, q)
    }
    if (dados.length > limite) throw new Error('Imagem grande demais mesmo depois de reduzida. Use uma imagem menor.')
    return dados
  } finally {
    URL.revokeObjectURL(url)
  }
}

const kb = (s: string | null) => (s ? `${Math.round((s.length * 3) / 4 / 1024)} KB` : '')

/**
 * Papel de parede do login (3/4 esquerdo da tela) e logo do cliente.
 * Fica guardado na empresa (nuvem) e copiado em cada computador para
 * aparecer na tela de login mesmo antes de entrar ou sem internet.
 */
export function Pagina_Aparencia({ visivel }: { visivel: boolean }) {
  const { empresaAtual, internet, aparencia, recarregarAparencia } = useSessao()
  const adm = useAdmin()
  const avisar = useAviso()
  const [fundo, setFundo] = useState<string | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [mudou, setMudou] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const inFundo = useRef<HTMLInputElement>(null)
  const inLogo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!visivel || mudou) return
    const daEmpresa = aparencia && aparencia.empresaId === empresaAtual?.id ? aparencia : null
    setFundo(daEmpresa?.fundo ?? null)
    setLogo(daEmpresa?.logo ?? null)
  }, [visivel, aparencia, empresaAtual?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>, qual: 'fundo' | 'logo') => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      if (qual === 'fundo') setFundo(await reduzir(f, 1920, 'image/jpeg'))
      else setLogo(await reduzir(f, 400, 'image/png'))
      setMudou(true)
    } catch (err) {
      avisar((err as Error).message, 'erro')
    }
  }

  const salvar = async () => {
    if (!adm.nuvem || !empresaAtual) return
    setSalvando(true)
    try {
      await adm.nuvem.salvarAparencia(empresaAtual.id, { fundo, logo })
      await window.api.aparencia.salvar({ empresaId: empresaAtual.id, empresaNome: empresaAtual.nome, fundo, logo, atualizadoEm: new Date().toISOString() })
      setMudou(false)
      await recarregarAparencia()
      avisar('Aparência salva. Os outros computadores da empresa recebem ao entrar.', 'ok')
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const desfazer = () => {
    setMudou(false)
    const daEmpresa = aparencia && aparencia.empresaId === empresaAtual?.id ? aparencia : null
    setFundo(daEmpresa?.fundo ?? null)
    setLogo(daEmpresa?.logo ?? null)
  }

  if (!visivel) return null
  const podeSalvar = internet && !!adm.nuvem && !!empresaAtual

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Aparência</h1>
          <p className="fraco">Papel de parede e logo da tela de login de {empresaAtual?.nome ?? 'empresa'}. A logo também aparece na barra superior.</p>
        </div>
        <div className="acoes">
          {mudou && <button className="botao" onClick={desfazer} disabled={salvando}>Desfazer</button>}
          <button className="botao primario" onClick={() => void salvar()} disabled={!mudou || salvando || !podeSalvar}>{salvando ? <span className="spinner" /> : null} Salvar aparência</button>
        </div>
      </div>
      {!podeSalvar && <div style={{ marginBottom: 14 }}><Alerta tipo="aviso">Sem internet: a aparência é guardada na empresa e precisa de conexão para salvar.</Alerta></div>}

      <div className="grade-aparencia">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="caixa bloco">
            <h2>Papel de parede</h2>
            <p className="fraco mini">Ocupa 3/4 da tela, à esquerda do login. Use uma imagem horizontal (ideal 1920×1080). É reduzida automaticamente.</p>
            <div className="miniatura" style={{ backgroundImage: `url(${fundo || fundoPadrao})`, aspectRatio: '16 / 9' }}>{!fundo && <span>padrão do programa</span>}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="botao" onClick={() => inFundo.current?.click()}><Icone nome="imagem" /> Importar imagem</button>
              {fundo && <button className="botao leve" onClick={() => { setFundo(null); setMudou(true) }}>Usar o padrão</button>}
              <span className="fraco mini" style={{ marginLeft: 'auto' }}>{kb(fundo)}</span>
            </div>
            <input ref={inFundo} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden onChange={(e) => void escolher(e, 'fundo')} />
          </section>

          <section className="caixa bloco">
            <h2>Logo do cliente</h2>
            <p className="fraco mini">PNG com fundo transparente fica melhor. É reduzida para até 400 px.</p>
            <div className="miniatura logo" style={{ backgroundImage: `url(${logo || logoPadrao})` }}>{!logo && <span>padrão do programa</span>}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="botao" onClick={() => inLogo.current?.click()}><Icone nome="imagem" /> Importar logo</button>
              {logo && <button className="botao leve" onClick={() => { setLogo(null); setMudou(true) }}>Usar o padrão</button>}
              <span className="fraco mini" style={{ marginLeft: 'auto' }}>{kb(logo)}</span>
            </div>
            <input ref={inLogo} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => void escolher(e, 'logo')} />
          </section>
        </div>

        <section className="caixa bloco">
          <h2>Prévia da tela de login</h2>
          <div className="previa-login">
            <div className="previa-fundo" style={{ backgroundImage: `url(${fundo || fundoPadrao})` }} />
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
