/**
 * The request pipeline, in order:
 *
 *   authenticate      valid token? session live? perm_version current?
 *   tenant            token tid pinned; tenant active?
 *   permission        @requires(...) on the route
 *   handler           loads the row, then calls a policy from policies.ts
 *
 * Deny by default: registering a route with neither `public: true` nor a
 * permission throws at boot. A forgotten guard is a startup failure, not a
 * silent hole discovered later.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify'
import { withTenant, withPlatform, type Conn } from '@brolly/db'
import { forbidden, locked, unauthorized } from './http.ts'
import { verifyAccessToken } from './tokens.ts'
import { loadAccess, can, type Access } from './access.ts'
import { audit, type AuditEntry } from './audit.ts'

declare module 'fastify' {
  interface FastifyRequest {
    access: Access
    scope: 'tenant' | 'platform'
    /** Run inside this user's school, with RLS pinned to it. */
    db<T>(fn: (c: Conn) => Promise<T>): Promise<T>
    /** Brolly admin only: manage schools, read counts. Cannot read student work. */
    platformDb<T>(fn: (c: Conn) => Promise<T>): Promise<T>
    log_audit(c: Conn, entry: AuditEntry): Promise<void>
  }
  interface FastifyContextConfig {
    public?: boolean
    requires?: string
  }
}

export function registerGuards(app: FastifyInstance) {
  // Deny by default, enforced at registration time.
  app.addHook('onRoute', (route: RouteOptions & { path: string }) => {
    const cfg = (route.config ?? {}) as { public?: boolean; requires?: string }
    if (route.method === 'HEAD' || route.method === 'OPTIONS') return
    if (route.path.startsWith('/api/v1/public') || route.path === '/health') return
    if (!cfg.public && !cfg.requires) {
      throw new Error(
        `Route ${route.method} ${route.path} declares no permission. ` +
        `Add config:{ requires: 'some:permission' } or config:{ public: true }.`)
    }
  })

  app.decorateRequest('access', null as any)
  app.decorateRequest('scope', 'tenant')
  app.decorateRequest('db', null as any)
  app.decorateRequest('platformDb', null as any)
  app.decorateRequest('log_audit', null as any)

  app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    const cfg = (req.routeOptions?.config ?? {}) as { public?: boolean; requires?: string }
    if (cfg.public) return

    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) throw unauthorized()

    let claims
    try {
      claims = await verifyAccessToken(header.slice(7))
    } catch {
      throw unauthorized('Your session has expired. Sign in again.')
    }

    const access = await loadAccess(claims.tid, claims.sub)
    if (!access) throw unauthorized()

    // A role change, deactivation or suspension bumps perm_version; a token
    // minted before that is refused immediately rather than at expiry.
    if (access.permVersion !== claims.pv) throw unauthorized('Your access changed. Sign in again.')
    if (access.status !== 'active') throw forbidden('This login has been deactivated.')
    if (access.tenantStatus === 'suspended') throw locked('This school’s access is suspended.', 'tenant_suspended')
    if (access.tenantStatus === 'archived') throw locked('This school has been archived.', 'tenant_archived')

    // Platform scope is only ever accepted on platform routes, and vice versa.
    const wantsPlatform = req.url.startsWith('/api/v1/platform')
    if (wantsPlatform && claims.scope !== 'platform') throw forbidden('That area is for Brolly staff.')
    if (!wantsPlatform && claims.scope === 'platform' && !req.url.startsWith('/api/v1/me')) {
      throw forbidden('A Brolly admin token cannot be used on school screens.')
    }

    req.access = access
    req.scope = claims.scope
    req.db = fn => withTenant(access.tenantId, access.userId, fn)
    req.platformDb = fn => withPlatform(access.userId, fn)
    req.log_audit = (c, entry) => audit(c, {
      tenantId: claims.scope === 'platform' ? null : access.tenantId,
      userId: access.userId,
      scope: claims.scope,
      ip: req.ip,
      ua: String(req.headers['user-agent'] ?? ''),
      requestId: req.id,
    }, entry)

    if (cfg.requires && !can(access, cfg.requires)) {
      // Audited: a spike of these for one user is the signal that someone is probing.
      const write = claims.scope === 'platform' ? req.platformDb : req.db
      await write(c => req.log_audit(c, {
        action: 'authz.denied',
        summary: `${cfg.requires} on ${req.method} ${req.url}`,
      })).catch(() => { /* never fail a request because the audit write failed */ })
      throw forbidden(`You do not have permission to do that (${cfg.requires}).`)
    }
  })
}

/** Shorthand used on every protected route. */
export const requires = (permission: string) => ({ config: { requires: permission } })
export const publicRoute = { config: { public: true } }
