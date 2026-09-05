/**
 * Isolation layer 2 lives here.
 *
 * Application code never opens a connection. It calls withTenant() or
 * withPlatform(), which wrap every statement in a transaction that has already
 * dropped to the non-superuser `brolly_app` role and pinned app.tenant_id.
 * Forgetting a tenant filter in a query is therefore survivable: the database
 * still refuses to return another school's rows (layer 3, 003_rls.sql).
 *
 * Two drivers, one SQL dialect:
 *   DB_DRIVER=pglite  (default)  real PostgreSQL 16 compiled to WASM, no install
 *   DB_DRIVER=pg                 a real server via DATABASE_URL
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type Row = Record<string, any>

export interface Conn {
  query<T = Row>(text: string, params?: any[]): Promise<T[]>
  exec(text: string): Promise<void>
}

export interface ActorContext {
  tenantId: string | null
  userId: string | null
  scope: 'tenant' | 'platform'
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DB_ROOT = path.resolve(HERE, '..')
export const DATA_DIR = process.env.BROLLY_DATA_DIR ?? path.resolve(DB_ROOT, '../../.data/brolly')

const DRIVER = (process.env.DB_DRIVER ?? 'pglite') as 'pglite' | 'pg'

// ---------------------------------------------------------------------------
// PGlite: one connection, so transactions must not interleave. A promise chain
// is the whole mutex; it costs nothing at the volumes a single school produces.
// ---------------------------------------------------------------------------

let pglitePromise: Promise<any> | null = null
let queue: Promise<unknown> = Promise.resolve()

async function pglite() {
  if (!pglitePromise) {
    pglitePromise = (async () => {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(DATA_DIR, { recursive: true })   // PGlite's own mkdir is not recursive
      const { PGlite } = await import('@electric-sql/pglite')
      return new PGlite(DATA_DIR)
    })()
  }
  return pglitePromise
}

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.then(() => undefined, () => undefined)
  return run
}

// ---------------------------------------------------------------------------
// node-postgres
// ---------------------------------------------------------------------------

let pgPoolPromise: Promise<any> | null = null

async function pgPool() {
  if (!pgPoolPromise) {
    pgPoolPromise = (async () => {
      const pg = await import('pg')
      const Pool = (pg.default ?? pg).Pool
      return new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
    })()
  }
  return pgPoolPromise
}

// ---------------------------------------------------------------------------

function wrapPglite(db: any): Conn {
  return {
    async query<T = Row>(text: string, params: any[] = []) {
      const r = await db.query(text, params)
      return (r.rows ?? []) as T[]
    },
    async exec(text: string) {
      await db.exec(text)
    },
  }
}

function wrapPgClient(client: any): Conn {
  return {
    async query<T = Row>(text: string, params: any[] = []) {
      const r = await client.query(text, params)
      return (r.rows ?? []) as T[]
    },
    async exec(text: string) {
      await client.query(text)
    },
  }
}

/**
 * Run as the migration/seed superuser. RLS does not apply. Only migrate.ts,
 * seed.ts and the login lookup (which must find a user before a tenant is
 * known) are allowed to use this — see `unsafeAdmin` call sites.
 */
export async function withAdmin<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
  if (DRIVER === 'pglite') {
    const db = await pglite()
    return serialize(() => fn(wrapPglite(db)))
  }
  const pool = await pgPool()
  const client = await pool.connect()
  try {
    return await fn(wrapPgClient(client))
  } finally {
    client.release()
  }
}

async function runScoped<T>(actor: ActorContext, fn: (c: Conn) => Promise<T>): Promise<T> {
  const body = async (conn: Conn) => {
    await conn.exec('BEGIN')
    try {
      // Drop out of superuser so RLS applies. On a real deployment the app
      // already connects as brolly_app and this is a harmless no-op.
      await conn.exec('SET LOCAL ROLE brolly_app')
      await conn.query('SELECT set_config($1, $2, true)', ['app.tenant_id', actor.tenantId ?? ''])
      await conn.query('SELECT set_config($1, $2, true)', ['app.user_id', actor.userId ?? ''])
      await conn.query('SELECT set_config($1, $2, true)', ['app.scope', actor.scope])
      const out = await fn(conn)
      await conn.exec('COMMIT')
      return out
    } catch (err) {
      try { await conn.exec('ROLLBACK') } catch { /* connection already unwound */ }
      throw err
    }
  }

  if (DRIVER === 'pglite') {
    const db = await pglite()
    return serialize(() => body(wrapPglite(db)))
  }
  const pool = await pgPool()
  const client = await pool.connect()
  try {
    return await body(wrapPgClient(client))
  } finally {
    client.release()
  }
}

/** Every request from a school user goes through here. */
export function withTenant<T>(tenantId: string, userId: string | null, fn: (c: Conn) => Promise<T>) {
  if (!tenantId) throw new Error('withTenant called without a tenant')
  return runScoped({ tenantId, userId, scope: 'tenant' }, fn)
}

/** Brolly admin. Can manage schools and read counts; cannot read student work. */
export function withPlatform<T>(userId: string | null, fn: (c: Conn) => Promise<T>) {
  return runScoped({ tenantId: null, userId, scope: 'platform' }, fn)
}

/**
 * Brolly admin acting inside one school (support / impersonation-lite).
 * Tenant is pinned AND platform scope is dropped, so the same rules that apply
 * to a school admin apply here. Always audited by the caller.
 */
export function withPlatformInTenant<T>(tenantId: string, userId: string | null, fn: (c: Conn) => Promise<T>) {
  return runScoped({ tenantId, userId, scope: 'tenant' }, fn)
}

export async function closeDb() {
  if (pglitePromise) {
    const db = await pglitePromise
    await db.close?.()
    pglitePromise = null
  }
  if (pgPoolPromise) {
    const pool = await pgPoolPromise
    await pool.end?.()
    pgPoolPromise = null
  }
}

export const driverName = DRIVER
