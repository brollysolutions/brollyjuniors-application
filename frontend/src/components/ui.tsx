'use client'

import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
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
// Viewport and body helpers
// ---------------------------------------------------------------------------

/**
 * Matches a media query and re-renders when it flips.
 *
 * The layout decisions that CSS cannot make on its own — which nav items go on
 * the bottom bar, whether the sidebar starts as a rail — read from here, so
 * there is exactly one definition of each breakpoint on the JS side and it
 * matches the CSS.
 */
export function useMedia(query: string, fallback = false) {
  const [match, setMatch] = useState(() =>
    typeof window === 'undefined' ? fallback : window.matchMedia(query).matches)

  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])

  return match
}

/**
 * Stops the page behind a drawer or sheet from scrolling with it.
 *
 * The root gets the class too, not just body: the viewport takes its overflow
 * from the root element, so locking body on its own leaves the page free to
 * scroll behind the layer.
 */
export function useLockBody(active: boolean) {
  useEffect(() => {
    if (!active) return
    const targets = [document.documentElement, document.body]
    targets.forEach(el => el.classList.add('no-scroll'))
    return () => targets.forEach(el => el.classList.remove('no-scroll'))
  }, [active])
}

/** Escape closes; a click outside closes. Used by every transient layer. */
export function useDismiss(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', key)
    // Deferred, so the click that opened the layer does not immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', down), 0)
    return () => {
      window.removeEventListener('keydown', key)
      clearTimeout(t)
      document.removeEventListener('mousedown', down)
    }
  }, [active, onClose])
  return ref
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export const Head = ({ title, sub, right }: {
  title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode
}) => (
  <div className="sechead">
    <div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
    {right ? <div className="row tight">{right}</div> : null}
  </div>
)

export const Crumb = ({ to, label, here }: { to: string; label: string; here: string }) => {
  const { go } = useSession()
  return (
    <nav className="crumb-l" aria-label="Breadcrumb">
      <button onClick={() => go(to)}>{label}</button> / {here}
    </nav>
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

export const Bar = ({ v, label }: { v: number; label?: string }) => {
  const pct = Math.max(0, Math.min(100, Math.round(Number(v) || 0)))
  return (
    <div className="barrow">
      <div
        className="bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
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
}) => (
  <div className={`note${tone ? ' ' + tone : ''}`} role={tone === 'rose' ? 'alert' : undefined}>
    {children}
  </div>
)

/** A decorative glyph. Marked hidden so a screen reader does not read "▤". */
export const Glyph = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={className} aria-hidden="true">{children}</span>
)

/**
 * A labelled control.
 *
 * The id, the error wiring and the invalid state are attached to the child
 * input here rather than at each call site, so every field in the product is
 * announced the same way and an error is never a red border with no name.
 */
export function Field({ label, help, error, children }: {
  label: string; help?: string; error?: string; children: React.ReactNode
}) {
  const id = useId()
  const noteId = error ? `${id}-err` : help ? `${id}-help` : undefined

  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<any>, {
      id: (children.props as any).id ?? id,
      'aria-describedby': (children.props as any)['aria-describedby'] ?? noteId,
      'aria-invalid': error ? true : undefined,
    })
    : children

  return (
    <div className={'field' + (error ? ' err' : '')}>
      <label htmlFor={id}>{label}</label>
      {control}
      {error
        ? <div className="errmsg" id={noteId} role="alert"><span aria-hidden="true">!</span>{error}</div>
        : help ? <div className="help" id={noteId}>{help}</div> : null}
    </div>
  )
}

/**
 * Copies each column heading onto its cells as `data-label`.
 *
 * Below 768px the table collapses into one card per row (globals.css §6) and
 * every cell has to say which column it came from. Doing it here rather than
 * at each call site means the heading is written once and cannot drift from
 * the label the phone shows.
 */
function labelCells(head: React.ReactNode[], rows: React.ReactNode) {
  return React.Children.map(rows, row => {
    if (!React.isValidElement(row)) return row
    const cells = React.Children.map((row.props as any).children, (cell, i) => {
      if (!React.isValidElement(cell)) return cell
      const label = head[i]
      if (typeof label !== 'string' || !label.trim()) return cell
      return React.cloneElement(cell as React.ReactElement<any>, { 'data-label': label })
    })
    return React.cloneElement(row as React.ReactElement<any>, undefined, cells)
  })
}

export const Table = ({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) => (
  <div className="tablewrap">
    <table>
      <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
      <tbody>{labelCells(head, children)}</tbody>
    </table>
  </div>
)

export const Loading = ({ what = 'Loading' }: { what?: string }) => (
  <div className="loading" role="status"><span className="spinner dark" /> {what}…</div>
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

/**
 * A dialog on a laptop, a bottom sheet on a phone — one component, because the
 * difference is presentation and lives in CSS.
 *
 * Focus moves in on open and back to whatever opened it on close, the page
 * behind it stops scrolling, and Escape or a tap on the backdrop closes it.
 */
export function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useLockBody(true)

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      opener.current?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panel}
      >
        <div className="sechead" style={{ marginTop: 0 }}>
          <div><h2 id={titleId}>{title}</h2></div>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** A button that shows it is working and cannot be double-fired. */
export function Action({ label, working, onClick, kind = 'gold', disabled, small, wide, title }: {
  label: string
  working?: string
  onClick: () => void | Promise<void>
  kind?: 'gold' | 'ghost' | 'dark'
  disabled?: boolean
  small?: boolean
  /** Full width — the right shape for a primary action on a phone. */
  wide?: boolean
  title?: string
}) {
  const [busy, setBusy] = useState(false)
  // type="button" below is load-bearing: an Action inside a <form> would
  // otherwise fire its own onClick and submit the form, sending the request
  // twice. Enter in a field still submits, which is what puts "Go" on a phone
  // keyboard.
  const cls = [
    'btn',
    kind === 'gold' ? 'gold' : kind === 'ghost' ? 'ghost' : '',
    small ? 'sm' : '',
    wide ? 'wide' : 'stack',
  ].filter(Boolean).join(' ')

  return (
    <button
      className={cls}
      type="button"
      disabled={busy || disabled}
      title={title}
      aria-busy={busy || undefined}
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

  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { ...state, reload }
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
