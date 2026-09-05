import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Bootstrap } from '@brolly/shared'
import { ROLE_THEME } from '@brolly/shared'
import * as client from './api.ts'
import { SessionCtx, Field, Action, Loading } from './ui.tsx'
import BrollyPortal from './portals/brolly.tsx'
import SchoolPortal from './portals/school.tsx'
import TeacherPortal from './portals/teacher.tsx'
import StudentPortal from './portals/student.tsx'

// ---------------------------------------------------------------------------

export default function App() {
  const [me, setMe] = useState<Bootstrap | null>(null)
  const [booting, setBooting] = useState(true)
  const [screen, setScreen] = useState('')
  const [param, setParam] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; bad?: boolean }>>([])

  const loadMe = useCallback(async () => {
    const b = await client.get<Bootstrap>('/me/bootstrap')
    setMe(b)
    setScreen(s => s || b.nav[0]?.key || 'overview')
    return b
  }, [])

  // A reload restores the session from the HttpOnly refresh cookie alone.
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
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200)
  }, [])

  const go = useCallback((s: string, p: string | null = null) => {
    setScreen(s); setParam(p); window.scrollTo(0, 0)
  }, [])

  const signOut = useCallback(async () => {
    await client.logout()
    setMe(null); setScreen(''); setParam(null)
  }, [])

  // Branding is applied by writing custom properties. A school's look is a
  // database row; there is no per-tenant stylesheet and no build step.
  useEffect(() => {
    const root = document.documentElement
    if (!me) {
      root.style.removeProperty('--brand-primary')
      root.style.removeProperty('--brand-secondary')
      document.title = 'Brolly — Python & AI for schools'
      return
    }
    root.style.setProperty('--brand-primary', me.branding.primaryColor)
    root.style.setProperty('--brand-primary-hover', shade(me.branding.primaryColor, -14))
    root.style.setProperty('--brand-secondary', me.branding.secondaryColor)
    root.style.setProperty('--cta-text', contrastInk(me.branding.primaryColor))
    document.title = `${me.branding.displayName} · Brolly`
  }, [me])

  if (booting) return <div className="loading" style={{ paddingTop: 120 }}><span className="spinner dark" /> Starting…</div>
  if (!me) return <Login onDone={loadMe} />

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
  const roleKey = me.scope === 'platform' ? 'BROLLY_ADMIN'
    : me.roles.includes('SCHOOL_ADMIN') ? 'SCHOOL_ADMIN'
    : me.roles.includes('TEACHER') ? 'TEACHER' : 'STUDENT'
  const theme = ROLE_THEME[roleKey]

  const Portal = roleKey === 'BROLLY_ADMIN' ? BrollyPortal
    : roleKey === 'SCHOOL_ADMIN' ? SchoolPortal
    : roleKey === 'TEACHER' ? TeacherPortal : StudentPortal

  const navKeys = useMemo(() => new Set(me.nav.map(n => n.key)), [me.nav])
  const activeTop = navKeys.has(screen) ? screen : me.nav[0]?.key

  return (
    <>
      <div className="shell" style={{ ['--role' as any]: theme.accent, ['--role-soft' as any]: theme.accentSoft }}>
        <aside className="side">
          <div className="brand">
            <div className="mark">{me.branding.logoText}</div>
            <div className="nm">
              <span>{me.branding.shortName || me.branding.displayName}</span>
              <small>{theme.label}</small>
            </div>
          </div>
          <nav>
            {me.nav.map(n => (
              <button key={n.key} className={activeTop === n.key ? 'on' : ''} onClick={() => go(n.key)}>
                <span className="ic">{n.icon}</span>{n.label}
                {n.badge ? <span className="badge">{n.badge}</span> : null}
              </button>
            ))}
          </nav>
          <div className="sidefoot">
            <div className="who">{me.user.fullName}</div>
            {me.tenant.isPlatform ? me.tenant.area : me.tenant.name}
            <div style={{ marginTop: 8 }}>
              <button className="btn ghost sm" onClick={signOut}>Sign out</button>
            </div>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <span className="crumb">{theme.label}</span>
            <span className="spacer" />
            {me.scope === 'platform'
              ? <span className="chip">Synced from the Content Hub</span>
              : <span className="chip">{me.tenant.schoolCode}</span>}
            <span className="chip">{me.user.fullName}</span>
          </div>
          <div className="content">
            {/* The boundary is stated on every screen, not buried in a policy page. */}
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
          <button key={n.key} className={activeTop === n.key ? 'on' : ''} onClick={() => go(n.key)}>{n.label}</button>
        ))}
      </div>
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
          <strong>Change your password.</strong> You are still using the one you were given.
        </div>
        <button className="btn gold sm" onClick={() => setOpen(true)}>Change it now</button>
      </div>
    )
  }
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3>Choose a new password</h3>
      <div className="sub" style={{ marginBottom: 12 }}>
        At least 8 characters. A short phrase you will remember is better than something with symbols you will forget.
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

