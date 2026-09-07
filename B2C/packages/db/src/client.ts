/**
 * Every query runs as somebody.
 *
 * Application code never opens a connection. It calls withActor() or
 * withAnon(), which wrap the work in a transaction that has already dropped to
 * the non-superuser `brolly_app` role and pinned who is asking. A handler that
 * forgets an entitlement check is therefore survivable: the database still
 * refuses to return a course the student has not bought (003_rls.sql).
 *
 * Two drivers, one dialect:
 *   DB_DRIVER=pglite  (default)  real PostgreSQL 16 in WebAssembly, no install
 *   DB_DRIVER=pg                 a real server via DATABASE_URL
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type Row = Record<string, any>

export interface Conn {
  query<T = Row>(text: string, params?: any[]): Promise<T[]>
  exec(text: string): Promise<void>
}

export type ActorRole = 'BROLLY_ADMIN' | 'TEACHER' | 'STUDENT' | 'ANON'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DB_ROOT = path.resolve(HERE, '..')
export const DATA_DIR = process.env.BROLLY_DATA_DIR ?? path.resolve(DB_ROOT, '../../.data/brolly-b2c')

const DRIVER = (process.env.DB_DRIVER ?? 'pglite') as 'pglite' | 'pg'

// --- PGlite: one connection, so transactions must not interleave -------------
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

// --- node-postgres -----------------------------------------------------------
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

function wrapPglite(db: any): Conn {
  return {
    async query<T = Row>(text: string, params: any[] = []) {
      const r = await db.query(text, params)
      return (r.rows ?? []) as T[]
    },
    async exec(text: string) { await db.exec(text) },
  }
}

function wrapPgClient(client: any): Conn {
  return {
    async query<T = Row>(text: string, params: any[] = []) {
      const r = await client.query(text, params)
      return (r.rows ?? []) as T[]
    },
    async exec(text: string) { await client.query(text) },
  }
}

/**
 * Migration and seed only. Runs as the owning superuser, so RLS does not apply.
 * Login is the one runtime caller: it must find a user before it knows who they
 * are, which is the whole of the chicken-and-egg problem in authentication.
 */
export async function withAdmin<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
  if (DRIVER === 'pglite') {
    const db = await pglite()
    return serialize(() => fn(wrapPglite(db)))
  }
  const pool = await pgPool()
  const client = await pool.connect()
  try { return await fn(wrapPgClient(client)) } finally { client.release() }
}

async function runAs<T>(userId: string | null, role: ActorRole, fn: (c: Conn) => Promise<T>): Promise<T> {
  const body = async (conn: Conn) => {
    await conn.exec('BEGIN')
    try {
      await conn.exec('SET LOCAL ROLE brolly_app')
      await conn.query('SELECT set_config($1, $2, true)', ['app.user_id', userId ?? ''])
      await conn.query('SELECT set_config($1, $2, true)', ['app.role', role])
      const out = await fn(conn)
      await conn.exec('COMMIT')
      return out
    } catch (err) {
      try { await conn.exec('ROLLBACK') } catch { /* already unwound */ }
      throw err
    }
  }

  if (DRIVER === 'pglite') {
    const db = await pglite()
    return serialize(() => body(wrapPglite(db)))
  }
  const pool = await pgPool()
  const client = await pool.connect()
  try { return await body(wrapPgClient(client)) } finally { client.release() }
}

/** Every authenticated request. */
export function withActor<T>(userId: string, role: ActorRole, fn: (c: Conn) => Promise<T>) {
  if (!userId) throw new Error('withActor called without a user')
  return runAs(userId, role, fn)
}

/** The public catalogue, and nothing else. Sees published structure only. */
export function withAnon<T>(fn: (c: Conn) => Promise<T>) {
  return runAs(null, 'ANON', fn)
}

export async function closeDb() {
  if (pglitePromise) { const db = await pglitePromise; await db.close?.(); pglitePromise = null }
  if (pgPoolPromise) { const pool = await pgPoolPromise; await pool.end?.(); pgPoolPromise = null }
}

export const driverName = DRIVER
