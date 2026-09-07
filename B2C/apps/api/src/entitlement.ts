/**
 * Entitlement — requirement 24, in code.
 *
 *   "A student should not be able to access a course merely because they know
 *    the course ID or URL."
 *
 * These functions are the application's half of that. The database enforces the
 * same rule underneath (003_rls.sql), so the two are belt and braces: an
 * endpoint that forgets to call assertEntitled() still returns nothing useful,
 * and a policy that is somehow relaxed still meets an explicit check here.
 */

import type { Conn } from '@brolly/b2c-db'
import { forbidden, notFound } from './http.ts'
import type { Access } from './access.ts'

export async function isEnrolled(c: Conn, userId: string, courseId: string): Promise<boolean> {
  const rows = await c.query(
    `SELECT 1 FROM enrollment
      WHERE user_id = $1 AND course_id = $2 AND status IN ('active','completed')
        AND (expires_on IS NULL OR expires_on >= current_date)`,
    [userId, courseId])
  return rows.length > 0
}

export async function teachesCourse(c: Conn, userId: string, courseId: string): Promise<boolean> {
  const rows = await c.query('SELECT 1 FROM course_teacher WHERE user_id = $1 AND course_id = $2',
    [userId, courseId])
  return rows.length > 0
}

/**
 * The one question every protected read asks.
 *
 * Answers 404 rather than 403 on purpose: a student who has not bought the
 * course should not learn that the id they guessed is a real one.
 */
export async function assertCanReach(c: Conn, access: Access, courseId: string) {
  if (access.role === 'BROLLY_ADMIN') return
  if (access.role === 'TEACHER') {
    if (await teachesCourse(c, access.userId, courseId)) return
    throw notFound('That course is not one of yours.')
  }
  if (await isEnrolled(c, access.userId, courseId)) return
  throw notFound('You are not enrolled in that course.')
}

/** Teaching, specifically — for grading, scheduling and marking attendance. */
export async function assertTeaches(c: Conn, access: Access, courseId: string) {
  if (access.role === 'BROLLY_ADMIN') return
  if (await teachesCourse(c, access.userId, courseId)) return
  throw forbidden('You do not teach that course.')
}

/** A student's own row, and nobody else's. */
export function assertOwn(access: Access, ownerId: string) {
  if (access.role === 'BROLLY_ADMIN') return
  if (access.userId !== ownerId) throw forbidden('That belongs to someone else.')
}

/**
 * A teacher reaches a student only through a course they teach — there is no
 * stored student/teacher relationship to shortcut this.
 */
export async function assertCanSeeStudent(c: Conn, access: Access, studentId: string) {
  if (access.role === 'BROLLY_ADMIN') return
  if (access.userId === studentId) return
  const rows = await c.query(
    `SELECT 1 FROM enrollment e
       JOIN course_teacher ct ON ct.course_id = e.course_id
      WHERE e.user_id = $1 AND ct.user_id = $2 AND e.status IN ('active','completed')
      LIMIT 1`,
    [studentId, access.userId])
  if (!rows.length) throw forbidden('That student is not enrolled in any course you teach.')
}

/** Resolve the course a lesson belongs to, for entitlement on nested content. */
export async function courseOfLesson(c: Conn, lessonId: string): Promise<string> {
  const rows = await c.query<{ course_id: string }>(
    `SELECT m.course_id FROM lesson l JOIN module m ON m.id = l.module_id WHERE l.id = $1`, [lessonId])
  if (!rows.length) throw notFound('Unknown lesson.')
  return rows[0].course_id
}

export async function courseOfQuiz(c: Conn, quizId: string): Promise<string> {
  const rows = await c.query<{ course_id: string }>('SELECT course_id FROM quiz WHERE id = $1', [quizId])
  if (!rows.length) throw notFound('Unknown quiz.')
  return rows[0].course_id
}

export async function courseOfAssignment(c: Conn, assignmentId: string): Promise<string> {
  const rows = await c.query<{ course_id: string }>('SELECT course_id FROM assignment WHERE id = $1', [assignmentId])
  if (!rows.length) throw notFound('Unknown assignment.')
  return rows[0].course_id
}
