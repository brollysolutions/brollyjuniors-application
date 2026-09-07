import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { withAdmin, withActor, hashPassword, verifyPassword, sha256, type Conn } from '@brolly/b2c-db'
import { env } from '../env.ts'
import { badRequest, conflict, locked, tooMany, unauthorized } from '../http.ts'
import { signAccessToken, newRefreshToken } from '../tokens.ts'
import { loadAccess, invalidateAccess, dbRole } from '../access.ts'
import { audit } from '../audit.ts'
import { publicRoute, requires } from '../guards.ts'

// Throttling is applied to unknown accounts in exactly the same shape, so the
// endpoint cannot be used to discover which email addresses exist.
const attempts = new Map<string, { n: number; until: number }>()
function throttle(key: string) {
  const rec = attempts.get(key)
  if (rec && rec.until > Date.now()) throw tooMany()
}
function recordFailure(key: string) {
  const rec = attempts.get(key) ?? { n: 0, until: 0 }
  rec.n += 1
  rec.until = Date.now() + (rec.n >= 10 ? 15 * 60_000 : Math.min(30_000, 2 ** Math.max(0, rec.n - 3) * 1000))
  attempts.set(key, rec)
}

/** The one pre-authentication lookup: we must find the user before we know them. */
async function findByEmail(email: string) {
  return withAdmin(async c => {
    const rows = await c.query<any>(
      `SELECT id, email, password_hash, status, perm_version, must_change_pw, full_name
         FROM app_user WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`, [email])
    return rows[0] ?? null
  })
}

