/**
 * Teacher routes.
 *
 * A Brolly Juniors teacher, employed by Brolly, not attached to any school and
 * not owned by any student. Every student they can reach is reached through a
 * course they teach — there is no stored student/teacher link to shortcut, and
 * the database enforces that too.
 */

import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { badRequest, conflict, notFound } from '../http.ts'
import { requires } from '../guards.ts'
import { assertCanReach, assertTeaches, assertCanSeeStudent, courseOfAssignment } from '../entitlement.ts'
import { signAsset } from '../media.ts'

export default async function teacherRoutes(app: FastifyInstance) {
  app.get('/api/v1/teacher/overview', requires('progress:read:course'), async req =>
    req.db(async c => {
      const uid = req.access.userId
      const courses = await c.query<any>(`
        SELECT c.id, c.title, c.subtitle, s.name AS subject, ct.role,
               (SELECT count(*)::int FROM enrollment e WHERE e.course_id = c.id AND e.status = 'active') AS students,
               (SELECT count(*)::int FROM lesson l JOIN module m ON m.id = l.module_id
                 WHERE m.course_id = c.id) AS lessons
          FROM course_teacher ct
          JOIN course c ON c.id = ct.course_id
          JOIN subject s ON s.id = c.subject_id
         WHERE ct.user_id = $1 ORDER BY c.title`, [uid])

      const stats = (await c.query<any>(`
        SELECT
          (SELECT count(DISTINCT e.user_id)::int FROM enrollment e
             JOIN course_teacher ct ON ct.course_id = e.course_id AND ct.user_id = $1
            WHERE e.status = 'active') AS students,
          (SELECT count(*)::int FROM submission s
             JOIN assignment a ON a.id = s.assignment_id
             JOIN course_teacher ct ON ct.course_id = a.course_id AND ct.user_id = $1
            WHERE s.status = 'submitted') AS to_grade,
          (SELECT count(*)::int FROM live_session ls
            WHERE ls.teacher_id = $1 AND ls.starts_at > now() AND ls.status = 'scheduled') AS upcoming,
          (SELECT count(*)::int FROM live_session ls
            WHERE ls.teacher_id = $1 AND ls.status = 'ended') AS delivered`, [uid]))[0]

      return {
        courses, stats,
        upcoming: await c.query(`
          SELECT ls.id, ls.title, ls.starts_at, ls.ends_at, ls.status, c.title AS course,
                 (SELECT count(*)::int FROM session_attendance sa
                   WHERE sa.live_session_id = ls.id AND sa.status = 'registered') AS registered
            FROM live_session ls JOIN course c ON c.id = ls.course_id
           WHERE ls.teacher_id = $1 AND ls.starts_at > now() - interval '2 hours'
           ORDER BY ls.starts_at LIMIT 5`, [uid]),
        recentGrading: await c.query(`
          SELECT s.id, s.submitted_at, u.full_name AS student, a.title AS assignment, c.title AS course
            FROM submission s
            JOIN assignment a ON a.id = s.assignment_id
            JOIN course c ON c.id = a.course_id
            JOIN course_teacher ct ON ct.course_id = a.course_id AND ct.user_id = $1
            JOIN app_user u ON u.id = s.user_id
           WHERE s.status = 'submitted' ORDER BY s.submitted_at LIMIT 8`, [uid]),
      }
    }))

  app.get('/api/v1/teacher/courses/:id', requires('course:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      await assertTeaches(c, req.access, id)
      const course = (await c.query<any>(`
        SELECT c.id, c.title, c.subtitle, c.level, c.duration_hours, s.name AS subject
          FROM course c JOIN subject s ON s.id = c.subject_id WHERE c.id = $1`, [id]))[0]
      if (!course) throw notFound('No such course.')

      return {
        course,
        modules: await c.query(`
          SELECT m.id, m.position, m.title, m.summary,
                 coalesce((SELECT json_agg(json_build_object('id', l.id, 'title', l.title, 'position', l.position)
                   ORDER BY l.position) FROM lesson l WHERE l.module_id = m.id), '[]'::json) AS lessons
            FROM module m WHERE m.course_id = $1 ORDER BY m.position`, [id]),
        students: await c.query(`
          WITH nodes AS (
            SELECT l.id FROM lesson l JOIN module m ON m.id = l.module_id WHERE m.course_id = $1
            UNION ALL
            SELECT e.id FROM exercise e JOIN lesson l ON l.id = e.lesson_id
              JOIN module m ON m.id = l.module_id WHERE m.course_id = $1
            UNION ALL
            SELECT r.id FROM recording r WHERE r.course_id = $1 AND r.status = 'published')
          SELECT u.id, u.full_name, u.email, u.last_login_at, e.status, e.enrolled_at,
                 (SELECT count(*)::int FROM nodes) AS total_nodes,
                 (SELECT count(*)::int FROM progress p
                   WHERE p.user_id = u.id AND p.status='completed'
                     AND p.node_id IN (SELECT id FROM nodes)) AS done,
                 (SELECT round(avg(a.score / nullif(a.max_score,0)) * 100)::int
                    FROM quiz_attempt a JOIN quiz q ON q.id = a.quiz_id
                   WHERE q.course_id = $1 AND a.user_id = u.id AND a.status='submitted') AS quiz_pct,
                 (SELECT max(p.last_activity_at) FROM progress p WHERE p.user_id = u.id) AS last_seen
            FROM enrollment e JOIN app_user u ON u.id = e.user_id
           WHERE e.course_id = $1 ORDER BY u.full_name LIMIT 300`, [id]),
        assignments: await c.query(`
          SELECT a.id, a.title, a.due_at, a.max_score, a.status,
                 (SELECT count(*)::int FROM submission s WHERE s.assignment_id = a.id) AS submitted,
                 (SELECT count(*)::int FROM submission s WHERE s.assignment_id = a.id AND s.status='submitted') AS to_grade
            FROM assignment a WHERE a.course_id = $1 ORDER BY a.due_at DESC`, [id]),
        quizzes: await c.query(`
          SELECT q.id, q.title, q.pass_mark_pct,
                 (SELECT count(*)::int FROM question WHERE quiz_id = q.id) AS questions,
                 (SELECT count(*)::int FROM quiz_attempt a WHERE a.quiz_id = q.id AND a.status='submitted') AS attempts,
                 (SELECT round(avg(a.score / nullif(a.max_score,0))*100)::int FROM quiz_attempt a
                   WHERE a.quiz_id = q.id AND a.status='submitted') AS avg_pct
            FROM quiz q WHERE q.course_id = $1 ORDER BY q.title`, [id]),
      }
    })
  })

  app.get('/api/v1/teacher/students', requires('progress:read:course'), async req =>
    req.db(async c => ({
      students: await c.query(`
        SELECT DISTINCT u.id, u.full_name, u.email, u.last_login_at,
               (SELECT string_agg(DISTINCT c2.title, ', ')
                  FROM enrollment e2 JOIN course c2 ON c2.id = e2.course_id
                  JOIN course_teacher ct2 ON ct2.course_id = c2.id AND ct2.user_id = $1
                 WHERE e2.user_id = u.id) AS courses,
               (SELECT max(p.last_activity_at) FROM progress p WHERE p.user_id = u.id) AS last_seen,
               (SELECT count(*)::int FROM submission s
                  JOIN assignment a ON a.id = s.assignment_id
                  JOIN course_teacher ct3 ON ct3.course_id = a.course_id AND ct3.user_id = $1
                 WHERE s.user_id = u.id AND s.status = 'submitted') AS awaiting_grade
          FROM enrollment e
          JOIN course_teacher ct ON ct.course_id = e.course_id AND ct.user_id = $1
          JOIN app_user u ON u.id = e.user_id
         WHERE e.status IN ('active','completed')
         ORDER BY u.full_name LIMIT 400`, [req.access.userId]),
    })))

  app.get('/api/v1/teacher/students/:id', requires('progress:read:course'), async req => {
    const studentId = (req.params as any).id
    return req.db(async c => {
      await assertCanSeeStudent(c, req.access, studentId)
      const student = (await c.query<any>(
        'SELECT id, full_name, email, last_login_at, created_at FROM app_user WHERE id = $1', [studentId]))[0]
      if (!student) throw notFound('No such student.')

      return {
        // Note what is absent: date of birth, guardian contact. The RLS policy
        // on student_profile does not admit a teacher, so a query for it here
        // would simply return nothing.
        student,
        courses: await c.query(`
          SELECT c.id, c.title, e.status, e.enrolled_at,
                 (SELECT count(*)::int FROM progress p WHERE p.user_id = $1 AND p.course_id = c.id
                    AND p.status = 'completed') AS done
            FROM enrollment e
            JOIN course c ON c.id = e.course_id
            JOIN course_teacher ct ON ct.course_id = c.id AND ct.user_id = $2
           WHERE e.user_id = $1`, [studentId, req.access.userId]),
        quizzes: await c.query(`
          SELECT q.title, a.score, a.max_score, a.passed, a.submitted_at, c.title AS course
            FROM quiz_attempt a
            JOIN quiz q ON q.id = a.quiz_id
            JOIN course c ON c.id = q.course_id
            JOIN course_teacher ct ON ct.course_id = q.course_id AND ct.user_id = $2
           WHERE a.user_id = $1 AND a.status = 'submitted' ORDER BY a.submitted_at DESC`,
          [studentId, req.access.userId]),
        submissions: await c.query(`
          SELECT s.id, s.status, s.score, s.submitted_at, s.graded_at, a.title, a.max_score
            FROM submission s
            JOIN assignment a ON a.id = s.assignment_id
            JOIN course_teacher ct ON ct.course_id = a.course_id AND ct.user_id = $2
           WHERE s.user_id = $1 ORDER BY s.submitted_at DESC`, [studentId, req.access.userId]),
        recent: await c.query(`
          SELECT p.node_type, p.status, p.last_activity_at, c.title AS course
            FROM progress p
            JOIN course c ON c.id = p.course_id
            JOIN course_teacher ct ON ct.course_id = p.course_id AND ct.user_id = $2
           WHERE p.user_id = $1 ORDER BY p.last_activity_at DESC LIMIT 12`, [studentId, req.access.userId]),
      }
    })
  })

  // =========================================================================
  // Grading
  // =========================================================================

  app.get('/api/v1/teacher/grading', requires('assignment:grade'), async req =>
    req.db(async c => ({
      submissions: await c.query(`
        SELECT s.id, s.status, s.score, s.submitted_at, s.graded_at, s.attempt_no,
               a.title AS assignment, a.max_score, c.title AS course, u.full_name AS student
          FROM submission s
          JOIN assignment a ON a.id = s.assignment_id
          JOIN course c ON c.id = a.course_id
          JOIN course_teacher ct ON ct.course_id = a.course_id AND ct.user_id = $1
          JOIN app_user u ON u.id = s.user_id
         ORDER BY (s.status = 'submitted') DESC, s.submitted_at LIMIT 100`, [req.access.userId]),
    })))

  app.get('/api/v1/teacher/submissions/:id', requires('assignment:grade'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const s = (await c.query<any>(`
        SELECT s.*, a.title AS assignment, a.instructions, a.rubric, a.max_score, a.course_id,
               u.full_name AS student, u.email
          FROM submission s
          JOIN assignment a ON a.id = s.assignment_id
          JOIN app_user u ON u.id = s.user_id
         WHERE s.id = $1`, [id]))[0]
      if (!s) throw notFound('No such submission.')
      await assertTeaches(c, req.access, s.course_id)
      return { submission: s }
    })
  })

  app.post('/api/v1/teacher/submissions/:id/grade', requires('assignment:grade'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const s = (await c.query<any>(`
        SELECT s.id, s.user_id, s.score, a.rubric, a.max_score, a.title, a.course_id
          FROM submission s JOIN assignment a ON a.id = s.assignment_id WHERE s.id = $1`, [id]))[0]
      if (!s) throw notFound('No such submission.')
      await assertTeaches(c, req.access, s.course_id)

      if (b.action === 'return') {
        await c.query(`UPDATE submission SET status='returned', feedback=$1, graded_by=$2 WHERE id=$3`,
          [String(b.feedback ?? ''), req.access.userId, id])
        await c.query(`SELECT notify($1,'grade',$2,$3,'assignments')`,
          [s.user_id, 'An assignment came back',
            `Your teacher asked for another go at "${s.title}".`])
        await req.log_audit(c, {
          action: 'submission.returned', entityType: 'submission', entityId: id,
          summary: `Returned "${s.title}" for another attempt`,
        })
        return { ok: true, status: 'returned' }
      }

      const rubric: Array<{ key: string; label: string; max: number }> = s.rubric ?? []
      const scores: Record<string, number> = {}
      let total = 0
      for (const r of rubric) {
        const raw = Number(b.scores?.[r.key] ?? 0)
        if (Number.isNaN(raw) || raw < 0 || raw > r.max) {
          throw badRequest(`"${r.label}" must be between 0 and ${r.max}.`)
        }
        scores[r.key] = raw
        total += raw
      }

      await c.query(
        `UPDATE submission SET status='graded', rubric_scores=$1, score=$2, feedback=$3,
                graded_by=$4, graded_at=now() WHERE id=$5`,
        [JSON.stringify(scores), total, String(b.feedback ?? ''), req.access.userId, id])
      // notify() is the only way a notification is created — see 005_notify.sql.
      await c.query(`SELECT notify($1,'grade',$2,$3,'assignments')`,
        [s.user_id, 'An assignment was graded',
          `"${s.title}" scored ${total} out of ${s.max_score}.`])
      await req.log_audit(c, {
        action: 'submission.graded', entityType: 'submission', entityId: id,
        summary: `Graded "${s.title}": ${total}/${s.max_score}`,
        before: { score: s.score }, after: { score: total, feedback: b.feedback },
      })
      return { ok: true, score: total }
    })
  })

  // =========================================================================
  // Live classes
  // =========================================================================

  app.get('/api/v1/teacher/live', requires('live:read'), async req =>
    req.db(async c => ({
      sessions: await c.query(`
        SELECT ls.id, ls.title, ls.description, ls.starts_at, ls.ends_at, ls.status, ls.meeting_url,
               c.title AS course, c.id AS course_id,
               (SELECT count(*)::int FROM session_attendance sa WHERE sa.live_session_id = ls.id) AS registered,
               (SELECT count(*)::int FROM session_attendance sa
                 WHERE sa.live_session_id = ls.id AND sa.status = 'attended') AS attended,
               (SELECT count(*)::int FROM enrollment e
                 WHERE e.course_id = ls.course_id AND e.status = 'active') AS enrolled
          FROM live_session ls JOIN course c ON c.id = ls.course_id
         WHERE ls.teacher_id = $1 ORDER BY ls.starts_at DESC`, [req.access.userId]),
    })))

  app.get('/api/v1/teacher/live/:id', requires('live:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const s = (await c.query<any>(`
        SELECT ls.*, c.title AS course FROM live_session ls JOIN course c ON c.id = ls.course_id
         WHERE ls.id = $1`, [id]))[0]
      if (!s) throw notFound('No such session.')
      await assertCanReach(c, req.access, s.course_id)
      return {
        session: s,
        attendance: await c.query(`
          SELECT sa.status, sa.joined_at, u.id AS user_id, u.full_name
            FROM enrollment e
            JOIN app_user u ON u.id = e.user_id
            LEFT JOIN session_attendance sa ON sa.live_session_id = $1 AND sa.user_id = u.id
           WHERE e.course_id = $2 AND e.status = 'active'
           ORDER BY u.full_name`, [id, s.course_id]),
      }
    })
  })

  app.post('/api/v1/teacher/live/:id/status', requires('live:host'), async req => {
    const id = (req.params as any).id
    const status = String((req.body as any)?.status ?? '')
    if (!['live', 'ended'].includes(status)) throw badRequest('A session can be started or ended.')
    return req.db(async c => {
      const s = (await c.query<any>('SELECT id, teacher_id, title FROM live_session WHERE id = $1', [id]))[0]
      if (!s) throw notFound('No such session.')
      if (s.teacher_id !== req.access.userId && req.access.role !== 'BROLLY_ADMIN') {
        throw conflict('Only the assigned teacher can start or end this session.', 'not_host')
      }
      await c.query('UPDATE live_session SET status = $1 WHERE id = $2', [status, id])
      await req.log_audit(c, {
        action: `live.${status}`, entityType: 'live_session', entityId: id,
        summary: `${status === 'live' ? 'Started' : 'Ended'} "${s.title}"`,
      })
      return { ok: true, status }
    })
  })

  app.post('/api/v1/teacher/live/:id/attendance', requires('live:attendance'), async req => {
    const id = (req.params as any).id
    const marks: Array<{ userId: string; status: string }> = (req.body as any)?.marks ?? []
    return req.db(async c => {
      const s = (await c.query<any>('SELECT id, course_id FROM live_session WHERE id = $1', [id]))[0]
      if (!s) throw notFound('No such session.')
      await assertTeaches(c, req.access, s.course_id)
      for (const m of marks) {
        if (!['attended', 'absent', 'registered'].includes(m.status)) continue
        await c.query(`
          INSERT INTO session_attendance (live_session_id, user_id, status) VALUES ($1,$2,$3)
          ON CONFLICT (live_session_id, user_id) DO UPDATE SET status = excluded.status`,
          [id, m.userId, m.status])
      }
      await req.log_audit(c, {
        action: 'live.attendance', entityType: 'live_session', entityId: id,
        summary: `Marked attendance for ${marks.length} students`,
      })
      return { ok: true, marked: marks.length }
    })
  })

  // =========================================================================
  // Assignments a teacher owns
  // =========================================================================

  app.post('/api/v1/teacher/assignments', requires('assignment:manage'), async req => {
    const b = (req.body ?? {}) as any
    if (!b.courseId || !String(b.title ?? '').trim()) throw badRequest('Choose a course and give it a title.')
    return req.db(async c => {
      await assertTeaches(c, req.access, b.courseId)
      const id = randomUUID()
      await c.query(
        `INSERT INTO assignment (id, course_id, module_id, created_by, title, instructions, rubric,
                                 max_score, due_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published')`,
        [id, b.courseId, b.moduleId ?? null, req.access.userId, String(b.title),
          JSON.stringify(b.instructions ?? [{ type: 'paragraph', text: String(b.brief ?? '') }]),
          JSON.stringify(b.rubric ?? [
            { key: 'correct', label: 'Does what was asked', max: 4 },
            { key: 'approach', label: 'Sensible approach', max: 3 },
            { key: 'readable', label: 'Readable and commented', max: 2 },
            { key: 'ontime', label: 'Submitted on time', max: 1 },
          ]),
          Number(b.maxScore ?? 10), b.dueAt ?? null])

      const n = Number((await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM enrollment WHERE course_id = $1 AND status = 'active'`,
        [b.courseId]))[0].n)
      await req.log_audit(c, {
        action: 'assignment.created', entityType: 'assignment', entityId: id,
        summary: `Created "${b.title}" for ${n} students`, after: { title: b.title, due_at: b.dueAt },
      })
      return { id, students: n }
    })
  })

  app.get('/api/v1/teacher/recordings', requires('recording:read'), async req =>
    req.db(async c => ({
      recordings: await c.query(`
        SELECT r.id, r.title, r.description, r.duration_seconds, r.recorded_on, r.status,
               c.title AS course, c.id AS course_id
          FROM recording r
          JOIN course c ON c.id = r.course_id
          JOIN course_teacher ct ON ct.course_id = r.course_id AND ct.user_id = $1
         ORDER BY r.recorded_on DESC NULLS LAST`, [req.access.userId]),
    })))

  app.get('/api/v1/teacher/recordings/:id', requires('recording:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const row = (await c.query<any>(`
        SELECT r.*, c.title AS course, ma.storage_key, ma.kind, ma.mime_type, ma.bytes,
               ma.duration_ms, ma.file_name, ma.visibility
          FROM recording r JOIN course c ON c.id = r.course_id
          LEFT JOIN media_asset ma ON ma.id = r.media_asset_id
         WHERE r.id = $1`, [id]))[0]
      if (!row) throw notFound('No such recording.')
      await assertCanReach(c, req.access, row.course_id)
      return { recording: row, media: row.storage_key ? signAsset(row, req.access.userId) : null }
    })
  })
}
