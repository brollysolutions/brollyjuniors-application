'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Bootstrap } from '@/lib/types'
import { FALLBACK_BRAND, formatPrice } from '@/lib/types'

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

type Ctx = {
  me: Bootstrap
  reload: () => Promise<void>
  signOut: () => void
  toast: (msg: string, bad?: boolean) => void
  go: (screen: string, param?: string | null) => void
  screen: string
  param: string | null
}
export const SessionCtx = createContext<Ctx>(null as any)
export const useSession = () => useContext(SessionCtx)

/**
 * The three primitives that express every role difference in the UI. There is
 * no `if (isAdmin)` anywhere; there is only "may you", "is it on", and "what is
 * this brand called".
 */
export function Can({ permission, children, fallback = null }: {
  permission: string; children: React.ReactNode; fallback?: React.ReactNode
}) {
  const { me } = useSession()
  return <>{me.permissions.includes(permission) ? children : fallback}</>
}

export function Feature({ flag, children, fallback = null }: {
  flag: string; children: React.ReactNode; fallback?: React.ReactNode
}) {
  const { me } = useSession()
  return <>{me.features.includes(flag) ? children : fallback}</>
}

export const useCan = () => {
  const { me } = useSession()
  return useCallback((p: string) => me.permissions.includes(p), [me.permissions])
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export const Head = ({ title, sub, right }: {
  title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode
}) => (
  <div className="sechead">
    <div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
    <div className="spacer" />
    {right}
  </div>
)

export const Crumb = ({ to, label, here }: { to: string; label: string; here: string }) => {
  const { go } = useSession()
  return (
    <div className="crumb-l">
      <button onClick={() => go(to)}>{label}</button> / {here}
    </div>
  )
}

export const Stat = ({ k, v, d, small }: {
  k: string; v: React.ReactNode; d?: React.ReactNode; small?: boolean
}) => (
  <div className="card stat">
    <div className="k">{k}</div>
    <div className={'v' + (small ? ' small' : '')}>{v}</div>
    {d ? <div className="d">{d}</div> : null}
  </div>
)

export const Bar = ({ v }: { v: number }) => {
  const pct = Math.max(0, Math.min(100, Math.round(Number(v) || 0)))
  return (
    <div className="barrow">
      <div className="bar">
        <i className={pct < 35 ? 'low' : pct < 70 ? 'mid' : ''} style={{ width: `${pct}%` }} />
      </div>
      <span>{pct}%</span>
    </div>
  )
}

export const Pill = ({ tone = 'mute', children }: {
  tone?: 'ok' | 'wait' | 'bad' | 'mute'; children: React.ReactNode
}) => <span className={`pill ${tone}`}>{children}</span>

export const Note = ({ tone, children }: {
  tone?: 'teal' | 'rose'; children: React.ReactNode
}) => <div className={`note${tone ? ' ' + tone : ''}`}>{children}</div>

export function Field({ label, help, error, children }: {
  label: string; help?: string; error?: string; children: React.ReactNode
}) {
  return (
    <div className={'field' + (error ? ' err' : '')}>
      <label>{label}</label>
      {children}
      {error ? <div className="errmsg">{error}</div> : help ? <div className="help">{help}</div> : null}
    </div>
  )
}

export const Table = ({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) => (
  <div className="tablewrap">
    <table>
      <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

export const Loading = ({ what = 'Loading' }: { what?: string }) => (
  <div className="loading"><span className="spinner dark" /> {what}…</div>
)

export function Empty({ title, detail, action }: {
  title: string; detail?: string; action?: React.ReactNode
}) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '34px 20px' }}>
      <h3>{title}</h3>
      {detail ? (
        <div className="sub" style={{ marginTop: 6, maxWidth: '46ch', marginInline: 'auto' }}>
          {detail}
        </div>
      ) : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  )
}

export function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="panel">
        <div className="sechead" style={{ marginTop: 0 }}>
          <h2>{title}</h2><div className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** A button that shows it is working and cannot be double-fired. */
export function Action({ label, working, onClick, kind = 'gold', disabled, small, title }: {
  label: string
  working?: string
  onClick: () => void | Promise<void>
  kind?: 'gold' | 'ghost' | 'dark'
  disabled?: boolean
  small?: boolean
  title?: string
}) {
  const [busy, setBusy] = useState(false)
  const cls = `btn ${kind === 'gold' ? 'gold' : kind === 'ghost' ? 'ghost' : ''}${small ? ' sm' : ''}`
  return (
    <button
      className={cls}
      disabled={busy || disabled}
      title={title}
      onClick={async () => { setBusy(true); try { await onClick() } finally { setBusy(false) } }}
    >
      {busy ? <><span className="spinner" /> {working ?? label}</> : label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>(
    { data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    setState(s => ({ ...s, loading: true, error: null }))
    fn().then(
      data => { if (live) setState({ data, error: null, loading: false }) },
      err => {
        if (live) setState({ data: null, error: err.message ?? 'Could not load this.', loading: false })
      },
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { ...state, reload: () => setNonce(n => n + 1) }
}

/** Standard page body: spinner, then error, then content. */
export function Page<T>({ q, children, what }: {
  q: { data: T | null; error: string | null; loading: boolean }
  children: (d: T) => React.ReactNode
  what?: string
}) {
  if (q.loading && !q.data) return <Loading what={what} />
  if (q.error) return <Note tone="rose"><strong>{q.error}</strong></Note>
  if (!q.data) return null
  return <>{children(q.data)}</>
}

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export function fmtAgo(d: string | null | undefined) {
  if (!d) return 'Never'
  const ms = Date.now() - new Date(d).getTime()
  const days = Math.floor(ms / 864e5)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return fmtDate(d)
}

/** Money, formatted from the brand's currency. Never a hard-coded symbol. */
export const price = (minor: number) => formatPrice(minor, FALLBACK_BRAND)

export const duration = (seconds: number) => {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

export const mmss = (secs: number) =>
  `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.floor(Math.max(0, secs) % 60)).padStart(2, '0')}`
