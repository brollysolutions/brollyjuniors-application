import type { NextConfig } from 'next'

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:8000'

const config: NextConfig = {
  reactStrictMode: true,
  // Next writes CLAUDE.md / AGENTS.md into the project by default; this repo
  // did not ask for them.
  agentRules: false,
  // Proxied so the browser sees one origin: the refresh token is an HttpOnly
  // SameSite=Lax cookie, which is the point of not putting it in localStorage.
  // The FastAPI service is never addressed directly from the browser.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }]
  },
}

export default config
