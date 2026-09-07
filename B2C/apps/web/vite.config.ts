import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    // Proxied so the browser sees one origin: the refresh token is an HttpOnly
    // SameSite=Lax cookie, which is the point of not putting it in localStorage.
    proxy: { '/api': { target: 'http://127.0.0.1:4100', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
})
