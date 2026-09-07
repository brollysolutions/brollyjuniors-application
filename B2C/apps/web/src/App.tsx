import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Bootstrap } from '@brolly/b2c-shared'
import { BROLLY_JUNIORS, ROLE_THEME } from '@brolly/b2c-shared'
import * as client from './api.ts'
import { SessionCtx, Field, Action } from './ui.tsx'
import PublicSite from './public.tsx'
import StudentPortal from './portals/student.tsx'
import TeacherPortal from './portals/teacher.tsx'
import AdminPortal from './portals/admin.tsx'

export default function App() {
  const [me, setMe] = useState<Bootstrap | null>(null)
  const [booting, setBooting] = useState(true)
  const [screen, setScreen] = useState('')
  const [param, setParam] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; bad?: boolean }>>([])
  /** Where an anonymous visitor is in the shop, and where to return after signing in. */
  const [publicScreen, setPublicScreen] = useState<{ name: string; param: string | null }>(
    { name: 'home', param: null })

  const loadMe = useCallback(async () => {
    const b = await client.get<Bootstrap>('/me/bootstrap')
    setMe(b)
    setScreen(s => s || b.nav[0]?.key || 'home')
    return b
  }, [])

  useEffect(() => {
    (async () => {
      if (await client.restore()) {
        try { await loadMe() } catch { /* session no longer valid */ }
      }
      setBooting(false)
    })()
  }, [loadMe])

  const toast = useCallback((msg: string, bad?: boolean) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, bad }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3400)
  }, [])

  const go = useCallback((s: string, p: string | null = null) => {
    setScreen(s); setParam(p); window.scrollTo(0, 0)
  }, [])

  const signOut = useCallback(async () => {
    await client.logout()
    setMe(null); setScreen(''); setParam(null)
    setPublicScreen({ name: 'home', param: null })
  }, [])

  // Brand tokens come from config, not from a component. One brand today; the
  // indirection is what makes a second one a data change rather than a rewrite.
  useEffect(() => {
    const brand = me?.brand ?? BROLLY_JUNIORS
    const root = document.documentElement
    root.style.setProperty('--brand-primary', brand.primaryColor)
    root.style.setProperty('--brand-primary-hover', shade(brand.primaryColor, -14))
    root.style.setProperty('--brand-secondary', brand.secondaryColor)
    root.style.setProperty('--cta-text', contrastInk(brand.primaryColor))
    document.title = me ? `${brand.name} · ${ROLE_THEME[me.role].label}` : `${brand.name} — ${brand.tagline}`
  }, [me])

  if (booting) {
    return <div className="loading" style={{ paddingTop: 140 }}><span className="spinner dark" /> Starting…</div>
  }

  if (!me) {
    return (
      <>
        <PublicSite
          screen={publicScreen}
          navigate={(name, p = null) => { setPublicScreen({ name, param: p }); window.scrollTo(0, 0) }}
          onSignedIn={loadMe}
          toast={toast}
        />
        {toasts.map(t => <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')}>{t.msg}</div>)}
      </>
    )
  }

  return (
    <SessionCtx.Provider value={{ me, reload: async () => { await loadMe() }, signOut, toast, go, screen, param }}>
      <Shell />
      {toasts.map(t => <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')}>{t.msg}</div>)}
    </SessionCtx.Provider>
  )
}

// ---------------------------------------------------------------------------

function Shell() {
  const { me, screen, go, signOut } = React.useContext(SessionCtx)
  const theme = ROLE_THEME[me.role]
  const Portal = me.role === 'BROLLY_ADMIN' ? AdminPortal
    : me.role === 'TEACHER' ? TeacherPortal : StudentPortal

  const navKeys = useMemo(() => new Set(me.nav.map(n => n.key)), [me.nav])
  const active = navKeys.has(screen) ? screen : me.nav[0]?.key

  return (
    <>
      <div className="shell" style={{ ['--role' as any]: theme.accent, ['--role-soft' as any]: theme.accentSoft }}>
        <aside className="side">
          <div className="brand">
            <div className="mark">{me.brand.logoText}</div>
            <div className="nm">
              <span>{me.brand.name}</span>
              <small>{theme.label}</small>
            </div>
          </div>
          <nav>
            {me.nav.map(n => (
              <button key={n.key} className={active === n.key ? 'on' : ''} onClick={() => go(n.key)}>
                <span className="ic">{n.icon}</span>{n.label}
                {n.badge ? <span className="badge">{n.badge}</span> : null}
              </button>
            ))}
          </nav>
          <div className="sidefoot">
            <div className="who">{me.user.fullName}</div>
            {me.user.email}
            <div style={{ marginTop: 8 }}>
              <button className="btn ghost sm" onClick={signOut}>Sign out</button>
            </div>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <span className="crumb">{theme.label}</span>
            <span className="spacer" />
            <Notifications />
            <span className="chip">{me.user.fullName}</span>
          </div>
          <div className="content">
            {/* Stated on every screen, not buried in a policy page. */}
            <div className="boundary">
              <span className="eye">Can see</span>
              <span className="what"><strong>{me.boundary}</strong> — nothing outside this line, on any screen.</span>
            </div>
            {me.user.mustChangePassword ? <ChangePasswordBanner /> : null}
            <Portal />
          </div>
        </div>
      </div>

      <div className="mobnav" style={{ ['--role' as any]: theme.accent }}>
        {me.nav.map(n => (
          <button key={n.key} className={active === n.key ? 'on' : ''} onClick={() => go(n.key)}>{n.label}</button>
        ))}
      </div>
    </>
  )
}

function Notifications() {
  const { go } = React.useContext(SessionCtx)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<any[]>([])

  useEffect(() => {
    client.get('/me/notifications').then(r => setItems(r.notifications ?? [])).catch(() => {})
  }, [])

  const unread = items.filter(n => !n.read_at).length
  return (
    <>
      <button className={'chip act' + (unread ? ' warn' : '')} onClick={async () => {
        setOpen(o => !o)
        if (!open && unread) {
          await client.post('/me/notifications/read').catch(() => {})
          setItems(items.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
        }
      }}>
        {unread ? `${unread} new` : 'Notifications'}
      </button>
      {open ? (
        <div style={{
          position: 'absolute', right: 24, top: 56, width: 'min(380px, 90vw)', zIndex: 40,
          background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14,
          boxShadow: '0 12px 40px rgba(30,41,59,.18)', maxHeight: 400, overflowY: 'auto', padding: 8,
        }}>
          {items.length === 0
            ? <div className="loading" style={{ padding: 24 }}>Nothing yet.</div>
            : items.map(n => (
                <button key={n.id} className="unit" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => { setOpen(false); if (n.link_screen) go(n.link_screen, n.link_param || null) }}>
                  <div className="num">{n.kind === 'grade' ? '✓' : n.kind === 'live' ? '◉' : '★'}</div>
                  <div className="body">
                    <div className="t" style={{ fontSize: 14 }}>{n.title}</div>
                    <div className="m">{n.body}</div>
                  </div>
                </button>
              ))}
        </div>
      ) : null}
    </>
  )
}

function ChangePasswordBanner() {
  const { toast, reload } = React.useContext(SessionCtx)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [err, setErr] = useState('')

  if (!open) {
    return (
      <div className="note" style={{ marginTop: 0, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <strong>Change your password.</strong> You are still using the one Brolly gave you.
        </div>
        <button className="btn gold sm" onClick={() => setOpen(true)}>Change it now</button>
      </div>
    )
  }
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3>Choose a new password</h3>
      <div className="sub" style={{ marginBottom: 12 }}>
        At least 8 characters. A phrase you will remember beats symbols you will forget.
      </div>
      <div className="grid g3">
        <Field label="Current password"><input type="password" value={current} onChange={e => setCurrent(e.target.value)} /></Field>
        <Field label="New password" error={err}><input type="password" value={next} onChange={e => setNext(e.target.value)} /></Field>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 14 }}>
          <Action label="Save" onClick={async () => {
            setErr('')
            try {
              await client.post('/auth/change-password', { currentPassword: current, newPassword: next })
              toast('Password updated')
              await client.restore()
              await reload()
              setOpen(false)
            } catch (e: any) { setErr(e.message) }
          }} />
          <button className="btn ghost" onClick={() => setOpen(false)}>Later</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function shade(hex: string, amount: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const clamp = (v: number) => Math.max(0, Math.min(255, v))
  const r = clamp((n >> 16) + amount), g = clamp(((n >> 8) & 255) + amount), b = clamp((n & 255) + amount)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

/** Ink or white on the brand colour, so contrast survives a rebrand. */
function contrastInk(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#1E293B'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.45 ? '#1E293B' : '#FFFFFF'
}
