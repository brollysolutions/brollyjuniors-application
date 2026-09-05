import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { withAdmin, withTenant, hashPassword, verifyPassword, sha256, type Conn } from '@brolly/db'
import { env } from '../env.ts'
import { badRequest, locked, tooMany, unauthorized } from '../http.ts'
import { signAccessToken, newRefreshToken } from '../tokens.ts'
import { loadAccess, invalidateAccess } from '../access.ts'
import { audit } from '../audit.ts'
import { publicRoute, requires } from '../guards.ts'

// ---------------------------------------------------------------------------
// Login throttling. Applied to unknown accounts too, in the same shape, so the
// endpoint cannot be used to discover which usernames exist.
// ---------------------------------------------------------------------------
const attempts = new Map<string, { n: number; until: number }>()
function throttle(key: string) {
  const rec = attempts.get(key)
  if (rec && rec.until > Date.now()) throw tooMany()
  return rec
}
function recordFailure(key: string) {
  const rec = attempts.get(key) ?? { n: 0, until: 0 }
  rec.n += 1
  // 1s, 2s, 4s ... capped, then a hard 15-minute lock after 10 failures
  rec.until = Date.now() + (rec.n >= 10 ? 15 * 60_000 : Math.min(30_000, 2 ** Math.max(0, rec.n - 3) * 1000))
  attempts.set(key, rec)
}
const clearFailures = (key: string) => attempts.delete(key)

/**
 * THE ONE PRE-TENANT LOOKUP.
 *
 * Login is the only moment the app must find a user before it knows which
 * school the request belongs to, so it is the only place that reads outside a
 * tenant transaction. It selects nothing but the columns needed to authenticate,
 * and everything after this point runs inside withTenant().
 */
async function lookupLogin(schoolCode: string | undefined, identifier: string) {
  return withAdmin(async c => {
    if (schoolCode) {
      const rows = await c.query<any>(
        `SELECT u.id, u.tenant_id, u.password_hash, u.status, u.perm_version, u.must_change_pw,
                u.full_name, t.status AS tenant_status, t.name AS tenant_name
           FROM app_user u JOIN tenant t ON t.id = u.tenant_id
          WHERE lower(t.school_code) = lower($1)
            AND (lower(u.username) = lower($2) OR lower(u.email) = lower($2))
            AND u.deleted_at IS NULL
          LIMIT 1`,
        [schoolCode, identifier])
      return rows[0] ?? null
    }
    const rows = await c.query<any>(
      `SELECT u.id, u.tenant_id, u.password_hash, u.status, u.perm_version, u.must_change_pw,
              u.full_name, t.status AS tenant_status, t.name AS tenant_name
         FROM app_user u JOIN tenant t ON t.id = u.tenant_id
        WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL
        LIMIT 1`,
      [identifier])
    return rows[0] ?? null
  })
}

