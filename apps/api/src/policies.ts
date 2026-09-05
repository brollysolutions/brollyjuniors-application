/**
 * Resource-scope policies — question 4 of the four-question check.
 *
 * A teacher holding progress:read:class may not read EVERY student's progress
 * in the school, only their own classes'. A student may read only their own
 * rows. These functions are the single place that judgement lives, they take
 * the already-loaded row, and they are called from handlers, not guards.
 */

import type { Conn } from '@brolly/db'
import { conflict, forbidden, notFound } from './http.ts'
import type { Access } from './access.ts'
import { hasRole } from './access.ts'

/** Classes this teacher actually teaches. */
export async function teacherClassIds(c: Conn, userId: string): Promise<string[]> {
  const rows = await c.query<{ class_id: string }>(
    'SELECT class_id FROM class_teacher WHERE user_id = $1', [userId])
  return rows.map(r => r.class_id)
}

export async function assertTeachesClass(c: Conn, access: Access, classId: string) {
  if (hasRole(access, 'SCHOOL_ADMIN')) return
  const rows = await c.query('SELECT 1 FROM class_teacher WHERE user_id = $1 AND class_id = $2',
    [access.userId, classId])
  if (!rows.length) throw forbidden('That class is not one of yours.')
}

/** A teacher may reach a student only through a class they teach. */
export async function assertCanSeeStudent(c: Conn, access: Access, studentId: string) {
  if (hasRole(access, 'SCHOOL_ADMIN')) return
  if (access.userId === studentId) return
  const rows = await c.query(
    `SELECT 1 FROM class_student cs
       JOIN class_teacher ct ON ct.class_id = cs.class_id
      WHERE cs.user_id = $1 AND ct.user_id = $2 LIMIT 1`,
    [studentId, access.userId])
  if (!rows.length) throw forbidden('That student is not in one of your classes.')
}

/** Students read their own rows and nothing else. */
export function assertOwnRow(access: Access, ownerId: string) {
  if (access.userId !== ownerId) throw forbidden('That belongs to someone else.')
}

/**
 * Entitlement: does this school hold the course, and (for a student) are they
 * actually enrolled in it? Checked on the server before any content is
 * returned — hiding it in the UI has no security role.
 */
export async function assertEntitledToCourse(c: Conn, access: Access, courseId: string) {
  const ent = await c.query(
    `SELECT 1 FROM tenant_entitlement
      WHERE tenant_id = $1 AND resource_type = 'course' AND resource_id = $2
        AND status = 'active'
        AND (valid_until IS NULL OR valid_until > now())`,
    [access.tenantId, courseId])
  if (!ent.length) throw notFound('That course is not part of your school’s licence.')

  if (hasRole(access, 'STUDENT')) {
    const enr = await c.query(
      `SELECT 1 FROM enrollment WHERE user_id = $1 AND course_id = $2 AND status = 'active'`,
      [access.userId, courseId])
    if (!enr.length) throw forbidden('You are not enrolled in that course.')
  }
}

/** The course a unit belongs to, for entitlement checks on nested content. */
export async function courseOfUnit(c: Conn, unitId: string): Promise<string> {
  const rows = await c.query<{ course_id: string }>('SELECT course_id FROM unit WHERE id = $1', [unitId])
  if (!rows.length) throw notFound('Unknown unit.')
  return rows[0].course_id
}

/** Seats are the commercial control: a school cannot exceed its cap. */
export async function assertSeatsAvailable(c: Conn, tenantId: string, adding = 1) {
  const lic = await c.query<{ seats: number }>(
    `SELECT seats FROM licence WHERE tenant_id = $1 AND status = 'active'
      ORDER BY valid_until DESC LIMIT 1`, [tenantId])
  if (!lic.length) throw forbidden('This school has no active licence.')

  const used = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM app_user u
       JOIN user_role ur ON ur.user_id = u.id
       JOIN role r ON r.id = ur.role_id AND r.key = 'STUDENT'
      WHERE u.tenant_id = $1 AND u.deleted_at IS NULL`, [tenantId])

  const seats = lic[0].seats
  const inUse = Number(used[0].n)
  const left = seats - inUse
  if (inUse + adding > seats) {
    throw conflict(
      `That needs ${inUse + adding} seats but the licence covers ${seats}. ` +
      `${left} seat${left === 1 ? '' : 's'} left — contact Brolly to add more.`,
      'seat_cap')
  }
  return { seats, inUse, left }
}
