import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { versionDataPlugin } from './vite.versionPlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionDataPlugin()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:4173',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