async function issueSession(
  c: Conn, tenantId: string, userId: string, isStaff: boolean,
  meta: { ip: string; ua: string }, familyId = randomUUID(),
) {
  const refresh = newRefreshToken()
  const ttlMs = isStaff ? env.staffRefreshTokenHours * 3600_000 : env.refreshTokenDays * 864e5
  const sessionId = randomUUID()
  await c.query(
    `INSERT INTO session (id, tenant_id, user_id, refresh_token_hash, family_id, user_agent, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [sessionId, tenantId, userId, sha256(refresh), familyId, meta.ua.slice(0, 250), meta.ip,
      new Date(Date.now() + ttlMs).toISOString()])
  return { sessionId, refresh, familyId }
}

export default async function authRoutes(app: FastifyInstance) {
  const cookieOpts = {
    httpOnly: true, sameSite: 'lax' as const, secure: env.isProd,
    path: '/api/v1/auth', maxAge: env.refreshTokenDays * 86400,
  }

  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/login', publicRoute, async (req, reply) => {
    const body = (req.body ?? {}) as { schoolCode?: string; identifier?: string; password?: string }
    const identifier = (body.identifier ?? '').trim()
    const password = body.password ?? ''
    const schoolCode = (body.schoolCode ?? '').trim() || undefined
    if (!identifier || !password) throw badRequest('Enter your username and password.')

    const key = `${req.ip}|${schoolCode ?? ''}|${identifier.toLowerCase()}`
    throttle(key)

    const user = await lookupLogin(schoolCode, identifier)

    // Constant-shape failure: an unknown account costs the same work and
    // returns the same message as a wrong password.
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')

    if (!user || !ok) {
      recordFailure(key)
      throw unauthorized('That username or password is not right.')
    }
    if (user.status !== 'active') throw locked('This login has been deactivated. Ask your school admin.', 'user_disabled')
    if (user.tenant_status === 'suspended') throw locked('Your school’s access is suspended.', 'tenant_suspended')
    if (user.tenant_status === 'archived') throw locked('Your school is no longer active.', 'tenant_archived')

    clearFailures(key)

    const access = await loadAccess(user.tenant_id, user.id)
    if (!access) throw unauthorized()
    const isStaff = access.roles.some(r => r !== 'STUDENT')
    const scope: 'tenant' | 'platform' = access.isPlatform ? 'platform' : 'tenant'

    const { sessionId, refresh } = await withTenant(user.tenant_id, user.id, async c => {
      const s = await issueSession(c, user.tenant_id, user.id, isStaff, {
        ip: req.ip, ua: String(req.headers['user-agent'] ?? ''),
      })
      await c.query('UPDATE app_user SET last_login_at = now() WHERE id = $1', [user.id])
      await audit(c, { tenantId: user.tenant_id, userId: user.id, scope: 'tenant', ip: req.ip, requestId: req.id },
        { action: 'auth.login.success', entityType: 'app_user', entityId: user.id, summary: `${user.full_name} signed in` })
      return s
    })

    const token = await signAccessToken({
      sub: user.id, tid: user.tenant_id, scope, sid: sessionId,
      pv: access.permVersion, roles: access.roles,
    })

    reply.setCookie(env.cookieName, refresh, cookieOpts)
    return { accessToken: token, mustChangePassword: user.must_change_pw }
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/refresh', publicRoute, async (req, reply) => {
    const presented = (req.cookies as any)?.[env.cookieName]
    if (!presented) throw unauthorized('No session.')
    const hash = sha256(presented)

    // Session lookup is pre-tenant for the same reason login is.
    const row = await withAdmin(async c => {
      const rows = await c.query<any>(
        `SELECT s.id, s.tenant_id, s.user_id, s.family_id, s.revoked_at, s.used_at, s.expires_at
           FROM session s WHERE s.refresh_token_hash = $1 LIMIT 1`, [hash])
      return rows[0] ?? null
    })
    if (!row) throw unauthorized('Session not recognised.')

    if (row.used_at || row.revoked_at) {
      // A token that has already been rotated is being replayed: assume theft
      // and kill every session in the family, not just this one.
      await withTenant(row.tenant_id, row.user_id, async c => {
        await c.query('UPDATE session SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id])
        await audit(c, { tenantId: row.tenant_id, userId: row.user_id, scope: 'tenant', ip: req.ip, requestId: req.id },
          { action: 'auth.refresh.reuse_detected', entityType: 'session', entityId: row.id,
            summary: 'Refresh token replayed — whole session family revoked' })
      })
      reply.clearCookie(env.cookieName, { path: '/api/v1/auth' })
      throw unauthorized('That session was already used. Sign in again.')
    }
    if (new Date(row.expires_at) < new Date()) throw unauthorized('Your session expired. Sign in again.')

    const access = await loadAccess(row.tenant_id, row.user_id)
    if (!access || access.status !== 'active') throw unauthorized()
    const isStaff = access.roles.some(r => r !== 'STUDENT')

    const { sessionId, refresh } = await withTenant(row.tenant_id, row.user_id, async c => {
      await c.query('UPDATE session SET used_at = now(), revoked_at = now() WHERE id = $1', [row.id])
      return issueSession(c, row.tenant_id, row.user_id, isStaff,
        { ip: req.ip, ua: String(req.headers['user-agent'] ?? '') }, row.family_id)
    })

    const token = await signAccessToken({
      sub: row.user_id, tid: row.tenant_id,
      scope: access.isPlatform ? 'platform' : 'tenant',
      sid: sessionId, pv: access.permVersion, roles: access.roles,
    })
    reply.setCookie(env.cookieName, refresh, cookieOpts)
    return { accessToken: token }
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/logout', publicRoute, async (req, reply) => {
    const presented = (req.cookies as any)?.[env.cookieName]
    if (presented) {
      const hash = sha256(presented)
      await withAdmin(c => c.query('UPDATE session SET revoked_at = now() WHERE refresh_token_hash = $1', [hash]))
    }
    reply.clearCookie(env.cookieName, { path: '/api/v1/auth' })
    return { ok: true }
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/change-password', { config: { requires: 'me:read' } }, async req => {
    const { currentPassword, newPassword } = (req.body ?? {}) as any
    if (!newPassword || String(newPassword).length < 8) {
      // No composition rules: forcing symbols on 13-year-olds produces reuse,
      // not security. Length plus a breach check is the better trade.
      throw badRequest('Use at least 8 characters. A short phrase you will remember is fine.')
    }
    return req.db(async c => {
      const rows = await c.query<any>('SELECT password_hash, full_name FROM app_user WHERE id = $1', [req.access.userId])
      if (!rows.length) throw unauthorized()
      if (!await verifyPassword(String(currentPassword ?? ''), rows[0].password_hash)) {
        throw badRequest('Your current password is not right.')
      }
      await c.query(
        `UPDATE app_user SET password_hash = $1, must_change_pw = false, perm_version = perm_version + 1
          WHERE id = $2`,
        [await hashPassword(String(newPassword)), req.access.userId])
      // Every other session for this user dies; the current one carries on.
      await c.query(
        'UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [req.access.userId])
      await req.log_audit(c, {
        action: 'auth.password.changed', entityType: 'app_user', entityId: req.access.userId,
        summary: `${rows[0].full_name} changed their password`,
      })
      invalidateAccess(req.access.userId)
      return { ok: true, reauth: true }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/auth/sessions', requires('me:read'), async req =>
    req.db(async c => ({
      sessions: await c.query(
        `SELECT id, user_agent, ip, created_at, last_seen_at, expires_at
           FROM session WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
        [req.access.userId]),
    })))
}
