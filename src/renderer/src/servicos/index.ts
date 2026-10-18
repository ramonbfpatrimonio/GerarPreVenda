// Escolhe a implementação: Supabase de verdade, ou o modo demonstração
// (só existe em `npm run demo`, usado para testar telas sem banco/nuvem).
import { criarNuvemAdmin as criarNuvemAdminSupabase, definirEstacao, nuvemSupabase, type Nuvem } from './nuvem'

const DEMO = import.meta.env.VITE_DEMO === '1'

export let nuvem: Nuvem = nuvemSupabase
export let criarNuvemAdmin: () => Nuvem = criarNuvemAdminSupabase

export async function iniciarServicos() {
  if (DEMO) {
    const demo = await import('./demo')
    nuvem = demo.nuvemDemo
    criarNuvemAdmin = demo.criarNuvemAdminDemo
    demo.instalarApiDemo()
  }
  definirEstacao(await window.api.sistema.estacao().catch(() => ''))
}

export type { Nuvem, Perfil, Papel, RegistroHistorico, Empresa, ConexaoNuvem, Evento, NovoEvento } from './nuvem'
export { ehErroDeRede } from './nuvem'
