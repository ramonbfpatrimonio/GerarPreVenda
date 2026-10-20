import { useEffect, useState } from 'react'
import { formatarCnpj, moeda, soDigitos } from '@shared/numeros'
import { type Empresa } from '../servicos'
import { useAdmin } from '../admin'
import { useAviso, useSessao } from '../contexto'
import { Icone } from '../componentes/Icone'
import { Alerta, Modal } from '../componentes/Modal'

const vazio = { nome: '', cnpj: '', admin_nome: '', admin_email: '', admin_senha: '', retencao_meses: 1 }
// Por quanto tempo o histórico fica guardado na nuvem (padrão: 1 mês)
const PRAZOS = [1, 2, 3, 6, 12, 24, 36, 60, 120]
const nomePrazo = (m: number) => (m === 1 ? '1 mês' : `${m} meses`)

export function Pagina_Empresas({ visivel, irParaPedido }: { visivel: boolean; irParaPedido: () => void }) {
  const { recarregarEmpresas: recarregarSessao, escolherEmpresa, empresaAtual, internet: net, ehSuper: sessaoSuper } = useSessao()
  const adm = useAdmin()
  const nuvem = adm.nuvem
  const internet = net && !!nuvem
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const recarregarEmpresas = async () => {
    if (!nuvem) return
    try {
      setEmpresas(await nuvem.empresas())
      if (sessaoSuper) void recarregarSessao()
    } catch (e) {
      avisar((e as Error).message, 'erro')
    }
  }
  const avisar = useAviso()
  const [nova, setNova] = useState(false)
  const [dados, setDados] = useState(vazio)
  const [salvando, setSalvando] = useState(false)
  const [editando, setEditando] = useState<Empresa | null>(null)

  useEffect(() => {
    if (visivel) void recarregarEmpresas()
  }, [visivel]) // eslint-disable-line react-hooks/exhaustive-deps

  const criar = async () => {
    if (!nuvem) return
    setSalvando(true)
    try {
      const { retencao_meses, ...resto } = dados
      const id = await nuvem.criarEmpresa(resto)
      await nuvem.alterarEmpresa(id, { retencao_meses })
      void adm.registrar({ acao: 'criou', entidade: 'empresa', descricao: `Criou a empresa ${dados.nome} com o administrador ${dados.admin_email}` })
      avisar(`Empresa ${dados.nome} criada. O administrador já pode entrar com ${dados.admin_email}.`, 'ok')
      setNova(false)
      setDados(vazio)
      await recarregarEmpresas()
      if (sessaoSuper) escolherEmpresa(id)
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const alterar = async (e: Empresa, d: Partial<Empresa>) => {
    if (!nuvem) return
    try {
      await nuvem.alterarEmpresa(e.id, d)
      await recarregarEmpresas()
      if (d.ativa === false) avisar(`${e.nome} bloqueada: os usuários dela não entram mais.`, 'ok')
      if (d.ativa === true) avisar(`${e.nome} liberada.`, 'ok')
    } catch (err) {
      avisar((err as Error).message, 'erro')
    }
  }

  const salvarEdicao = async () => {
    if (!editando) return
    await alterar(editando, { nome: editando.nome.trim(), cnpj: soDigitos(editando.cnpj), retencao_meses: editando.retencao_meses })
    setEditando(null)
  }

  if (!visivel) return null
  const totalMes = empresas.reduce((s, e) => s + (e.prevendas_mes ?? 0), 0)

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Empresas</h1>
          <p className="fraco">Cada empresa só enxerga os próprios usuários, conexões e histórico. {empresas.length} empresa(s), {totalMes} pré-venda(s) neste mês.</p>
        </div>
        <div className="acoes">
          <button className="botao" onClick={() => void recarregarEmpresas()} disabled={!internet}><Icone nome="atualizar" /> Atualizar</button>
          <button className="botao primario" onClick={() => setNova(true)} disabled={!internet}><Icone nome="mais" /> Nova empresa</button>
        </div>
      </div>
      {!internet && <div style={{ marginBottom: 14 }}><Alerta tipo="aviso">Sem internet: a gestão de empresas volta quando a conexão voltar.</Alerta></div>}

      <div className="caixa" style={{ overflow: 'auto' }}>
        <table className="tabela">
          <thead>
            <tr>
              <th>Empresa</th><th>CNPJ</th><th className="num">Usuários</th><th className="num">Pré-vendas no mês</th>
              <th className="num">Total no mês</th><th>Último uso</th><th>Histórico guardado</th><th>Situação</th><th></th>
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id}>
                <td style={{ fontWeight: 600 }}>{e.nome} {e.id === empresaAtual?.id && <span className="etiqueta ok">em uso</span>}</td>
                <td>{e.cnpj ? formatarCnpj(e.cnpj) : ''}</td>
                <td className="num">{e.usuarios}</td>
                <td className="num">{e.prevendas_mes}</td>
                <td className="num">{moeda(e.total_mes ?? 0)}</td>
                <td>{e.ultima_atividade ? new Date(e.ultima_atividade).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : <span className="fraco">nunca</span>}</td>
                <td>{nomePrazo(e.retencao_meses)}</td>
                <td>{e.ativa ? <span className="etiqueta ok">Ativa</span> : <span className="etiqueta erro">Bloqueada</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  {sessaoSuper && <button className="botao leve" onClick={() => { escolherEmpresa(e.id); irParaPedido() }}>Trabalhar nesta</button>}
                  <button className="botao leve" onClick={() => setEditando({ ...e })}>Editar</button>
                  <button className={`botao leve ${e.ativa ? 'perigo' : ''}`}
                    onClick={() => (e.ativa ? confirm(`Bloquear ${e.nome}? Os usuários dela não conseguirão entrar nem gerar pré-vendas.`) : true) && void alterar(e, { ativa: !e.ativa })}>
                    {e.ativa ? 'Bloquear' : 'Liberar'}
                  </button>
                </td>
              </tr>
            ))}
            {empresas.length === 0 && (
              <tr><td colSpan={9} style={{ height: 80, textAlign: 'center' }} className="fraco">Nenhuma empresa ainda. Crie a primeira com o botão Nova empresa.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal aberto={nova} aoFechar={() => setNova(false)} rotulo="Nova empresa"
        botoes={<>
          <button className="botao" onClick={() => setNova(false)}>Cancelar</button>
          <button className="botao primario" onClick={() => void criar()}
            disabled={salvando || !dados.nome.trim() || !dados.admin_email || dados.admin_senha.length < 6}>
            {salvando ? <span className="spinner" /> : null} Criar empresa
          </button>
        </>}>
        <h2>Nova empresa</h2>
        <div className="grade-form">
          <label className="campo c8"><span>Nome</span><input className="entrada" value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} autoFocus /></label>
          <label className="campo c4"><span>CNPJ</span><input className="entrada" value={dados.cnpj} onChange={(e) => setDados({ ...dados, cnpj: e.target.value })} placeholder="opcional" /></label>
          <label className="campo c6"><span>Guardar o histórico por</span>
            <select className="entrada" value={dados.retencao_meses} onChange={(e) => setDados({ ...dados, retencao_meses: Number(e.target.value) })}>
              {PRAZOS.map((m) => <option key={m} value={m}>{nomePrazo(m)}</option>)}
            </select>
            <small>Depois disso o registro sai da nuvem (a pré-venda continua no ERP).</small>
          </label>
        </div>
        <h3 style={{ marginTop: 6 }}>Administrador da empresa</h3>
        <p className="fraco mini">Ele entra no programa, cadastra as conexões e cria os operadores da empresa.</p>
        <div className="grade-form">
          <label className="campo c12"><span>Nome</span><input className="entrada" value={dados.admin_nome} onChange={(e) => setDados({ ...dados, admin_nome: e.target.value })} /></label>
          <label className="campo c6"><span>E-mail</span><input className="entrada" type="email" value={dados.admin_email} onChange={(e) => setDados({ ...dados, admin_email: e.target.value })} /></label>
          <label className="campo c6"><span>Senha inicial</span><input className="entrada" type="password" value={dados.admin_senha} onChange={(e) => setDados({ ...dados, admin_senha: e.target.value })} /><small>Mínimo de 6 caracteres</small></label>
        </div>
      </Modal>

      <Modal aberto={!!editando} aoFechar={() => setEditando(null)} rotulo="Editar empresa"
        botoes={<><button className="botao" onClick={() => setEditando(null)}>Cancelar</button><button className="botao primario" onClick={() => void salvarEdicao()} disabled={!editando?.nome.trim()}>Salvar</button></>}>
        {editando && (
          <>
            <h2>Editar {editando.nome}</h2>
            <div className="grade-form">
              <label className="campo c8"><span>Nome</span><input className="entrada" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} /></label>
              <label className="campo c4"><span>CNPJ</span><input className="entrada" value={editando.cnpj} onChange={(e) => setEditando({ ...editando, cnpj: e.target.value })} /></label>
              <label className="campo c6"><span>Guardar o histórico por</span>
                <select className="entrada" value={editando.retencao_meses} onChange={(e) => setEditando({ ...editando, retencao_meses: Number(e.target.value) })}>
                  {PRAZOS.map((m) => <option key={m} value={m}>{nomePrazo(m)}</option>)}
                </select>
                <small>Depois disso o registro sai da nuvem (a pré-venda continua no ERP).</small>
              </label>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
