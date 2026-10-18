import { useEffect, useState } from 'react'
import type { InfoBackup } from '../../../preload/api'
import { useAviso, useConexoes, useSessao } from '../contexto'
import { useAdmin } from '../admin'
import { Icone } from '../componentes/Icone'
import { Alerta, Modal } from '../componentes/Modal'

const tamanho = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`)
const quando = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })

/**
 * Backups deste computador (conexões com as senhas do SQL, fila sem internet e
 * aparência), backup da empresa na nuvem e transporte das senhas do SQL para
 * outro computador.
 */
export function Pagina_Backups({ visivel }: { visivel: boolean }) {
  const { empresaAtual, internet } = useSessao()
  const { perfis, recarregar } = useConexoes()
  const adm = useAdmin()
  const avisar = useAviso()
  const [lista, setLista] = useState<InfoBackup[]>([])
  const [pasta, setPasta] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [restaurar, setRestaurar] = useState<InfoBackup | null>(null)
  const [arquivo, setArquivo] = useState<'exportar' | 'importar' | null>(null)
  const [senhaArquivo, setSenhaArquivo] = useState('')

  const carregar = async () => {
    try {
      setLista(await window.api.backup.listar())
      setPasta(await window.api.backup.pasta())
    } catch (e) {
      avisar((e as Error).message, 'erro')
    }
  }
  useEffect(() => {
    if (visivel) void carregar()
  }, [visivel]) // eslint-disable-line react-hooks/exhaustive-deps

  const fazer = async () => {
    setOcupado('fazer')
    try {
      const b = await window.api.backup.fazer()
      void adm.registrar({ acao: 'backup', entidade: 'backup', descricao: `Backup deste computador: ${b.nome}` })
      avisar('Backup feito.', 'ok')
      await carregar()
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setOcupado('')
    }
  }

  const confirmarRestauracao = async () => {
    if (!restaurar) return
    setOcupado('restaurar')
    try {
      const arquivos = await window.api.backup.restaurar(restaurar.nome)
      await adm.registrar({ acao: 'restaurou', entidade: 'backup', descricao: `Restaurou o backup ${restaurar.nome} (${arquivos.join(', ')})` })
      avisar('Backup restaurado. O programa vai recarregar.', 'ok')
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      avisar((e as Error).message, 'erro')
      setOcupado('')
    }
  }

  const baixarNuvem = async () => {
    if (!adm.nuvem || !empresaAtual) return
    setOcupado('nuvem')
    try {
      const dados = await adm.nuvem.backupEmpresa(empresaAtual.id)
      const nome = `backup-${empresaAtual.nome.replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`
      const salvo = await window.api.backup.salvarArquivo(nome, JSON.stringify(dados, null, 2))
      if (salvo) {
        void adm.registrar({ acao: 'backup', entidade: 'backup', descricao: `Baixou o backup da nuvem de ${empresaAtual.nome}` })
        avisar(`Backup da nuvem salvo em ${salvo}`, 'ok')
      }
    } catch (e) {
      avisar((e as Error).message, 'erro')
    } finally {
      setOcupado('')
    }
  }

  const executarArquivo = async () => {
    setOcupado('arquivo')
    try {
      if (arquivo === 'exportar') {
        const ok = await window.api.conexoes.exportar(perfis.map((p) => p.id), senhaArquivo)
        if (ok) {
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
      setOcupado('')
    }
  }

  if (!visivel) return null
  const podeNuvem = internet && !!adm.nuvem && !!empresaAtual

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h1>Backups</h1>
          <p className="fraco">Um backup automático é feito por dia ao abrir o programa. Os 30 mais recentes ficam guardados.</p>
        </div>
      </div>

      <div className="grade-backups">
        <section className="caixa bloco">
          <h2>Este computador</h2>
          <p className="fraco mini">Conexões com as senhas do SQL, pré-vendas esperando internet e aparência do login.</p>
          <div className="pasta-backup" title={pasta}><Icone nome="backup" /> {pasta || '…'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="botao primario" onClick={() => void fazer()} disabled={!!ocupado}>{ocupado === 'fazer' ? <span className="spinner" /> : <Icone nome="backup" />} Fazer backup agora</button>
            <button className="botao" onClick={() => void window.api.backup.abrirPasta()}>Abrir pasta</button>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 420, marginTop: 6 }}>
            <table className="tabela">
              <thead><tr><th>Data</th><th>Tipo</th><th>Arquivos</th><th className="num">Tamanho</th><th></th></tr></thead>
              <tbody>
                {lista.map((b) => (
                  <tr key={b.nome}>
                    <td className="nowrap">{quando(b.criadoEm)}</td>
                    <td>{b.automatico ? <span className="etiqueta neutra">automático</span> : <span className="etiqueta ok">manual</span>}</td>
                    <td className="mini">{b.arquivos.join(', ')}</td>
                    <td className="num">{tamanho(b.tamanho)}</td>
                    <td style={{ textAlign: 'right' }}><button className="botao leve" onClick={() => setRestaurar(b)}>Restaurar</button></td>
                  </tr>
                ))}
                {!lista.length && <tr><td colSpan={5} className="fraco" style={{ textAlign: 'center', height: 60 }}>Nenhum backup ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="caixa bloco">
            <h2>Empresa na nuvem</h2>
            <p className="fraco mini">Baixa um arquivo com usuários, conexões, histórico de pré-vendas e eventos de {empresaAtual?.nome ?? 'empresa'}. Senhas não entram.</p>
            {!podeNuvem && <Alerta tipo="aviso">Precisa de internet.</Alerta>}
            <div><button className="botao" onClick={() => void baixarNuvem()} disabled={!podeNuvem || !!ocupado}>{ocupado === 'nuvem' ? <span className="spinner" /> : <Icone nome="backup" />} Baixar backup da empresa</button></div>
          </section>

          <section className="caixa bloco">
            <h2>Senhas do SQL para outro computador</h2>
            <p className="fraco mini">As senhas do SQL não vão para a nuvem. Exporte um arquivo protegido por senha e importe no outro computador da empresa.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="botao" onClick={() => setArquivo('exportar')} disabled={!perfis.length}>Exportar conexões</button>
              <button className="botao" onClick={() => setArquivo('importar')}>Importar conexões</button>
            </div>
          </section>
        </div>
      </div>

      <Modal aberto={!!restaurar} aoFechar={() => !ocupado && setRestaurar(null)} rotulo="Restaurar backup"
        botoes={<><button className="botao" onClick={() => setRestaurar(null)} disabled={!!ocupado}>Cancelar</button><button className="botao primario perigo" onClick={() => void confirmarRestauracao()} disabled={!!ocupado}>{ocupado === 'restaurar' ? <span className="spinner" /> : null} Restaurar</button></>}>
        <h2>Restaurar o backup de {restaurar && quando(restaurar.criadoEm)}?</h2>
        <p>As conexões, a fila sem internet e a aparência deste computador voltam a ser as do backup. Antes, um backup do estado atual é feito automaticamente.</p>
      </Modal>

      <Modal aberto={!!arquivo} aoFechar={() => !ocupado && setArquivo(null)} rotulo={arquivo === 'exportar' ? 'Exportar conexões' : 'Importar conexões'}
        botoes={<><button className="botao" onClick={() => setArquivo(null)} disabled={!!ocupado}>Cancelar</button><button className="botao primario" onClick={() => void executarArquivo()} disabled={!!ocupado || senhaArquivo.length < 4}>{arquivo === 'exportar' ? 'Escolher onde salvar' : 'Escolher arquivo'}</button></>}>
        <h2>{arquivo === 'exportar' ? `Exportar ${perfis.length} conexão(ões)` : 'Importar conexões'}</h2>
        <p className="fraco mini">{arquivo === 'exportar' ? 'Crie uma senha para o arquivo. Ela será pedida na importação.' : 'Informe a senha usada ao exportar.'}</p>
        <label className="campo"><span>Senha do arquivo</span><input className="entrada" type="password" value={senhaArquivo} onChange={(e) => setSenhaArquivo(e.target.value)} autoFocus /><small>Mínimo de 4 caracteres</small></label>
      </Modal>
    </div>
  )
}
