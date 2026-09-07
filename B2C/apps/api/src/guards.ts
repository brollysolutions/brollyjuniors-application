/**
 * The request pipeline:
 *
 *   authenticate   valid token? session live? perm_version current?
 *   permission     the @requires(...) declared on the route
 *   handler        loads the row, then calls an entitlement check
 *   database       refuses anyway if the check was forgotten (003_rls.sql)
 *
 * Deny by default: a route registered with neither `public: true` nor a
 * permission throws at boot. A forgotten guard is a startup failure, not a hole
 * somebody finds in production.
 */

import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify'
import { withActor, withAnon, type Conn } from '@brolly/b2c-db'
import { forbidden, unauthorized } from './http.ts'
import { verifyAccessToken } from './tokens.ts'
import { loadAccess, can, dbRole, type Access } from './access.ts'
import { audit, type AuditEntry } from './audit.ts'

declare module 'fastify' {
  interface FastifyRequest {
    access: Access
    /** Run as this user. RLS is pinned to them for the whole transaction. */
    db<T>(fn: (c: Conn) => Promise<T>): Promise<T>
    log_audit(c: Conn, entry: AuditEntry): Promise<void>
  }
  interface FastifyContextConfig {
    public?: boolean
    requires?: string
  }
}

export function registerGuards(app: FastifyInstance) {
  app.addHook('onRoute', (route: RouteOptions & { path: string }) => {
    const cfg = (route.config ?? {}) as { public?: boolean; requires?: string }
    if (route.method === 'HEAD' || route.method === 'OPTIONS') return
    if (route.path === '/health') return
    if (!cfg.public && !cfg.requires) {
      throw new Error(
        `Route ${route.method} ${route.path} declares no permission. ` +
        `Add config:{ requires: 'some:permission' } or config:{ public: true }.`)
    }
  })

  app.decorateRequest('access', null as any)
  app.decorateRequest('db', null as any)
  app.decorateRequest('log_audit', null as any)

  app.addHook('preHandler', async (req: FastifyRequest) => {
    const cfg = (req.routeOptions?.config ?? {}) as { public?: boolean; requires?: string }

    if (cfg.public) {
      // The catalogue is browsable by strangers, so anonymous requests still get
      // a scoped connection — one that can see published structure and nothing else.
      req.db = fn => withAnon(fn)
      return
    }

    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) throw unauthorized()

    let claims
    try { claims = await verifyAccessToken(header.slice(7)) }
    catch { throw unauthorized('Your session has expired. Sign in again.') }

    const access = await loadAccess(claims.sub)
    if (!access) throw unauthorized()

    // A role change or deactivation bumps perm_version, so a token minted before
    // that is refused immediately rather than at expiry.
    if (access.permVersion !== claims.pv) throw unauthorized('Your access changed. Sign in again.')
    if (access.status !== 'active') throw forbidden('This account has been deactivated.')

    req.access = access
    req.db = fn => withActor(access.userId, dbRole(access), fn)
    req.log_audit = (c, entry) => audit(c, {
      userId: access.userId, role: access.role,
      ip: req.ip, ua: String(req.headers['user-agent'] ?? ''), requestId: String(req.id),
    }, entry)

    if (cfg.requires && !can(access, cfg.requires)) {
      // A spike of these for one account is the signal that somebody is probing.
      await req.db(c => req.log_audit(c, {
        action: 'authz.denied',
        summary: `${cfg.requires} on ${req.method} ${req.url}`,
      })).catch(() => { /* never fail a request because the audit write failed */ })
      throw forbidden(`You do not have permission to do that (${cfg.requires}).`)
    }
  })
}

export const requires = (permission: string) => ({ config: { requires: permission } })
export const publicRoute = { config: { public: true } }
