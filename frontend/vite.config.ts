import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 5173,
    strictPort: Boolean(process.env.WAILS_VITE_PORT),
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', ws: true },
      '/healthz': { target: 'http://127.0.0.1:8080' },
    },
  },
})
