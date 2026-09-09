'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Bootstrap, NavItem } from '@/lib/types'
import { FALLBACK_BRAND, ROLE_THEME } from '@/lib/types'
import * as client from '@/lib/api'
import { hideSplash, initNative, onBackButton } from '@/lib/native'
import {
  Glyph, SessionCtx, useDismiss, useLockBody, useMedia,
} from '@/components/ui'
import PublicSite from '@/components/public'
import StudentPortal from '@/components/portals/student'
import AdminPortal from '@/components/portals/admin'
import { ChangePassword } from '@/components/account'
import TeacherPortal from '@/components/portals/teacher'

/**
 * One position in the app, as something that can be put on a stack.
 *
 * Screens are state, not URLs, so the WebView's own history is empty and
 * Android's back button would leave the app from any screen. This is the
 * history that button walks instead.
 */
type Spot =
  | { kind: 'portal'; screen: string; param: string | null }
  | { kind: 'public'; name: string; param: string | null }

export default function App() {
  const [me, setMe] = useState<Bootstrap | null>(null)
  const [booting, setBooting] = useState(true)
  const [screen, setScreen] = useState('')
  const [param, setParam] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; bad?: boolean }>>([])
  /** Where an anonymous visitor is in the shop, and where to return after signing in. */
  const [publicScreen, setPublicScreen] = useState<{ name: string; param: string | null }>(
    { name: 'home', param: null })

  // Where back goes, oldest first, and a mirror of where we are now. Refs
  // rather than state: the back handler is registered once and must not see a
  // position captured at mount.
  const back = useRef<Spot[]>([])
  const here = useRef<Spot>({ kind: 'public', name: 'home', param: null })

  const loadMe = useCallback(async () => {
    const b = await client.get<Bootstrap>('/me/bootstrap')
    setMe(b)
    setScreen(s => s || b.nav[0]?.key || 'home')
    return b
  }, [])

  useEffect(() => {
    here.current = me
      ? { kind: 'portal', screen, param }
      : { kind: 'public', name: publicScreen.name, param: publicScreen.param }
  }, [me, screen, param, publicScreen])

  useEffect(() => onBackButton(() => {
    const prev = back.current.pop()
    if (!prev) return false          // root screen: the shell backgrounds the app
    if (prev.kind === 'portal') { setScreen(prev.screen); setParam(prev.param) }
    else setPublicScreen({ name: prev.name, param: prev.param })
    window.scrollTo(0, 0)
    return true
  }), [])

  useEffect(() => {
    void initNative()
    ;(async () => {
      if (await client.restore()) {
        try { await loadMe() } catch { /* session no longer valid */ }
      }
      setBooting(false)
      // Configured launchAutoHide: false, so the splash covers the session
      // restore above and the first painted frame is the screen we settled on.
      void hideSplash()
    })()
  }, [loadMe])

  const toast = useCallback((msg: string, bad?: boolean) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, bad }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3400)
  }, [])

  const go = useCallback((s: string, p: string | null = null) => {
    const at = here.current
    // Re-tapping the active nav item is not a move, so it is not history.
    if (at.kind === 'portal' && at.screen === s && at.param === p) return
    back.current.push(at)
    setScreen(s); setParam(p); window.scrollTo(0, 0)
  }, [])

  const signOut = useCallback(async () => {
    await client.logout()
    // Back must not walk from the shop into a portal that no longer has a session.
    back.current = []
    setMe(null); setScreen(''); setParam(null)
    setPublicScreen({ name: 'home', param: null })
  }, [])

  const reload = useCallback(async () => { await loadMe() }, [loadMe])

  const navigatePublic = useCallback((name: string, p: string | null = null) => {
    const at = here.current
    if (at.kind === 'public' && at.name === name && at.param === p) return
    back.current.push(at)
    setPublicScreen({ name, param: p }); window.scrollTo(0, 0)
  }, [])

  const onSignedIn = useCallback(async () => { back.current = []; await loadMe() }, [loadMe])

  // Brand tokens come from config, not from a component. One brand today; the
  // indirection is what makes a second one a data change rather than a rewrite.
  useEffect(() => {
    const brand = me?.brand ?? FALLBACK_BRAND
    const root = document.documentElement
    root.style.setProperty('--brand-primary', brand.primaryColor)
    root.style.setProperty('--brand-primary-hover', shade(brand.primaryColor, -14))
    root.style.setProperty('--brand-secondary', brand.secondaryColor)
    root.style.setProperty('--cta-text', contrastInk(brand.primaryColor))
    document.title = me
      ? `${brand.name} · ${ROLE_THEME[me.role].label}`
      : `${brand.name} — ${brand.tagline}`
  }, [me])

  // A fresh object here re-renders every screen on every keystroke that lands
  // in App — a toast, for one. Memoised on the values that actually change.
  const session = useMemo(
    () => (me ? { me, reload, signOut, toast, go, screen, param } : null),
    [me, reload, signOut, toast, go, screen, param],
  )

  const toastTray = toasts.map(t => (
    <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')} role="status" aria-live="polite">
      {t.msg}
    </div>
  ))

  if (booting) {
    return (
      <div className="loading" style={{ paddingTop: 140 }} role="status">
        <span className="spinner dark" /> Starting…
      </div>
    )
  }

  if (!session) {
    return (
      <>
        <PublicSite
          screen={publicScreen}
          navigate={navigatePublic}
          onSignedIn={onSignedIn}
          toast={toast}
        />
        {toastTray}
      </>
    )
  }

  return (
    <SessionCtx.Provider value={session}>
      <Shell />
      {toastTray}
    </SessionCtx.Provider>
  )
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/**
 * Bottom-bar labels.
 *
 * "Browse courses" is a fine sidebar label and a terrible tab label — a tab is
 * roughly 70px wide on a 360px phone. Falls back to the server's label, so a
 * new nav entry appears correctly without a frontend change.
 */
