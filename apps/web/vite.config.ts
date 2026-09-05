import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxied so the browser sees one origin: the refresh cookie is HttpOnly
    // and SameSite=Lax, which is the point of not putting it in localStorage.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
