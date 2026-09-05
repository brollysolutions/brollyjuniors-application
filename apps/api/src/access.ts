/**
 * Effective authority.
 *
 *   can(actor, permission) = the roles grant it
 *                        AND the feature governing it is on for this school
 *
 * Resource scope — "may this teacher see THIS class" — is deliberately not
 * here. It needs the loaded row, so it lives in policies.ts and is called by
 * the handler right after the fetch. Pretending otherwise is how IDOR bugs get
 * written.
 */

import { withTenant, type Conn } from '@brolly/db'
import { PERMISSION_FEATURE, type RoleKey } from '@brolly/shared'

export type Access = {
  userId: string
  tenantId: string
  permVersion: number
  status: string
  roles: RoleKey[]
  permissions: Set<string>
  features: Set<string>
  tenantStatus: string
  isPlatform: boolean
  tenantName: string
  schoolCode: string
}

const CACHE = new Map<string, { at: number; value: Access }>()
const TTL_MS = 15_000

export function invalidateAccess(userId: string) {
  for (const key of CACHE.keys()) if (key.startsWith(userId)) CACHE.delete(key)
}

export async function loadAccess(tenantId: string, userId: string): Promise<Access | null> {
  const key = `${userId}:${tenantId}`
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const value = await withTenant(tenantId, userId, c => readAccess(c, tenantId, userId))
  if (value) CACHE.set(key, { at: Date.now(), value })
  return value
}

async function readAccess(c: Conn, tenantId: string, userId: string): Promise<Access | null> {
  const rows = await c.query<any>(
    `SELECT u.id, u.perm_version, u.status,
            t.status AS tenant_status, t.is_platform, t.name AS tenant_name, t.school_code
       FROM app_user u
       JOIN tenant t ON t.id = u.tenant_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId])
  if (!rows.length) return null
  const u = rows[0]

  const roleRows = await c.query<{ key: string }>(
    `SELECT r.key FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = $1`, [userId])

  const permRows = await c.query<{ permission_key: string }>(
    `SELECT DISTINCT rp.permission_key
       FROM user_role ur
       JOIN role_permission rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = $1`, [userId])

  const featRows = await c.query<{ feature_key: string }>(
    `SELECT feature_key FROM tenant_feature WHERE tenant_id = $1 AND enabled = true`, [tenantId])

  return {
    userId,
    tenantId,
    permVersion: u.perm_version,
    status: u.status,
    roles: roleRows.map(r => r.key as RoleKey),
    permissions: new Set(permRows.map(r => r.permission_key)),
    features: new Set(featRows.map(r => r.feature_key)),
    tenantStatus: u.tenant_status,
    isPlatform: u.is_platform,
    tenantName: u.tenant_name,
    schoolCode: u.school_code,
  }
}

/** permission ∧ governing feature. Both must hold. */
export function can(access: Access, permission: string): boolean {
  if (!access.permissions.has(permission)) return false
  const feature = PERMISSION_FEATURE[permission]
  if (feature && !access.features.has(feature)) return false
  return true
}

export const hasRole = (access: Access, role: RoleKey) => access.roles.includes(role)

/**
 * What this login can see, in one line. Shown on every screen so the boundary
 * is never a claim the user has to take on trust.
 */
export function boundaryLine(access: Access, extra?: string): string {
  if (access.isPlatform) return 'All schools — counts and rates, never a student’s work'
  if (hasRole(access, 'SCHOOL_ADMIN')) return `${access.tenantName} only`
  if (hasRole(access, 'TEACHER')) return extra ?? `Your classes at ${access.tenantName}`
  return 'Your own work only'
}