const TAB_LABEL: Record<string, string> = {
  home: 'Home', overview: 'Home', mycourses: 'Courses', courses: 'Courses',
  browse: 'Browse', live: 'Live', recordings: 'Videos', assignments: 'Tasks',
  grading: 'Grading', progress: 'Progress', certificates: 'Awards',
  profile: 'Profile', students: 'Students', teachers: 'Teachers',
  content: 'Content', orders: 'Orders', audit: 'Activity', resources: 'Library',
}
const tabLabel = (n: NavItem) => TAB_LABEL[n.key] ?? n.label

/** Four destinations plus More. Five is the most a thumb can aim at reliably. */
const TABS = 4

function Shell() {
  const { me, screen, go, signOut } = React.useContext(SessionCtx)
  const theme = ROLE_THEME[me.role]

  const tabletUp = useMedia('(min-width: 768px)', true)
  const desktop = useMedia('(min-width: 1024px)', true)

  // Phone: an off-canvas drawer. Tablet: a rail that expands. Desktop: open.
  const [drawer, setDrawer] = useState(false)
  const [expanded, setExpanded] = useState(desktop)

  useEffect(() => { setExpanded(desktop) }, [desktop])
  // Growing past the drawer breakpoint with it open would leave the body locked.
  useEffect(() => { if (tabletUp) setDrawer(false) }, [tabletUp])
  useLockBody(drawer && !tabletUp)

  useEffect(() => {
    if (!drawer) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [drawer])

  const navKeys = useMemo(() => new Set(me.nav.map(n => n.key)), [me.nav])
  const active = navKeys.has(screen) ? screen : me.nav[0]?.key

  const visit = useCallback((key: string) => { setDrawer(false); go(key) }, [go])

  const tabs = me.nav.length <= TABS + 1 ? me.nav : me.nav.slice(0, TABS)
  const hasMore = tabs.length < me.nav.length
  const moreActive = hasMore && !tabs.some(n => n.key === active)

  // Every role has a portal now, so this is a total mapping rather than a
  // default with a placeholder behind it.
  const portal = me.role === 'BROLLY_ADMIN' ? <AdminPortal />
    : me.role === 'TEACHER' ? <TeacherPortal />
      : <StudentPortal />

  return (
    <>
      <div
        className="shell"
        data-drawer={drawer ? 'open' : 'closed'}
        data-side={expanded ? 'full' : 'rail'}
        style={{ ['--role' as any]: theme.accent, ['--role-soft' as any]: theme.accentSoft }}
      >
        <a className="skip" href="#main">Skip to content</a>

        {/* inert rather than aria-hidden: a closed drawer must be out of the
            tab order too, not merely unannounced. */}
        <aside className="side" id="app-nav" inert={!tabletUp && !drawer}>
          <div className="brand">
            <div className="mark">{me.brand.logoText}</div>
            <div className="nm">
              <span>{me.brand.name}</span>
              <small>{theme.label}</small>
            </div>
          </div>
          <nav aria-label="Sections">
            {me.nav.map(n => (
              <button
                key={n.key}
                className={active === n.key ? 'on' : ''}
                aria-current={active === n.key ? 'page' : undefined}
                onClick={() => visit(n.key)}
              >
                <Glyph className="ic">{n.icon}</Glyph>
                <span className="lb">{n.label}</span>
                <span className="lb-tight" aria-hidden="true">{tabLabel(n)}</span>
                {n.badge ? <span className="badge" aria-label={`${n.badge} waiting`}>{n.badge}</span> : null}
              </button>
            ))}
          </nav>
          <div className="sidefoot">
            <div className="who">{me.user.fullName}</div>
            <div className="meta">{me.user.email}</div>
            <button className="btn ghost sm" onClick={signOut}>Sign out</button>
          </div>
        </aside>

        <button
          className="scrim"
          aria-label="Close the menu"
          tabIndex={drawer ? 0 : -1}
          onClick={() => setDrawer(false)}
        />

        <div className="main">
          <header className="topbar">
            {tabletUp ? (
              <button
                className="iconbtn sidetoggle"
                aria-label={expanded ? 'Collapse the sidebar' : 'Expand the sidebar'}
                aria-expanded={expanded}
                aria-controls="app-nav"
                onClick={() => setExpanded(v => !v)}
              >
                <Glyph>{expanded ? '⟨' : '⟩'}</Glyph>
              </button>
            ) : (
              <button
                className="iconbtn"
                aria-label="Open the menu"
                aria-expanded={drawer}
                aria-controls="app-nav"
                onClick={() => setDrawer(true)}
              >
                <Glyph>☰</Glyph>
              </button>
            )}
            <span className="crumb">{theme.label}</span>
            <span className="spacer" />
            <Notifications />
            <span className="chip who">{me.user.fullName}</span>
          </header>

          <main className="content" id="main">
            {/* Stated on every screen, not buried in a policy page. */}
            <div className="boundary">
              <span className="eye">Can see</span>
              <span className="what">
                <strong>{me.boundary}</strong> — nothing outside this line, on any screen.
              </span>
            </div>
            {me.user.mustChangePassword ? <ChangePasswordBanner /> : null}
            {portal}
          </main>
        </div>
      </div>

      <nav className="mobnav" aria-label="Main" style={{ ['--role' as any]: theme.accent, ['--role-soft' as any]: theme.accentSoft }}>
        {tabs.map(n => (
          <button
            key={n.key}
            className={active === n.key ? 'on' : ''}
            aria-current={active === n.key ? 'page' : undefined}
            onClick={() => visit(n.key)}
          >
            <Glyph className="ic">{n.icon}</Glyph>
            <span className="lb">{tabLabel(n)}</span>
            {n.badge ? <span className="badge" aria-label={`${n.badge} waiting`}>{n.badge}</span> : null}
          </button>
        ))}
        {hasMore ? (
          <button
            className={moreActive ? 'on' : ''}
            aria-label="More sections"
            aria-expanded={drawer}
            aria-controls="app-nav"
            onClick={() => setDrawer(true)}
          >
            <Glyph className="ic">☰</Glyph>
            <span className="lb">More</span>
          </button>
        ) : null}
      </nav>
    </>
  )
}

function Notifications() {
  const { go } = React.useContext(SessionCtx)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<any[]>([])

  const close = useCallback(() => setOpen(false), [])
  const box = useDismiss(open, close)

  useEffect(() => {
    client.get('/me/notifications').then(r => setItems(r.notifications ?? [])).catch(() => {})
  }, [])

  const unread = items.filter(n => !n.read_at).length
  return (
    <div ref={box}>
      <button
        className={'chip act' + (unread ? ' warn' : '')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={async () => {
          setOpen(o => !o)
          if (!open && unread) {
            await client.post('/me/notifications/read').catch(() => {})
            setItems(items.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
          }
        }}
      >
        {unread ? `${unread} new` : 'Notifications'}
      </button>
      {open ? (
        <div className="pop" role="menu" aria-label="Notifications">
          {items.length === 0
            ? <div className="loading" style={{ padding: 24 }}>Nothing yet.</div>
            : items.map(n => (
              <button
                key={n.id}
                className="unit"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  if (n.link_screen) go(n.link_screen, n.link_param || null)
                }}
              >
                <Glyph className="num">{n.kind === 'grade' ? '✓' : n.kind === 'live' ? '◉' : '★'}</Glyph>
                <div className="body">
                  <div className="t small">{n.title}</div>
                  <div className="m">{n.body}</div>
                </div>
              </button>
            ))}
        </div>
      ) : null}
    </div>
  )
}

function ChangePasswordBanner() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="note" style={{ marginTop: 0, marginBottom: 18 }}>
        <div className="row">
          <div style={{ flex: '1 1 220px' }}>
            <strong>Change your password.</strong> You are still using the one Brolly gave you.
          </div>
          <button className="btn gold sm stack" onClick={() => setOpen(true)}>Change it now</button>
        </div>
      </div>
    )
  }
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3>Choose a new password</h3>
      <ChangePassword onDone={() => setOpen(false)} />
      <div className="row tight" style={{ marginTop: 4 }}>
        <button className="btn ghost stack" onClick={() => setOpen(false)}>Later</button>
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
  const r = clamp((n >> 16) + amount)
  const g = clamp(((n >> 8) & 255) + amount)
  const b = clamp((n & 255) + amount)
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
