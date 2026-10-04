import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the page runs on Vite (http://localhost:5173) and the engine on Spring (http://localhost:8080):
// these two paths are forwarded to Spring, so the page talks to the same URLs it uses in production.
// Set SLACKWATER_ENGINE to point somewhere else.
const engine = process.env.SLACKWATER_ENGINE ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': engine,
      '/clips': engine,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
