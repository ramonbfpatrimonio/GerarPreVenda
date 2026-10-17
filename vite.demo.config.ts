// Build só da interface, em modo demonstração (sem Electron, banco ou Supabase).
// Uso: npm run demo  -> abre em http://localhost:5199/?logado
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  root: resolve('src/renderer'),
  resolve: { alias: { '@shared': resolve('src/shared') } },
  plugins: [react()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  server: { port: 5199 },
  preview: { port: 5199 },
  build: { outDir: resolve('out-demo'), emptyOutDir: true }
})
