import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['xlsx'], // Força a inclusão do xlsx nas dependências otimizadas
  },
  build: {
    commonjsOptions: {
      include: [/xlsx/, /node_modules/], // Garante que módulos CommonJS como xlsx sejam processados
    },
  },
})