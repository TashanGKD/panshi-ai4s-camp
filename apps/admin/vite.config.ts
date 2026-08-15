import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/admin/',
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
})
