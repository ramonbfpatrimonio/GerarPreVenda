// Ícones simples (traço), para não depender de biblioteca externa.
const caminhos: Record<string, string> = {
  pedido: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6',
  banco: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  historico: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  usuarios: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  pdf: 'M12 3v12m0 0-4-4m4 4 4-4M5 21h14',
  colar: 'M9 4h6v3H9zM8 5H6v16h12V5h-2M9 12h6M9 16h4',
  mais: 'M12 5v14M5 12h14',
  lixo: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  atualizar: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  alerta: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  ok: 'M20 6 9 17l-5-5',
  info: 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  sair: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  seta: 'M6 9l6 6 6-6',
  exportar: 'M12 15V3m0 0L8 7m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  importar: 'M12 3v12m0 0-4-4m4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  empresa: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4',
  planilha: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
  eventos: 'M4 6h16M4 12h16M4 18h10M18 16v4M16 18h4',
  backup: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v5c0 1.7 3.6 3 8 3M20 7v3M17 17l2 2 4-4',
  imagem: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  cadeado: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  olho: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
}

export function Icone({ nome, tamanho = 18 }: { nome: keyof typeof caminhos | string; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={caminhos[nome] ?? caminhos.info} />
    </svg>
  )
}
