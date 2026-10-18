import fundoPadrao from '../assets/fundo-padrao.jpg'

export type Ajuste = 'preencher' | 'inteira'

/**
 * Papel de parede do login. Acompanha o tamanho da área (janela maior ou menor)
 * sem nunca esticar a imagem:
 *  - preencher: cobre toda a área mantendo a proporção (o que sobra nas bordas é recortado);
 *  - inteira:   mostra a imagem toda, e o espaço que sobra é preenchido pela própria imagem desfocada.
 */
export function FundoLogin({ src, ajuste = 'preencher', className = '', rotulo }: { src?: string | null; ajuste?: Ajuste; className?: string; rotulo?: string }) {
  const url = `url("${src || fundoPadrao}")`
  return (
    <div className={`fundo-login ${ajuste} ${className}`} role="img" aria-label={rotulo ?? 'Papel de parede'}>
      {ajuste === 'inteira' && <div className="fundo-borrado" style={{ backgroundImage: url }} />}
      <div className="fundo-imagem" style={{ backgroundImage: url }} />
    </div>
  )
}
