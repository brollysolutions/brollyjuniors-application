import type { NextConfig } from 'next'

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:8300'

/**
 * Two build targets out of one source tree.
 *
 *   MOBILE=1 npm run build   →  out/       static SPA, wrapped by Capacitor
 *   npm run build            →  .next/     standalone server, used by Docker
 *
 * They differ because a phone has no Next server. On the web the browser talks
 * to one origin and Next proxies /api/* onwards, which is what keeps the
 * refresh cookie HttpOnly and same-origin. In the app the bundle is loaded off
 * the device, so there is nothing to proxy through: the client calls the API
 * host directly at NEXT_PUBLIC_API_BASE_URL. See src/lib/platform.ts.
 */
const mobile = process.env.MOBILE === '1'

const config: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone: a self-contained server plus only the
  // node_modules actually reached. It is what the Docker runtime stage
  // copies, and it is why that image does not carry a full install.
  // Harmless outside Docker — `next build` still writes .next as before.
  // For mobile it becomes 'export', which writes a plain out/ instead.
  output: mobile ? 'export' : 'standalone',
  // Next writes CLAUDE.md / AGENTS.md into the project by default; this repo
  // did not ask for them.
  agentRules: false,
  // No server means no image optimiser to call.
  ...(mobile ? { images: { unoptimized: true } } : {}),
  // Proxied so the browser sees one origin: the refresh token is an HttpOnly
  // SameSite=Lax cookie, which is the point of not putting it in localStorage.
  // The FastAPI service is never addressed directly from the browser.
  //
  // `output: 'export'` has no server to run rewrites, so the mobile build
  // omits them rather than shipping a rule that silently never fires.
  ...(mobile ? {} : {
    async rewrites() {
      return [{ source: '/api/:path*', destination: `${API}/api/:path*` }]
    },
  }),
}

export default config
