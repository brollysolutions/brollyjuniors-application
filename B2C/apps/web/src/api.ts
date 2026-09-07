/**
 * API client.
 *
 * The access token lives in memory only — never localStorage, which is
 * XSS-readable. The refresh token is an HttpOnly cookie the browser sends on
 * its own, which is why a reload can restore a session without the app ever
 * holding a long-lived credential.
 */

let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null

export const setToken = (t: string | null) => { accessToken = t }
export const hasToken = () => !!accessToken

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, detail: string) {
    super(detail); this.status = status; this.code = code
  }
}

async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' })
        if (!r.ok) return false
        const j = await r.json()
        accessToken = j.accessToken
        return true
      } catch { return false }
      finally { setTimeout(() => { refreshing = null }, 0) }
    })()
  }
  return refreshing
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
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

export const get = <T = any>(p: string) => api<T>(p)
export const post = <T = any>(p: string, body?: unknown) =>
  api<T>(p, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
export const patch = <T = any>(p: string, body: unknown) =>
  api<T>(p, { method: 'PATCH', body: JSON.stringify(body) })
export const put = <T = any>(p: string, body: unknown) =>
  api<T>(p, { method: 'PUT', body: JSON.stringify(body) })

export async function login(body: { email: string; password: string }) {
  const r = await fetch('/api/v1/auth/login', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new ApiError(r.status, j.code ?? 'error', j.detail ?? 'Could not sign in.')
  accessToken = j.accessToken
  return j
}

export async function register(body: {
  fullName: string; email: string; password: string
  gradeLevel?: string; guardianName?: string; guardianEmail?: string
}) {
  const r = await fetch('/api/v1/auth/register', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new ApiError(r.status, j.code ?? 'error', j.detail ?? 'Could not create your account.')
  accessToken = j.accessToken
  return j
}

export async function logout() {
  try { await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }) } catch { /* offline */ }
  accessToken = null
}

/** Try to restore a session on load, using only the HttpOnly refresh cookie. */
export const restore = () => refresh()
