import { useEffect, useMemo, useState } from 'react'
import { formatarCnpj, moeda, numeroBR } from '@shared/numeros'
import { dataBR, hojeLocal, nomeCiclo, plural, situacaoLicenca, somarDias, somarMeses, type SituacaoLicenca } from '@shared/licenca'
import type { ConfigCobranca, EmpresaCobranca, PagamentoLicenca } from '../servicos/nuvem'
import { useAdmin } from '../admin'
import { useAviso, useSessao } from '../contexto'
import { Icone } from '../componentes/Icone'
import { Alerta, Modal } from '../componentes/Modal'

const CICLOS = [1, 2, 3, 6, 12]
const FORMAS = ['PIX', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão']
type Filtro = 'todas' | 'vencendo' | 'atrasadas' | 'em_dia' | 'sem_cobranca'
type Linha = EmpresaCobranca & { sit: SituacaoLicenca }

const ORDEM: Record<SituacaoLicenca['estado'], number> = { bloqueada: 0, atrasada: 1, vencendo: 2, em_dia: 3, sem_cobranca: 4 }
const valorTexto = (n: number) => n.toFixed(2).replace('.', ',')

/** Etiqueta da situação, em palavras de quem cobra. */
export function EtiquetaLicenca({ sit }: { sit: SituacaoLicenca }) {
  const atraso = -sit.dias
  switch (sit.estado) {
    case 'sem_cobranca': return <span className="etiqueta neutra">Sem cobrança</span>
    case 'em_dia': return <span className="etiqueta ok">Em dia</span>
    case 'vencendo': return <span className="etiqueta aviso">{sit.dias === 0 ? 'Vence hoje' : `Vence em ${plural(sit.dias, 'dia', 'dias')}`}</span>
    case 'atrasada': return <span className="etiqueta st">Atrasada há {plural(atraso, 'dia', 'dias')}</span>
    case 'bloqueada': return <span className="etiqueta erro">Bloqueada ({plural(atraso, 'dia', 'dias')} de atraso)</span>
  }
}

export function Pagina_Cobranca({ visivel }: { visivel: boolean }) {
  const adm = useAdmin()
  const nuvem = adm.nuvem
  const { internet: net } = useSessao()
  const internet = net && !!nuvem
  const avisar = useAviso()
  const [lista, setLista] = useState<EmpresaCobranca[]>([])
  const [config, setConfig] = useState<ConfigCobranca>({ dias_aviso: 5, dias_tolerancia: 3, contato: '' })
  const [carregando, setCarregando] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [baixa, setBaixa] = useState<{ e: Linha; pagoEm: string; valor: string; forma: string; obs: string } | null>(null)
  const [editando, setEditando] = useState<{ e: Linha; valor: string; ciclo: number; vencimento: string; semCobranca: boolean; obs: string } | null>(null)
  const [pagamentos, setPagamentos] = useState<PagamentoLicenca[]>([])
  const [parametros, setParametros] = useState<ConfigCobranca | null>(null)
  const [salvando, setSalvando] = useState(false)

  const recarregar = async () => {
    if (!nuvem) return
    setCarregando(true)
    try {
      const [es, c] = await Promise.all([nuvem.empresasCobranca(), nuvem.configCobranca()])
      setLista(es)
      setConfig(c)
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setCarregando(false)
    }
  }
  useEffect(() => {
    if (visivel) void recarregar()
  }, [visivel]) // eslint-disable-line react-hooks/exhaustive-deps

  const hoje = hojeLocal()
  const linhas: Linha[] = useMemo(
    () => lista
      .map((e) => ({ ...e, sit: situacaoLicenca(e.licenca_vencimento, config.dias_aviso, config.dias_tolerancia, hoje) }))
      .sort((a, b) => ORDEM[a.sit.estado] - ORDEM[b.sit.estado] || (a.licenca_vencimento ?? '').localeCompare(b.licenca_vencimento ?? '') || a.nome.localeCompare(b.nome)),
    [lista, config, hoje]
  )
  const conta = (f: (l: Linha) => boolean) => linhas.filter(f)
  const atrasadas = conta((l) => l.sit.estado === 'atrasada' || l.sit.estado === 'bloqueada')
  const vencendo = conta((l) => l.sit.estado === 'vencendo')
  const emDia = conta((l) => l.sit.estado === 'em_dia')
  const semCobranca = conta((l) => l.sit.estado === 'sem_cobranca')
  const receitaMensal = linhas.filter((l) => l.sit.estado !== 'sem_cobranca').reduce((s, l) => s + l.licenca_valor / l.licenca_ciclo_meses, 0)
  const emAberto = atrasadas.reduce((s, l) => s + l.licenca_valor, 0)
  const visiveis = { todas: linhas, vencendo, atrasadas, em_dia: emDia, sem_cobranca: semCobranca }[filtro]

  // ---------------- ações
  const abrirBaixa = (e: Linha) => setBaixa({ e, pagoEm: hoje, valor: valorTexto(e.licenca_valor), forma: 'PIX', obs: '' })
  const darBaixa = async () => {
    if (!nuvem || !baixa) return
    setSalvando(true)
    try {
      const novo = await nuvem.registrarPagamento({ empresaId: baixa.e.id, pagoEm: baixa.pagoEm, valor: numeroBR(baixa.valor), forma: baixa.forma, obs: baixa.obs.trim() })
      void adm.registrar({ acao: 'registrou', entidade: 'pagamento', descricao: `Baixa da licença de ${baixa.e.nome}: ${moeda(numeroBR(baixa.valor))} (${baixa.forma}). Próximo vencimento ${dataBR(novo)}`, empresa_id: baixa.e.id })
      avisar(`Pagamento de ${baixa.e.nome} registrado. Próximo vencimento: ${dataBR(novo)}.`, 'ok')
      setBaixa(null)
      await recarregar()
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const abrirEdicao = async (e: Linha) => {
    setEditando({ e, valor: valorTexto(e.licenca_valor), ciclo: e.licenca_ciclo_meses, vencimento: e.licenca_vencimento ?? '', semCobranca: !e.licenca_vencimento, obs: e.licenca_obs })
    setPagamentos([])
    try {
      if (nuvem) setPagamentos(await nuvem.pagamentos(e.id))
    } catch (err) {
      avisar((err as Error).message, 'erro')
    }
  }
  const salvarEdicao = async () => {
    if (!nuvem || !editando) return
    setSalvando(true)
    try {
      const d = {
        licenca_valor: numeroBR(editando.valor),
        licenca_ciclo_meses: editando.ciclo,
        licenca_vencimento: editando.semCobranca ? null : editando.vencimento,
        licenca_obs: editando.obs.trim()
      }
      await nuvem.alterarLicenca(editando.e.id, d)
      void adm.registrar({ acao: 'alterou', entidade: 'licença', descricao: `Licença de ${editando.e.nome}: ${moeda(d.licenca_valor)} ${nomeCiclo(d.licenca_ciclo_meses).toLowerCase()}, ${d.licenca_vencimento ? `vencimento ${dataBR(d.licenca_vencimento)}` : 'sem cobrança'}`, empresa_id: editando.e.id })
      avisar(`Licença de ${editando.e.nome} salva.`, 'ok')
      setEditando(null)
      await recarregar()
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }
  const estornar = async (p: PagamentoLicenca) => {
    if (!nuvem || !editando) return
    if (!confirm(`Estornar o pagamento de ${dataBR(p.pago_em)} (${moeda(p.valor)})? O vencimento volta para ${p.vencimento_anterior ? dataBR(p.vencimento_anterior) : 'sem data'}.`)) return
    try {
      const volta = await nuvem.estornarPagamento(p.id)
      void adm.registrar({ acao: 'estornou', entidade: 'pagamento', descricao: `Estornou o pagamento de ${dataBR(p.pago_em)} de ${editando.e.nome} (${moeda(p.valor)})`, empresa_id: editando.e.id })
      avisar('Pagamento estornado.', 'ok')
      setEditando({ ...editando, vencimento: volta ?? '', semCobranca: !volta })
      setPagamentos(await nuvem.pagamentos(editando.e.id))
      await recarregar()
    } catch (e) {
      avisar((e as Error).message, 'erro')
    }
  }

  const salvarParametros = async () => {
    if (!nuvem || !parametros) return
    setSalvando(true)
    try {
      await nuvem.salvarConfigCobranca(parametros)
      void adm.registrar({ acao: 'alterou', entidade: 'cobrança', descricao: `Parâmetros da cobrança: avisar ${parametros.dias_aviso} dia(s) antes, bloquear após ${parametros.dias_tolerancia} dia(s) de atraso` })
      setConfig(parametros)
      setParametros(null)
      avisar('Parâmetros da cobrança salvos.', 'ok')
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  if (!visivel) return null
  const novoVenc = baixa ? somarMeses(baixa.e.licenca_vencimento ?? baixa.pagoEm, baixa.e.licenca_ciclo_meses) : ''
  const indicador = (f: Filtro, rotulo: string, valor: string, extra = '', tom = '') => (
    <button className={`indicador-cobranca ${tom} ${filtro === f ? 'ativo' : ''}`} onClick={() => setFiltro(filtro === f ? 'todas' : f)} aria-pressed={filtro === f}>
      <small>{rotulo}</small>
      <b>{valor}</b>
      {extra && <span>{extra}</span>}
    </button>
  )

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Cobrança</h1>
          <p className="fraco">
            Licença de cada empresa. O aviso aparece {plural(config.dias_aviso, 'dia', 'dias')} antes do vencimento e o acesso é bloqueado
            depois de {plural(config.dias_tolerancia, 'dia', 'dias')} de atraso.
          </p>
        </div>
        <div className="acoes">
          <button className="botao" onClick={() => void recarregar()} disabled={!internet || carregando}>{carregando ? <span className="spinner" /> : <Icone nome="atualizar" />} Atualizar</button>
          <button className="botao" onClick={() => setParametros({ ...config })} disabled={!internet}><Icone nome="ajustes" /> Parâmetros</button>
        </div>
      </div>
      {!internet && <div style={{ marginBottom: 14 }}><Alerta tipo="aviso">Sem internet: a cobrança volta quando a conexão voltar.</Alerta></div>}

      <div className="indicadores-cobranca">
        {indicador('atrasadas', 'Em atraso', String(atrasadas.length), atrasadas.length ? `${moeda(emAberto)} em aberto` : 'ninguém atrasado', atrasadas.length ? 'erro' : '')}
        {indicador('vencendo', `Vencem em até ${plural(config.dias_aviso, 'dia', 'dias')}`, String(vencendo.length), vencendo.length ? moeda(vencendo.reduce((s, l) => s + l.licenca_valor, 0)) : '', vencendo.length ? 'aviso' : '')}
        {indicador('em_dia', 'Em dia', String(emDia.length))}
        {indicador('sem_cobranca', 'Sem cobrança', String(semCobranca.length))}
        <div className="indicador-cobranca receita">
          <small>Receita mensal prevista</small>
          <b>{moeda(receitaMensal)}</b>
          <span>planos trimestrais e anuais divididos por mês</span>
        </div>
      </div>

      <div className="caixa" style={{ overflow: 'auto' }}>
        <table className="tabela tabela-cobranca">
          <thead>
            <tr><th>Empresa</th><th className="num">Valor</th><th>Ciclo</th><th>Vencimento</th><th>Situação</th><th>Último pagamento</th><th></th></tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.id} className={`cob-${l.sit.estado}`}>
                <td>
                  <b>{l.nome}</b>
                  <div className="mini fraco">{l.cnpj ? formatarCnpj(l.cnpj) : 'sem CNPJ'}{l.licenca_obs ? ` · ${l.licenca_obs}` : ''}</div>
                </td>
                <td className="num">{l.sit.estado === 'sem_cobranca' && !l.licenca_valor ? <span className="fraco">—</span> : moeda(l.licenca_valor)}</td>
                <td>{nomeCiclo(l.licenca_ciclo_meses)}</td>
                <td>{l.licenca_vencimento ? dataBR(l.licenca_vencimento) : <span className="fraco">não vence</span>}</td>
                <td>
                  <EtiquetaLicenca sit={l.sit} />
                  {!l.ativa && <span className="etiqueta erro">Bloqueada manualmente</span>}
                  {l.sit.estado === 'atrasada' && <div className="mini fraco">bloqueia a partir de {dataBR(somarDiasUm(l.sit.limite))}</div>}
                </td>
                <td>{l.ultimo_pagamento ? dataBR(l.ultimo_pagamento) : <span className="fraco">nenhum</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="botao leve" onClick={() => void abrirEdicao(l)} disabled={!internet}>Editar</button>
                  <button className="botao" onClick={() => abrirBaixa(l)} disabled={!internet || (l.sit.estado === 'sem_cobranca' && !l.licenca_valor)}>Dar baixa</button>
                </td>
              </tr>
            ))}
            {visiveis.length === 0 && (
              <tr><td colSpan={7} style={{ height: 80, textAlign: 'center' }} className="fraco">
                {linhas.length === 0 ? 'Nenhuma empresa cadastrada ainda.' : 'Nenhuma empresa nesta situação.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- dar baixa ---------- */}
      <Modal aberto={!!baixa} aoFechar={() => setBaixa(null)} rotulo="Dar baixa no pagamento"
        botoes={<>
          <button className="botao" onClick={() => setBaixa(null)}>Cancelar</button>
          <button className="botao primario" onClick={() => void darBaixa()} disabled={salvando || !baixa?.pagoEm}>{salvando ? <span className="spinner" /> : <Icone nome="ok" />} Dar baixa</button>
        </>}>
        {baixa && (
          <>
            <h2>Dar baixa: {baixa.e.nome}</h2>
            <div className="avanco-vencimento">
              <div><small>Vencimento atual</small><b>{baixa.e.licenca_vencimento ? dataBR(baixa.e.licenca_vencimento) : 'sem data'}</b></div>
              <span aria-hidden="true">→</span>
              <div><small>Próximo vencimento</small><b>{dataBR(novoVenc)}</b></div>
            </div>
            <div className="grade-form">
              <label className="campo c6"><span>Data do pagamento</span><input className="entrada" type="date" value={baixa.pagoEm} max={hoje} onChange={(e) => setBaixa({ ...baixa, pagoEm: e.target.value })} /></label>
              <label className="campo c6"><span>Valor recebido (R$)</span><input className="entrada" inputMode="decimal" value={baixa.valor} onChange={(e) => setBaixa({ ...baixa, valor: e.target.value })} /></label>
              <label className="campo c6"><span>Forma</span>
                <select className="entrada" value={baixa.forma} onChange={(e) => setBaixa({ ...baixa, forma: e.target.value })}>{FORMAS.map((f) => <option key={f}>{f}</option>)}</select>
              </label>
              <label className="campo c6"><span>Observação</span><input className="entrada" value={baixa.obs} onChange={(e) => setBaixa({ ...baixa, obs: e.target.value })} placeholder="opcional" /></label>
            </div>
            {(baixa.e.sit.estado === 'bloqueada' || baixa.e.sit.estado === 'atrasada') && novoVenc < hoje && (
              <Alerta tipo="aviso">Mesmo com esta baixa o vencimento continua no passado ({dataBR(novoVenc)}): há mais de um ciclo em aberto. Dê baixa de novo para cada ciclo pago.</Alerta>
            )}
            <p className="mini fraco">O vencimento avança {plural(baixa.e.licenca_ciclo_meses, 'mês', 'meses')} a partir do vencimento atual, mantendo o dia. Se a empresa estava bloqueada, o acesso volta na hora.</p>
          </>
        )}
      </Modal>

      {/* ---------- editar licença ---------- */}
      <Modal aberto={!!editando} aoFechar={() => setEditando(null)} largo rotulo="Licença da empresa"
        botoes={<>
          <button className="botao" onClick={() => setEditando(null)}>Cancelar</button>
          <button className="botao primario" onClick={() => void salvarEdicao()} disabled={salvando || (!editando?.semCobranca && !editando?.vencimento)}>{salvando ? <span className="spinner" /> : null} Salvar</button>
        </>}>
        {editando && (
          <>
            <h2>Licença: {editando.e.nome}</h2>
            <div className="grade-form">
              <label className="campo c4"><span>Valor (R$)</span><input className="entrada" inputMode="decimal" value={editando.valor} onChange={(e) => setEditando({ ...editando, valor: e.target.value })} /></label>
              <label className="campo c4"><span>Ciclo</span>
                <select className="entrada" value={editando.ciclo} onChange={(e) => setEditando({ ...editando, ciclo: Number(e.target.value) })}>
                  {CICLOS.map((c) => <option key={c} value={c}>{nomeCiclo(c)}</option>)}
                </select>
              </label>
              <label className="campo c4"><span>Vencimento</span>
                <input className="entrada" type="date" value={editando.vencimento} disabled={editando.semCobranca} onChange={(e) => setEditando({ ...editando, vencimento: e.target.value })} />
              </label>
              <label className="check c12"><input type="checkbox" checked={editando.semCobranca} onChange={(e) => setEditando({ ...editando, semCobranca: e.target.checked, vencimento: e.target.checked ? '' : editando.vencimento || hoje })} /> Sem cobrança (cortesia ou período de teste: nunca bloqueia)</label>
              <label className="campo c12"><span>Observação</span><input className="entrada" value={editando.obs} onChange={(e) => setEditando({ ...editando, obs: e.target.value })} placeholder="ex.: paga por PIX todo dia 10" /></label>
            </div>
            <div>
              <h3 style={{ marginBottom: 8 }}>Pagamentos</h3>
              {pagamentos.length === 0 ? <p className="fraco mini">Nenhum pagamento registrado.</p> : (
                <table className="tabela tabela-compacta">
                  <thead><tr><th>Pago em</th><th className="num">Valor</th><th>Forma</th><th>Vencimento</th><th>Observação</th><th></th></tr></thead>
                  <tbody>
                    {pagamentos.map((p, i) => (
                      <tr key={p.id}>
                        <td>{dataBR(p.pago_em)}</td>
                        <td className="num">{moeda(p.valor)}</td>
                        <td>{p.forma}</td>
                        <td>{p.vencimento_anterior ? dataBR(p.vencimento_anterior) : 'sem data'} → {dataBR(p.vencimento_novo)}</td>
                        <td className="fraco">{p.obs}</td>
                        <td style={{ textAlign: 'right' }}>{i === 0 && <button className="botao leve perigo" onClick={() => void estornar(p)}>Estornar</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* ---------- parâmetros ---------- */}
      <Modal aberto={!!parametros} aoFechar={() => setParametros(null)} rotulo="Parâmetros da cobrança"
        botoes={<>
          <button className="botao" onClick={() => setParametros(null)}>Cancelar</button>
          <button className="botao primario" onClick={() => void salvarParametros()} disabled={salvando}>{salvando ? <span className="spinner" /> : null} Salvar</button>
        </>}>
        {parametros && (
          <>
            <h2>Parâmetros da cobrança</h2>
            <p className="fraco mini">Valem para todas as empresas.</p>
            <div className="grade-form">
              <label className="campo c6"><span>Avisar quantos dias antes</span>
                <input className="entrada" type="number" min={0} max={60} value={parametros.dias_aviso} onChange={(e) => setParametros({ ...parametros, dias_aviso: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
                <small>Os usuários veem o aviso a partir desse dia.</small>
              </label>
              <label className="campo c6"><span>Bloquear depois de quantos dias de atraso</span>
                <input className="entrada" type="number" min={0} max={60} value={parametros.dias_tolerancia} onChange={(e) => setParametros({ ...parametros, dias_tolerancia: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
                <small>0 bloqueia no dia seguinte ao vencimento.</small>
              </label>
              <label className="campo c12"><span>Contato do suporte</span>
                <input className="entrada" value={parametros.contato} onChange={(e) => setParametros({ ...parametros, contato: e.target.value })} placeholder="ex.: WhatsApp (92) 99999-0000" />
                <small>Aparece nos avisos de vencimento e na mensagem de bloqueio.</small>
              </label>
            </div>
            <div className="exemplo-aviso">
              <small>Exemplo, vencimento em 20/10:</small>
              <p>Aviso a partir de {dataBR(somarDias('2026-10-20', -parametros.dias_aviso))}. Bloqueio a partir de {dataBR(somarDias('2026-10-20', parametros.dias_tolerancia + 1))}.</p>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

const somarDiasUm = (d: string | null) => (d ? somarDias(d, 1) : '')
