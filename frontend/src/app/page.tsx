'use client'

import dynamic from 'next/dynamic'

/**
 * The whole application is one client tree.
 *
 * Rendering it on the server would be worse than useless here: every screen is
 * gated on a session the server does not have (the access token lives in
 * memory in the browser, deliberately), so an SSR pass would render the signed
 * out shop and then swap it for the portal on hydration.
 */
const App = dynamic(() => import('@/components/App'), {
  ssr: false,
  loading: () => (
    <div className="loading" style={{ paddingTop: 140 }}>
      <span className="spinner dark" /> Starting…
    </div>
  ),
})

export default function Home() {
  return <App />
}
