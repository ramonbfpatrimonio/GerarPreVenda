import { useEffect, useState } from 'react'
import { nuvem, type Papel, type Perfil } from '../servicos'
import { useAviso, useSessao } from '../contexto'
import { Icone } from '../componentes/Icone'
import { Modal } from '../componentes/Modal'

export function Pagina_Usuarios({ visivel }: { visivel: boolean }) {
  const { perfil: eu } = useSessao()
  const avisar = useAviso()
  const [lista, setLista] = useState<Perfil[]>([])
  const [novo, setNovo] = useState(false)
  const [senhaDe, setSenhaDe] = useState<Perfil | null>(null)
  const [dados, setDados] = useState({ nome: '', email: '', senha: '', papel: 'operador' as Papel })
  const [novaSenha, setNovaSenha] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = async () => {
    try {
      setLista(await nuvem.usuarios())
    } catch (e) {
      avisar((e as Error).message, 'erro')
    }
  }
  useEffect(() => {
    if (visivel) void carregar()
  }, [visivel]) // eslint-disable-line react-hooks/exhaustive-deps

  const alterar = async (u: Perfil, d: Partial<Perfil>) => {
    try {
      await nuvem.alterarUsuario(u.id, d)
      await carregar()
    } catch (e) {
      avisar((e as Error).message, 'erro')
    }
  }

  const criar = async () => {
    setSalvando(true)
    try {
      await nuvem.criarUsuario(dados)
      avisar(`Usuário ${dados.nome} criado.`, 'ok')
      setNovo(false)
      setDados({ nome: '', email: '', senha: '', papel: 'operador' })
      await carregar()
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  const trocarSenha = async () => {
    if (!senhaDe) return
    setSalvando(true)
    try {
      await nuvem.trocarSenha(senhaDe.id, novaSenha)
      avisar(`Senha de ${senhaDe.nome} alterada.`, 'ok')
      setSenhaDe(null)
      setNovaSenha('')
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setSalvando(false)
    }
  }

  if (!visivel) return null
  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Usuários</h1>
          <p className="fraco">O mesmo login vale em todos os computadores. Operadores geram pré-vendas; administradores também cuidam de conexões e usuários.</p>
        </div>
        <div className="acoes"><button className="botao primario" onClick={() => setNovo(true)}><Icone nome="mais" /> Novo usuário</button></div>
      </div>
      <div className="caixa" style={{ maxWidth: 900 }}>
        <table className="tabela">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.nome}{u.id === eu?.id && <span className="etiqueta neutra" style={{ marginLeft: 6 }}>você</span>}</td>
                <td>{u.email}</td>
                <td>
                  <select className="entrada" style={{ width: 150, padding: '4px 8px' }} value={u.papel} disabled={u.id === eu?.id} onChange={(e) => void alterar(u, { papel: e.target.value as Papel })}>
                    <option value="operador">Operador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </td>
                <td>{u.ativo ? <span className="etiqueta ok">Ativo</span> : <span className="etiqueta erro">Desativado</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="botao leve" onClick={() => setSenhaDe(u)}>Trocar senha</button>
                  {u.id !== eu?.id && <button className="botao leve" onClick={() => void alterar(u, { ativo: !u.ativo })}>{u.ativo ? 'Desativar' : 'Reativar'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal aberto={novo} aoFechar={() => setNovo(false)} rotulo="Novo usuário"
        botoes={<><button className="botao" onClick={() => setNovo(false)}>Cancelar</button><button className="botao primario" disabled={salvando || !dados.nome || !dados.email || dados.senha.length < 6} onClick={() => void criar()}>Criar usuário</button></>}>
        <h2>Novo usuário</h2>
        <label className="campo"><span>Nome</span><input className="entrada" value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} autoFocus /></label>
        <label className="campo"><span>E-mail</span><input className="entrada" type="email" value={dados.email} onChange={(e) => setDados({ ...dados, email: e.target.value })} /></label>
        <label className="campo"><span>Senha inicial</span><input className="entrada" type="password" value={dados.senha} onChange={(e) => setDados({ ...dados, senha: e.target.value })} /><small>Mínimo de 6 caracteres</small></label>
        <label className="campo"><span>Papel</span>
          <select className="entrada" value={dados.papel} onChange={(e) => setDados({ ...dados, papel: e.target.value as Papel })}>
            <option value="operador">Operador</option><option value="admin">Administrador</option>
          </select>
        </label>
      </Modal>

      <Modal aberto={!!senhaDe} aoFechar={() => setSenhaDe(null)} rotulo="Trocar senha"
        botoes={<><button className="botao" onClick={() => setSenhaDe(null)}>Cancelar</button><button className="botao primario" disabled={salvando || novaSenha.length < 6} onClick={() => void trocarSenha()}>Trocar senha</button></>}>
        <h2>Trocar a senha de {senhaDe?.nome}</h2>
        <label className="campo"><span>Nova senha</span><input className="entrada" type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} autoFocus /><small>Mínimo de 6 caracteres</small></label>
      </Modal>
    </div>
  )
}
