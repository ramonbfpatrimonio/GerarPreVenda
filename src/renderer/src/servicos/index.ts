// Escolhe a implementação: Supabase de verdade, ou o modo demonstração
// (só existe em `npm run demo`, usado para testar telas sem banco/nuvem).
import { nuvemSupabase, type Nuvem } from './nuvem'

const DEMO = import.meta.env.VITE_DEMO === '1'

export let nuvem: Nuvem = nuvemSupabase

export async function iniciarServicos() {
  if (DEMO) {
    const demo = await import('./demo')
    nuvem = demo.nuvemDemo
    demo.instalarApiDemo()
  }
}

export type { Nuvem, Perfil, Papel, RegistroHistorico } from './nuvem'
