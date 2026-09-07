/**
 * Effective authority.
 *
 *   can(actor, permission) = the role grants it
 *                        AND the governing feature is switched on
 *
 * Resource scope — "may this teacher see THIS student" — is deliberately not
 * here. It needs the loaded row, so it lives in entitlement.ts and is called by
 * the handler right after the fetch. And below that again, the database refuses
 * on its own (003_rls.sql), which is the layer that survives a coding mistake.
 */

import { withActor, type Conn, type ActorRole } from '@brolly/b2c-db'
import { PERMISSION_FEATURE, FEATURES, type RoleKey } from '@brolly/b2c-shared'

export type Access = {
  userId: string
  role: RoleKey
  roles: RoleKey[]
  permVersion: number
  status: string
  fullName: string
  email: string
  mustChangePassword: boolean
  permissions: Set<string>
  features: Set<string>
}

const CACHE = new Map<string, { at: number; value: Access }>()
const TTL_MS = 15_000

export const invalidateAccess = (userId: string) => CACHE.delete(userId)

/**
 * Which of a user's roles is the one that decides their portal.
 * In B2C a person has exactly one, but the model allows more, so the highest
 * level wins rather than "the first row we happened to read".
 */
const RANK: Record<RoleKey, number> = { BROLLY_ADMIN: 3, TEACHER: 2, STUDENT: 1 }

export async function loadAccess(userId: string): Promise<Access | null> {
  const hit = CACHE.get(userId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  // Read the account as itself: the app_user policy always lets you see you.
  const value = await withActor(userId, 'STUDENT', c => read(c, userId))
  if (value) CACHE.set(userId, { at: Date.now(), value })
  return value
}

async function read(c: Conn, userId: string): Promise<Access | null> {
  const rows = await c.query<any>(
    `SELECT id, full_name, email, status, perm_version, must_change_pw
       FROM app_user WHERE id = $1 AND deleted_at IS NULL`, [userId])
  if (!rows.length) return null
  const u = rows[0]

  const roleRows = await c.query<{ key: string }>(
    'SELECT r.key FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = $1', [userId])
  const roles = roleRows.map(r => r.key as RoleKey)
  if (!roles.length) return null
  const role = [...roles].sort((a, b) => RANK[b] - RANK[a])[0]

  const permRows = await c.query<{ permission_key: string }>(
    `SELECT DISTINCT rp.permission_key
       FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = $1`, [userId])

  return {
    userId, role, roles,
    permVersion: u.perm_version,
    status: u.status,
    fullName: u.full_name,
    email: u.email,
    mustChangePassword: u.must_change_pw,
    permissions: new Set(permRows.map(r => r.permission_key)),
    // Every feature is on for Brolly Juniors today. The indirection exists so a
    // future organisation can have some of them off without a code change.
    features: new Set(Object.keys(FEATURES)),
  }
}

export function can(access: Access, permission: string): boolean {
  if (!access.permissions.has(permission)) return false
  const feature = PERMISSION_FEATURE[permission]
  if (feature && !access.features.has(feature)) return false
  return true
}

export const dbRole = (access: Access): ActorRole => access.role

/** What this login can reach, in one line. Shown on every screen. */
export function boundaryLine(access: Access): string {
  switch (access.role) {
    case 'BROLLY_ADMIN': return 'The whole platform — every course, teacher and student'
    case 'TEACHER': return 'Your courses, and the students enrolled in them'
    default: return 'Your own courses and your own work'
  }
}
