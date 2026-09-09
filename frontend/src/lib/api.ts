'use client'

/**
 * API client.
 *
 * The access token lives in memory only — never localStorage, which is
 * XSS-readable. The refresh token is an HttpOnly cookie the browser sends on
 * its own, which is why a reload can restore a session without the app ever
 * holding a long-lived credential.
 *
 * On the web, Next rewrites /api/* to the FastAPI service, so every request
 * below is same-origin and the cookie travels without CORS credentials games.
 * In the Capacitor app there is no proxy, so the same calls go straight to the
 * API host with credentials: 'include'. Both cases are resolved by
 * platform.ts; nothing else in the app has to know which one it is in.
 */
import { apiBase, credentialsMode } from './platform'

/** Absolute in the app, relative on the web. `path` is relative to /api/v1. */
const apiUrl = (path: string) => `${apiBase()}/api/v1${path}`

let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null

export const setToken = (t: string | null) => { accessToken = t }
export const hasToken = () => !!accessToken

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.status = status
    this.code = code
  }
}

async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch(apiUrl('/auth/refresh'), {
          method: 'POST',
          credentials: credentialsMode(),
        })
        if (!r.ok) return false
        const j = await r.json()
        accessToken = j.accessToken
        return true
      } catch {
        return false
      } finally {
        setTimeout(() => { refreshing = null }, 0)
      }
    })()
  }
  return refreshing
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: credentialsMode(),
    headers: {
      // FormData sets its own content-type, boundary and all. Overriding it
      // with application/json makes the body unparseable at the other end.
      ...(init.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  })
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init)

  // Access tokens last ten minutes; a silent refresh is the normal case, not
  // an error path, so it must not surface to the user.
  if (res.status === 401 && await refresh()) res = await raw(path, init)

  if (!res.ok) {
    let detail = 'Something went wrong.'
    let code = 'error'
    try {
      const j = await res.json()
      detail = j.detail ?? j.message ?? detail
      code = j.code ?? code
    } catch { /* non-JSON error */ }
    throw new ApiError(res.status, code, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/**
 * A link the browser can fetch, from the relative one the API returns.
 * Same reasoning as apiBase(): same-origin on the web, absolute in the app.
 */
export const mediaUrl = (u: string) =>
  !u || /^https?:[/][/]/.test(u) ? u : `${apiBase()}${u}`

/** Multipart upload. The browser sets the multipart boundary itself. */
export const upload = <T = any>(p: string, file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api<T>(p, { method: 'POST', body: form })
}

export const get = <T = any>(p: string) => api<T>(p)
export const post = <T = any>(p: string, body?: unknown) =>
  api<T>(p, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' })

export const patch = <T = any>(p: string, body: unknown) =>
  api<T>(p, { method: 'PATCH', body: JSON.stringify(body) })

export async function login(body: { email: string; password: string }) {
  const r = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    credentials: credentialsMode(),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new ApiError(r.status, j.code ?? 'error', j.detail ?? 'Could not sign in.')
  accessToken = j.accessToken
  return j
}

export async function register(body: {
  fullName: string
  email: string
  password: string
  gradeLevel?: string
  guardianName?: string
  guardianEmail?: string
}) {
  const r = await fetch(apiUrl('/auth/register'), {
    method: 'POST',
    credentials: credentialsMode(),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) {
    throw new ApiError(r.status, j.code ?? 'error', j.detail ?? 'Could not create your account.')
  }
  accessToken = j.accessToken
  return j
}

export async function logout() {
  try {
    await fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: credentialsMode() })
  } catch { /* offline */ }
  accessToken = null
}

/** Try to restore a session on load, using only the HttpOnly refresh cookie. */
export const restore = () => refresh()