const DEMO = [
  { n: '01', role: 'Brolly admin', desc: 'All schools · counts, usage, licences', colour: '#2B6CB0',
    creds: { identifier: 'admin@brollysoftware.com', password: 'brolly' } },
  { n: '02', role: 'School admin', desc: 'One school · teachers, students, classes', colour: '#725AB4',
    creds: { identifier: 'principal@vidyavihar.edu.in', password: 'brolly' } },
  { n: '03', role: 'Teacher', desc: 'Their classes · progress, labs, exams', colour: '#157D77',
    creds: { identifier: 'sneha.r@vidyavihar.edu.in', password: 'brolly' } },
  { n: '04', role: 'Student & parent', desc: 'Lessons, labs, exams, results', colour: '#96630A',
    creds: { schoolCode: 'VVHS-KUK', identifier: '9A-04', password: 'student' } },
]

function Login({ onDone }: { onDone: () => Promise<unknown> }) {
  const [schoolCode, setSchoolCode] = useState('VVHS-KUK')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [branding, setBranding] = useState<any>(null)

  // The login page is branded from the school code alone, before anyone is
  // authenticated — the only tenant fact a stranger is allowed to learn.
  useEffect(() => {
    const code = schoolCode.trim()
    if (code.length < 3) { setBranding(null); return }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/v1/public/branding?schoolCode=${encodeURIComponent(code)}`)
        const j = await r.json()
        setBranding(j.branding)
      } catch { setBranding(null) }
    }, 250)
    return () => clearTimeout(t)
  }, [schoolCode])

  useEffect(() => {
    const root = document.documentElement
    if (branding?.primaryColor) {
      root.style.setProperty('--brand-primary', branding.primaryColor)
      root.style.setProperty('--brand-secondary', branding.secondaryColor)
      root.style.setProperty('--cta-text', contrastInk(branding.primaryColor))
    }
  }, [branding])

  const submit = async (creds?: { schoolCode?: string; identifier: string; password: string }) => {
    setErr('')
    try {
      await client.login(creds ?? { schoolCode: schoolCode.trim() || undefined, identifier, password })
      await onDone()
    } catch (e: any) { setErr(e.message ?? 'Could not sign in.') }
  }

  return (
    <div className="login">
      <div className="left">
        <div className="kicker">Brolly Software Solutions · Hyderabad</div>
        <h1>{branding ? branding.welcomeMessage : 'Python & AI, run by the school.'}</h1>
        <p>
          One platform, four logins. Every school sees only its own students, its own teachers,
          its own results — and nothing past that line.
        </p>
        <div className="roles">
          {DEMO.map(d => (
            <button key={d.n} onClick={() => submit(d.creds)}>
              <span className="n" style={{ color: d.colour }}>{d.n}</span>
              <span>
                <span className="t">{d.role}</span><br />
                <span className="s">{d.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="tiny muted" style={{ marginTop: 18 }}>
          Demo logins. Staff use <span className="mono">brolly</span>, students use <span className="mono">student</span>.
        </p>
      </div>

      <div className="right">
        <div className="form">
          <div className="brand" style={{ paddingLeft: 0 }}>
            <div className="mark">{branding?.logoText ?? 'B'}</div>
            <div className="nm">
              <span>{branding?.displayName ?? 'Brolly'}</span>
              <small>School platform</small>
            </div>
          </div>
          {branding?.area ? <p className="tiny muted" style={{ marginTop: -8, marginBottom: 14 }}>{branding.area}</p> : null}

          <Field label="School code" help="Students sign in with this and their roll number. Staff can leave it blank and use their email.">
            <input value={schoolCode} onChange={e => setSchoolCode(e.target.value)} placeholder="VVHS-KUK" />
          </Field>
          <Field label="Username or email">
            <input value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="9A-04"
              onKeyDown={e => { if (e.key === 'Enter') submit() }} />
          </Field>
          <Field label="Password" error={err}>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }} />
          </Field>
          <Action label="Sign in" kind="dark" onClick={() => submit()} />
          <p className="tiny muted" style={{ marginTop: 14 }}>
            Most students do not have an email address, so they sign in with a school code and roll number.
            Parents use the same login to follow their child.
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Darken or lighten a validated hex colour for the hover state. */
function shade(hex: string, amount: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const clamp = (v: number) => Math.max(0, Math.min(255, v))
  const r = clamp((n >> 16) + amount), g = clamp(((n >> 8) & 255) + amount), b = clamp((n & 255) + amount)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

/** Pick ink or white for text on a brand colour, so contrast survives rebranding. */
function contrastInk(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#1E293B'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.45 ? '#1E293B' : '#FFFFFF'
}
