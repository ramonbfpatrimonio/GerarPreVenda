import { useEffect, useState } from 'react'
import { REGRAS_PADRAO, type DadosConexaoNuvem, type PerfilConexao, type ResultadoTeste } from '@shared/tipos'
import { formatarCnpj, soDigitos } from '@shared/numeros'
import { useAviso, useConexoes, useSessao } from '../contexto'
import { useAdmin } from '../admin'
import { Icone } from '../componentes/Icone'
import { Alerta, Modal } from '../componentes/Modal'

const CORES = ['#1f5f9e', '#0e7c5a', '#7a3fb5', '#b4461b', '#a3122a', '#8a6100', '#0f6470', '#3d4a5c', '#b0306a', '#4b6b12']

const vazio = (empresaId = ''): PerfilConexao => ({
  id: '', empresaId, cliente: '', nome: '', cor: CORES[0], servidor: '', instancia: '', porta: null, autenticacao: 'sql',
  usuario: 'sa', temSenha: false, banco: '', driver: 'auto', criptografar: false, cnpjsEmpresa: [], ativo: true,
  regras: { ...REGRAS_PADRAO }, atualizadoEm: ''
})

export function Pagina_Conexoes() {
  const { perfis, locais, recarregar, ativa, selecionar, sincronizadoComNuvem } = useConexoes()
  const { empresaAtual, internet } = useSessao()
  const adm = useAdmin()
  const nuvem = adm.nuvem
  const admin = !!nuvem // sem internet: só a senha deste computador
  const avisar = useAviso()

  const [form, setForm] = useState<PerfilConexao>(perfis[0] ?? vazio(empresaAtual?.id))
  const [senha, setSenha] = useState('')
  const [teste, setTeste] = useState<ResultadoTeste | null>(null)
  const [testando, setTestando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [arquivo, setArquivo] = useState<'exportar' | 'importar' | null>(null)
  const [senhaArquivo, setSenhaArquivo] = useState('')
  const [nativo, setNativo] = useState(true)
  const [cnpjNovo, setCnpjNovo] = useState('')

  useEffect(() => {
    window.api.conexoes.nativoDisponivel().then(setNativo).catch(() => setNativo(false))
  }, [])
  useEffect(() => {
    if (!form.id && perfis.length && !form.cliente) setForm(perfis[0])
    // conexão aberta foi atualizada pela sincronização: recarrega o formulário
    const atual = perfis.find((p) => p.id === form.id)
    if (atual && atual.temSenha !== form.temSenha) setForm((f) => ({ ...f, temSenha: atual.temSenha }))
  }, [perfis]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setForm(perfis[0] ?? vazio(empresaAtual?.id))
    setTeste(null)
  }, [empresaAtual?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const abrir = (p: PerfilConexao) => {
    setForm(p)
    setSenha('')
    setTeste(null)
  }
  const muda = <K extends keyof PerfilConexao>(k: K, v: PerfilConexao[K]) => setForm((f) => ({ ...f, [k]: v }))
  const mudaRegra = <K extends keyof PerfilConexao['regras']>(k: K, v: PerfilConexao['regras'][K]) =>
    setForm((f) => ({ ...f, regras: { ...f.regras, [k]: v } }))

  const testar = async () => {
    setTestando(true)
    setTeste(null)
    try {
      const r = await window.api.conexoes.testar(form, senha || undefined)
      setTeste(r)
      if (r.bancos?.length && !form.banco) avisar('Conectado. Escolha o banco na lista e teste de novo para conferir as tabelas.', 'ok')
    } catch (e) {
      setTeste({ ok: false, itens: [{ ok: false, titulo: 'Erro', detalhe: (e as Error).message }] })
    } finally {
      setTestando(false)
    }
  }

  const faltando = !form.cliente.trim() ? 'o nome do cliente' : !form.nome.trim() ? 'o nome da conexão' : !form.servidor.trim() ? 'o servidor' : ''

  const paraNuvem = (p: PerfilConexao): DadosConexaoNuvem => {
    const { temSenha: _t, atualizadoEm: _a, ...dados } = p
    return dados
  }

  /** Salva o cadastro na empresa (todos os PCs) e a senha só neste computador. */
  const salvar = async (p: PerfilConexao = form) => {
    if (!empresaAtual) return avisar('Escolha a empresa antes de cadastrar conexões.', 'erro')
    if (!internet || !nuvem) return avisar('Sem internet: o cadastro de conexões é salvo na empresa e precisa de conexão.', 'erro')
    if (!p.cliente.trim() || !p.nome.trim() || !p.servidor.trim()) return avisar(`Preencha ${faltando || 'os dados da conexão'}.`, 'erro')
    setSalvando(true)
    try {
      const salvo = await window.api.conexoes.salvar({ ...p, empresaId: empresaAtual.id }, p === form && senha ? senha : undefined)
      try {
        await nuvem.salvarConexao(empresaAtual.id, paraNuvem(salvo))
      } catch (e) {
        await window.api.conexoes.excluir(salvo.id).catch(() => undefined)
        throw new Error(`A conexão não foi salva na empresa: ${(e as Error).message}`)
      }
      await recarregar()
      setForm(salvo)
      setSenha('')
      if (!ativa) selecionar(salvo.id)
      avisar(`Conexão ${salvo.cliente} › ${salvo.nome} salva para todos os computadores de ${empresaAtual.nome}.`, 'ok')
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const salvarSoSenha = async () => {
    if (!form.id) return
    try {
      await window.api.conexoes.salvarSenha(form.id, senha)
      setSenha('')
      await recarregar()
      void adm.registrar({ acao: 'salvou', entidade: 'conexão', descricao: `Senha do SQL de ${form.cliente} › ${form.nome} guardada neste computador` })
      avisar('Senha guardada neste computador.', 'ok')
    } catch (e) {
      avisar((e as Error).message, 'erro')
    }
  }

  const excluir = async () => {
    if (!form.id || !confirm(`Excluir a conexão ${form.cliente} › ${form.nome} de todos os computadores de ${empresaAtual?.nome}?`)) return
    if (!nuvem) return avisar('Sem internet: não é possível excluir agora.', 'erro')
    try {
      await nuvem.excluirConexao(form.id)
      await window.api.conexoes.excluir(form.id)
      await recarregar()
      setForm(vazio(empresaAtual?.id))
      avisar('Conexão excluída.', 'ok')
    } catch (e) {
      avisar((e as Error).message, 'erro')
    }
  }

  const executarArquivo = async () => {
    setSalvando(true)
    try {
      if (arquivo === 'exportar') {
        if (await window.api.conexoes.exportar(perfis.map((p) => p.id), senhaArquivo)) {
          void adm.registrar({ acao: 'exportou', entidade: 'conexão', descricao: `Exportou ${perfis.length} conexão(ões) com as senhas do SQL` })
          avisar('Arquivo de conexões salvo.', 'ok')
        }
      } else {
        const n = await window.api.conexoes.importar(senhaArquivo)
        if (n) {
          await recarregar()
          void adm.registrar({ acao: 'importou', entidade: 'conexão', descricao: `Importou ${n} conexão(ões) com as senhas do SQL neste computador` })
          avisar(`${n} conexão(ões) importada(s).`, 'ok')
        }
      }
      setArquivo(null)
      setSenhaArquivo('')
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const grupos = perfis.reduce<Record<string, PerfilConexao[]>>((g, p) => ((g[p.cliente] ??= []).push(p), g), {})

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Conexões de {empresaAtual?.nome ?? '—'}</h1>
          <p className="fraco">O cadastro vale para todos os computadores da empresa. A senha do SQL fica só neste computador, protegida pelo Windows.</p>
        </div>
        {admin && (
          <div className="acoes">
            <button className="botao" onClick={() => setArquivo('importar')} title="Trazer conexões com as senhas do SQL de outro computador">Importar</button>
            <button className="botao" onClick={() => setArquivo('exportar')} disabled={!perfis.length} title="Levar as conexões com as senhas do SQL para outro computador">Exportar</button>
            <button className="botao primario" onClick={() => abrir(vazio(empresaAtual?.id))} disabled={!empresaAtual}><Icone nome="mais" /> Nova conexão</button>
          </div>
        )}
      </div>

      {!admin && <div style={{ marginBottom: 14 }}><Alerta tipo="aviso">Somente administradores alteram o cadastro das conexões. Você pode escolher a conexão na faixa superior e informar a senha do SQL deste computador.</Alerta></div>}
      {!sincronizadoComNuvem && <div style={{ marginBottom: 14 }}><Alerta tipo="aviso">Sem internet: mostrando a cópia das conexões guardada neste computador.</Alerta></div>}
      {admin && locais.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Alerta tipo="aviso" acoes={<button className="botao" disabled={!internet || salvando} onClick={async () => { for (const p of locais) await salvar({ ...p, empresaId: empresaAtual?.id ?? '' }) }}>Enviar para {empresaAtual?.nome}</button>}>
            Há {locais.length} conexão(ões) antiga(s) só neste computador ({locais.map((p) => `${p.cliente} › ${p.nome}`).join(', ')}). Envie para a empresa para os outros computadores enxergarem.
          </Alerta>
        </div>
      )}

      <div className="conexoes">
        <div className="caixa lista-conexoes">
          {Object.entries(grupos).map(([cliente, lista]) => (
            <div key={cliente}>
              <div className="cliente">{cliente}</div>
              {lista.map((p) => (
                <button key={p.id} className={p.id === form.id ? 'atual' : ''} onClick={() => abrir(p)} style={p.ativo === false ? { opacity: 0.6 } : undefined}>
                  <span className="cor" style={{ background: p.cor }} />
                  <span>
                    <div style={{ fontWeight: 600 }}>{p.nome} {p.id === ativa?.id && <span className="etiqueta ok">em uso</span>} {p.ativo === false ? <span className="etiqueta neutra">desativada</span> : p.autenticacao === 'sql' && !p.temSenha && <span className="etiqueta erro">sem senha</span>}</div>
                    <div className="linha2">{p.servidor}{p.instancia ? '\\' + p.instancia : ''} / {p.banco || 'sem banco'}</div>
                  </span>
                </button>
              ))}
            </div>
          ))}
          {perfis.length === 0 && <p className="fraco" style={{ padding: 12 }}>Nenhuma conexão em {empresaAtual?.nome ?? 'esta empresa'} ainda.{admin ? ' Crie a primeira com o banco do ERP.' : ''}</p>}
        </div>

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!admin && form.id && (
          <div className="caixa form-conexao">
            <h2>Senha do SQL neste computador</h2>
            <p className="fraco mini" style={{ marginBottom: 12 }}>
              {form.autenticacao === 'windows'
                ? 'Esta conexão usa o login do Windows: não precisa de senha.'
                : form.temSenha ? 'A senha já está guardada neste computador. Digite outra só se ela mudou.' : `Informe a senha do usuário ${form.usuario} para usar ${form.cliente} › ${form.nome} neste computador.`}
            </p>
            {form.autenticacao === 'sql' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="entrada" style={{ width: 260 }} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={form.temSenha ? 'Salva' : 'Senha do SQL'} autoComplete="new-password" />
                <button className="botao primario" disabled={!senha} onClick={() => void salvarSoSenha()}>Guardar senha</button>
                <button className="botao" onClick={() => void testar()} disabled={testando}>{testando ? <span className="spinner" /> : <Icone nome="banco" />} Testar conexão</button>
              </div>
            )}
          </div>
        )}
        <fieldset className="caixa form-conexao" disabled={!admin} style={{ margin: 0, minWidth: 0 }}>
          <h2>{form.id ? `${form.cliente} › ${form.nome}` : 'Nova conexão'}</h2>
          <p className="fraco mini" style={{ marginBottom: 16 }}>Todos os clientes usam o mesmo ERP; aqui muda só onde está o banco e as regras de cada um.</p>

          <div className="grade-form">
            <label className="campo c4"><span>Cliente</span><input className="entrada" value={form.cliente} onChange={(e) => muda('cliente', e.target.value)} placeholder="Hage" /></label>
            <label className="campo c4"><span>Nome da conexão</span><input className="entrada" value={form.nome} onChange={(e) => muda('nome', e.target.value)} placeholder="COMERCIO" /></label>
            <div className="campo c4"><span>Cor na faixa</span>
              <div className="cores">{CORES.map((c) => <button key={c} type="button" className={form.cor === c ? 'atual' : ''} style={{ background: c }} onClick={() => muda('cor', c)} aria-label={`Cor ${c}`} />)}</div>
            </div>

            <label className="campo c5"><span>Servidor</span><input className="entrada" value={form.servidor} onChange={(e) => muda('servidor', e.target.value)} placeholder="THIAGO-DELL, localhost ou 192.168.0.10" /><small>Para o banco deste computador use localhost</small></label>
            <label className="campo c4"><span>Instância</span><input className="entrada" value={form.instancia} onChange={(e) => muda('instancia', e.target.value)} placeholder="SQLEXPRESS (vazio = padrão)" /></label>
            <label className="campo c3"><span>Porta</span><input className="entrada" value={form.porta ?? ''} onChange={(e) => muda('porta', soDigitos(e.target.value) ? Number(soDigitos(e.target.value)) : null)} placeholder="1433" /></label>

            <label className="campo c4"><span>Autenticação</span>
              <select className="entrada" value={form.autenticacao} onChange={(e) => muda('autenticacao', e.target.value as PerfilConexao['autenticacao'])}>
                <option value="sql">Usuário do SQL Server</option>
                <option value="windows">Windows (usuário logado)</option>
              </select>
            </label>
            {form.autenticacao === 'sql' && <>
              <label className="campo c4"><span>Usuário</span><input className="entrada" value={form.usuario} onChange={(e) => muda('usuario', e.target.value)} /></label>
              {admin && <label className="campo c4"><span>Senha deste computador</span><input className="entrada" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={form.temSenha ? 'Salva (digite para trocar)' : ''} autoComplete="new-password" /></label>}
            </>}

            <label className="campo c6"><span>Banco de dados</span>
              {teste?.bancos?.length ? (
                <select className="entrada" value={form.banco} onChange={(e) => muda('banco', e.target.value)}>
                  <option value="">Escolha…</option>
                  {teste.bancos.map((b) => <option key={b}>{b}</option>)}
                  {form.banco && !teste.bancos.includes(form.banco) && <option>{form.banco}</option>}
                </select>
              ) : (
                <input className="entrada" value={form.banco} onChange={(e) => muda('banco', e.target.value)} placeholder="Teste a conexão para ver a lista" />
              )}
            </label>
            <label className="campo c3"><span>Driver</span>
              <select className="entrada" value={form.driver} onChange={(e) => muda('driver', e.target.value as PerfilConexao['driver'])}>
                <option value="auto">Automático</option>
                <option value="tedious">TCP/IP</option>
                <option value="msnodesqlv8" disabled={!nativo}>ODBC nativo{nativo ? '' : ' (não instalado)'}</option>
              </select>
            </label>
            <div className="campo c3"><span>&nbsp;</span><label className="check"><input type="checkbox" checked={form.criptografar} onChange={(e) => muda('criptografar', e.target.checked)} /> Criptografar conexão</label></div>
            <div className="campo c12">
              <label className="check"><input type="checkbox" checked={form.ativo !== false} onChange={(e) => muda('ativo', e.target.checked)} /> Conexão ativa</label>
              <small>Desativada, ela some da escolha de banco na faixa superior e do pedido, mas o cadastro continua aqui.</small>
            </div>
          </div>

          <div className="rodape-form">
            <button className="botao" onClick={() => void testar()} disabled={testando || !form.servidor}>{testando ? <span className="spinner" /> : <Icone nome="banco" />} Testar conexão</button>
            {teste && <span className={teste.ok ? '' : 'fraco'} style={{ color: teste.ok ? 'var(--ok)' : 'var(--erro)', fontWeight: 600 }}>{teste.ok ? `Conectado${teste.versao ? `: SQL Server ${teste.versao}` : ''}` : 'Não passou no teste'}</span>}
          </div>
          {teste && (
            <ul className="diagnostico">
              {teste.itens.map((it, i) => (
                <li key={i}>
                  <span className={`marca-diag ${!it.ok ? 'erro' : it.aviso ? 'aviso' : 'ok'}`}>{!it.ok ? '×' : it.aviso ? '!' : '✓'}</span>
                  <span><b>{it.titulo}</b>{it.detalhe && <small>{it.detalhe}</small>}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="secao">
            <h3>Regras deste cliente</h3>
            <p className="fraco mini" style={{ marginBottom: 12 }}>Na planilha estes valores eram fixos no código. Os padrões abaixo são os mesmos que ela usava.</p>
            <div className="grade-form">
              <label className="campo c2"><span>Equipe</span><input className="entrada" value={form.regras.equipe} onChange={(e) => mudaRegra('equipe', e.target.value)} /></label>
              <label className="campo c2"><span>Vendedor</span><input className="entrada" value={form.regras.vendedor} onChange={(e) => mudaRegra('vendedor', e.target.value)} /></label>
              <label className="campo c2"><span>Setor padrão</span><input className="entrada" value={form.regras.setorPadrao} onChange={(e) => mudaRegra('setorPadrao', e.target.value)} /></label>
              <label className="campo c3"><span>Dígitos do código</span><input className="entrada" type="number" min={1} max={20} value={form.regras.digitosCodigoProduto} onChange={(e) => mudaRegra('digitosCodigoProduto', Number(e.target.value) || 6)} /></label>
              <label className="campo c3"><span>CSTs com ST</span><input className="entrada" value={form.regras.cstsComST.join(', ')} onChange={(e) => mudaRegra('cstsComST', e.target.value.split(/[,\s]+/).filter(Boolean))} /></label>
              <div className="campo c6"><label className="check"><input type="checkbox" checked={form.regras.setorPelasColunasVendedor} onChange={(e) => mudaRegra('setorPelasColunasVendedor', e.target.checked)} /> Setor pelo cadastro do cliente (Vendedor1 a 5)</label></div>
              <div className="campo c6"><label className="check"><input type="checkbox" checked={form.regras.registrarEvento} onChange={(e) => mudaRegra('registrarEvento', e.target.checked)} /> Registrar em EventosSistema</label></div>
            </div>
          </div>

          <div className="secao">
            <h3>CNPJ da empresa deste banco</h3>
            <p className="fraco mini" style={{ marginBottom: 10 }}>Se o PDF for um pedido para outro fornecedor, o programa avisa antes de gerar no banco errado.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {form.cnpjsEmpresa.map((c) => (
                <span key={c} className="etiqueta neutra" style={{ fontSize: 13, padding: '3px 9px' }}>
                  {formatarCnpj(c)} <button className="botao leve" style={{ padding: '0 2px' }} onClick={() => muda('cnpjsEmpresa', form.cnpjsEmpresa.filter((x) => x !== c))} aria-label="Remover CNPJ">×</button>
                </span>
              ))}
              <input className="entrada" style={{ width: 200 }} value={cnpjNovo} onChange={(e) => setCnpjNovo(e.target.value)} placeholder="00.000.000/0000-00" />
              <button className="botao" disabled={soDigitos(cnpjNovo).length !== 14} onClick={() => { muda('cnpjsEmpresa', [...new Set([...form.cnpjsEmpresa, soDigitos(cnpjNovo)])]); setCnpjNovo('') }}>Adicionar</button>
            </div>
          </div>

          <div className="rodape-form">
            {form.id && <button className="botao perigo" onClick={() => void excluir()}><Icone nome="lixo" /> Excluir</button>}
            <div className="direita">
              {form.id && ativa?.id !== form.id && form.ativo !== false && <button className="botao" onClick={() => selecionar(form.id)}>Usar esta conexão</button>}
              {form.id && admin && <button className="botao" onClick={() => void salvar({ ...form, ativo: form.ativo === false })} disabled={salvando}>{form.ativo === false ? 'Ativar' : 'Desativar'}</button>}
              <button className="botao primario" onClick={() => void salvar()} disabled={salvando || !internet}>{salvando ? <span className="spinner" /> : null} Salvar conexão</button>
            </div>
          </div>
        </fieldset>
        </div>
      </div>

      <Modal aberto={!!arquivo} aoFechar={() => !salvando && setArquivo(null)} rotulo={arquivo === 'exportar' ? 'Exportar conexões' : 'Importar conexões'}
        botoes={<><button className="botao" onClick={() => setArquivo(null)} disabled={salvando}>Cancelar</button><button className="botao primario" onClick={() => void executarArquivo()} disabled={salvando || senhaArquivo.length < 4}>{arquivo === 'exportar' ? 'Escolher onde salvar' : 'Escolher arquivo'}</button></>}>
        <h2>{arquivo === 'exportar' ? `Exportar ${perfis.length} conexão(ões)` : 'Importar conexões'}</h2>
        <p className="fraco mini">{arquivo === 'exportar' ? 'Leva as conexões com as senhas do SQL para outro computador. Crie uma senha para o arquivo; ela será pedida na importação.' : 'Informe a senha usada ao exportar.'}</p>
        <label className="campo"><span>Senha do arquivo</span><input className="entrada" type="password" value={senhaArquivo} onChange={(e) => setSenhaArquivo(e.target.value)} autoFocus /><small>Mínimo de 4 caracteres</small></label>
      </Modal>
    </div>
  )
}