async function issueSession(c: Conn, userId: string, isStaff: boolean, meta: { ip: string; ua: string }, familyId = randomUUID()) {
  const refresh = newRefreshToken()
  const ttlMs = isStaff ? env.staffRefreshHours * 3600_000 : env.refreshTokenDays * 864e5
  const sessionId = randomUUID()
  await c.query(
    `INSERT INTO session (id, user_id, refresh_token_hash, family_id, user_agent, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [sessionId, userId, sha256(refresh), familyId, meta.ua.slice(0, 250), meta.ip,
      new Date(Date.now() + ttlMs).toISOString()])
  return { sessionId, refresh }
}

export default async function authRoutes(app: FastifyInstance) {
  const cookieOpts = {
    httpOnly: true, sameSite: 'lax' as const, secure: env.isProd,
    path: '/api/v1/auth', maxAge: env.refreshTokenDays * 86400,
  }

  const startSession = async (reply: any, req: any, user: any) => {
    const access = await loadAccess(user.id)
    if (!access) throw unauthorized()
    const isStaff = access.role !== 'STUDENT'

    const { sessionId, refresh } = await withActor(user.id, dbRole(access), async c => {
      const s = await issueSession(c, user.id, isStaff, { ip: req.ip, ua: String(req.headers['user-agent'] ?? '') })
      await c.query('UPDATE app_user SET last_login_at = now() WHERE id = $1', [user.id])
      await audit(c, { userId: user.id, role: access.role, ip: req.ip, requestId: String(req.id) },
        { action: 'auth.login.success', entityType: 'app_user', entityId: user.id, summary: `${user.full_name} signed in` })
      return s
    })

    const token = await signAccessToken({ sub: user.id, role: access.role, sid: sessionId, pv: access.permVersion })
    reply.setCookie(env.cookieName, refresh, cookieOpts)
    return { accessToken: token, role: access.role, mustChangePassword: user.must_change_pw }
  }

  // -------------------------------------------------------------------------
  // Students register themselves. Teachers are created by Brolly Admin, which
  // is why there is no role field on this endpoint to tamper with.
  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/register', publicRoute, async (req, reply) => {
    const b = (req.body ?? {}) as any
    const email = String(b.email ?? '').trim().toLowerCase()
    const fullName = String(b.fullName ?? '').trim()
    const password = String(b.password ?? '')

    if (!fullName) throw badRequest('Tell us your name.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('That does not look like an email address.')
    if (password.length < 8) {
      // Length, not symbols. Composition rules make teenagers reuse passwords.
      throw badRequest('Use at least 8 characters. A short phrase you will remember is fine.')
    }

    const existing = await findByEmail(email)
    if (existing) throw conflict('There is already an account with that email. Try signing in.', 'email_taken')

    const created = await withAdmin(async c => {
      const id = randomUUID()
      await c.query(
        `INSERT INTO app_user (id, email, password_hash, full_name, phone, status)
         VALUES ($1,$2,$3,$4,$5,'active')`,
        [id, email, await hashPassword(password), fullName, String(b.phone ?? '')])
      const roleId = (await c.query<{ id: string }>(`SELECT id FROM role WHERE key = 'STUDENT'`))[0].id
      await c.query('INSERT INTO user_role (user_id, role_id) VALUES ($1,$2)', [id, roleId])
      await c.query(
        `INSERT INTO student_profile (user_id, grade_level, guardian_name, guardian_email, guardian_phone, consent_status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, String(b.gradeLevel ?? ''), String(b.guardianName ?? ''), String(b.guardianEmail ?? ''),
          String(b.guardianPhone ?? ''), b.guardianEmail ? 'guardian_given' : 'pending'])
      return { id, full_name: fullName, must_change_pw: false }
    })

    return startSession(reply, req, created)
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/login', publicRoute, async (req, reply) => {
    const b = (req.body ?? {}) as any
    const email = String(b.email ?? '').trim()
    const password = String(b.password ?? '')
    if (!email || !password) throw badRequest('Enter your email and password.')

    const key = `${req.ip}|${email.toLowerCase()}`
    throttle(key)

    const user = await findByEmail(email)
    // Constant-shape failure: an unknown account costs the same work and gives
    // the same message as a wrong password.
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')

    if (!user || !ok) { recordFailure(key); throw unauthorized('That email or password is not right.') }
    if (user.status !== 'active') throw locked('This account has been deactivated. Contact support.', 'user_disabled')

    attempts.delete(key)
    return startSession(reply, req, user)
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/refresh', publicRoute, async (req, reply) => {
    const presented = (req.cookies as any)?.[env.cookieName]
    if (!presented) throw unauthorized('No session.')

    const row = await withAdmin(async c => {
      const rows = await c.query<any>(
        `SELECT id, user_id, family_id, used_at, revoked_at, expires_at
           FROM session WHERE refresh_token_hash = $1 LIMIT 1`, [sha256(presented)])
      return rows[0] ?? null
    })
    if (!row) throw unauthorized('Session not recognised.')

    const access = await loadAccess(row.user_id)
    if (!access || access.status !== 'active') throw unauthorized()

    if (row.used_at || row.revoked_at) {
      // Already rotated, so this is a replay: assume theft and kill the whole
      // family rather than just this token.
      await withActor(row.user_id, dbRole(access), async c => {
        await c.query('UPDATE session SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id])
        await audit(c, { userId: row.user_id, role: access.role, ip: req.ip, requestId: String(req.id) },
          { action: 'auth.refresh.reuse_detected', entityType: 'session', entityId: row.id,
            summary: 'Refresh token replayed — every session in the family was revoked' })
      })
      reply.clearCookie(env.cookieName, { path: '/api/v1/auth' })
      throw unauthorized('That session was already used. Sign in again.')
    }
    if (new Date(row.expires_at) < new Date()) throw unauthorized('Your session expired. Sign in again.')

    const { sessionId, refresh } = await withActor(row.user_id, dbRole(access), async c => {
      await c.query('UPDATE session SET used_at = now(), revoked_at = now() WHERE id = $1', [row.id])
      return issueSession(c, row.user_id, access.role !== 'STUDENT',
        { ip: req.ip, ua: String(req.headers['user-agent'] ?? '') }, row.family_id)
    })

    const token = await signAccessToken({ sub: row.user_id, role: access.role, sid: sessionId, pv: access.permVersion })
    reply.setCookie(env.cookieName, refresh, cookieOpts)
    return { accessToken: token, role: access.role }
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/logout', publicRoute, async (req, reply) => {
    const presented = (req.cookies as any)?.[env.cookieName]
    if (presented) {
      await withAdmin(c => c.query('UPDATE session SET revoked_at = now() WHERE refresh_token_hash = $1',
        [sha256(presented)]))
    }
    reply.clearCookie(env.cookieName, { path: '/api/v1/auth' })
    return { ok: true }
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/auth/change-password', requires('me:read'), async req => {
    const { currentPassword, newPassword } = (req.body ?? {}) as any
    if (!newPassword || String(newPassword).length < 8) {
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
          WHERE id = $2`, [await hashPassword(String(newPassword)), req.access.userId])
      await c.query('UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [req.access.userId])
      await req.log_audit(c, {
        action: 'auth.password.changed', entityType: 'app_user', entityId: req.access.userId,
        summary: `${rows[0].full_name} changed their password`,
      })
      invalidateAccess(req.access.userId)
      return { ok: true, reauth: true }
    })
  })

  app.get('/api/v1/auth/sessions', requires('me:read'), async req =>
    req.db(async c => ({
      sessions: await c.query(
        `SELECT id, user_agent, ip, created_at, expires_at FROM session
          WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, [req.access.userId]),
    })))
}
