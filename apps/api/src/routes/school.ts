/** School admin. Everything here is bounded to one tenant by RLS, not by care. */

import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { hashPassword, tempPassword, type Conn } from '@brolly/db'
import { badRequest, conflict, notFound } from '../http.ts'
import { requires } from '../guards.ts'
import { assertSeatsAvailable } from '../policies.ts'
import { invalidateAccess } from '../access.ts'

async function roleId(c: Conn, key: string) {
  const rows = await c.query<{ id: string }>('SELECT id FROM role WHERE key = $1 AND tenant_id IS NULL', [key])
  if (!rows.length) throw notFound('Unknown role.')
  return rows[0].id
}

async function seatSummary(c: Conn, tenantId: string) {
  const lic = (await c.query<any>(
    `SELECT seats, levels, valid_until FROM licence WHERE tenant_id = $1 AND status='active'
      ORDER BY valid_until DESC LIMIT 1`, [tenantId]))[0]
  const used = Number((await c.query<{ n: string }>(`
    SELECT count(*)::text AS n FROM app_user u
      JOIN user_role ur ON ur.user_id = u.id
      JOIN role r ON r.id = ur.role_id AND r.key='STUDENT'
     WHERE u.tenant_id = $1 AND u.deleted_at IS NULL`, [tenantId]))[0].n)
  return { seats: lic?.seats ?? 0, used, left: (lic?.seats ?? 0) - used, levels: lic?.levels ?? '', validUntil: lic?.valid_until ?? null }
}

export default async function schoolRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  app.get('/api/v1/school/overview', requires('report:read:tenant'), async req =>
    req.db(async c => {
      const t = req.access.tenantId
      const counts = (await c.query<any>(`
        SELECT
          (SELECT count(*)::int FROM app_user u JOIN user_role ur ON ur.user_id=u.id
             JOIN role r ON r.id=ur.role_id AND r.key='TEACHER' WHERE u.deleted_at IS NULL) AS teachers,
          (SELECT count(*)::int FROM app_user u JOIN user_role ur ON ur.user_id=u.id
             JOIN role r ON r.id=ur.role_id AND r.key='STUDENT' WHERE u.deleted_at IS NULL) AS students,
          (SELECT count(*)::int FROM school_class)                                          AS classes,
          (SELECT count(*)::int FROM lab_submission WHERE status='submitted')                AS pending_labs,
          (SELECT count(*)::int FROM exam_answer ea
             JOIN exam_question eq ON eq.id = ea.exam_question_id
            WHERE eq.kind='written' AND ea.marks_awarded IS NULL)                            AS pending_marking`))[0]

      const classes = await c.query<any>(`
        WITH node_total AS (
          SELECT count(*)::numeric AS n FROM (
            SELECT id FROM video UNION ALL SELECT id FROM material UNION ALL SELECT id FROM practice_lab) z)
        SELECT sc.id, sc.name, sc.grade_level,
               coalesce(string_agg(DISTINCT tu.full_name, ', '), '—')          AS teacher,
               count(DISTINCT cs.user_id)::int                                  AS students,
               round(coalesce(count(p.id) FILTER (WHERE p.status='completed')::numeric
                     / nullif(count(DISTINCT cs.user_id) * (SELECT n FROM node_total), 0) * 100, 0))::int AS completion,
               round(coalesce(avg(ea.total_score / nullif(ea.max_score,0)) * 100, 0))::int AS avg_exam
          FROM school_class sc
          LEFT JOIN class_student cs ON cs.class_id = sc.id AND cs.left_at IS NULL
          LEFT JOIN class_teacher ct ON ct.class_id = sc.id
          LEFT JOIN app_user tu ON tu.id = ct.user_id
          LEFT JOIN progress p ON p.user_id = cs.user_id
          LEFT JOIN exam e ON e.class_id = sc.id
          LEFT JOIN exam_attempt ea ON ea.exam_id = e.id AND ea.user_id = cs.user_id AND ea.total_score IS NOT NULL
         GROUP BY sc.id, sc.name, sc.grade_level
         ORDER BY sc.name`)

      return { counts, classes, seats: await seatSummary(c, t) }
    }))

  // -------------------------------------------------------------------------
  app.get('/api/v1/school/teachers', requires('user:read'), async req =>
    req.db(async c => ({
      teachers: await c.query(`
        SELECT u.id, u.full_name, u.email, u.status, u.last_login_at,
               coalesce(array_agg(DISTINCT sc.name) FILTER (WHERE sc.name IS NOT NULL), '{}') AS classes,
               count(DISTINCT cs.user_id)::int AS students,
               (SELECT count(*)::int FROM assignment a
                 WHERE a.created_by = u.id AND a.created_at > now() - interval '30 days') AS assigned,
               (SELECT count(*)::int FROM lab_submission ls
                 JOIN class_teacher ct2 ON ct2.class_id = ls.class_id AND ct2.user_id = u.id
                WHERE ls.status = 'submitted') AS pending
          FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id
          JOIN role r ON r.id = ur.role_id AND r.key = 'TEACHER'
          LEFT JOIN class_teacher ct ON ct.user_id = u.id
          LEFT JOIN school_class sc ON sc.id = ct.class_id
          LEFT JOIN class_student cs ON cs.class_id = ct.class_id AND cs.left_at IS NULL
         WHERE u.deleted_at IS NULL
         GROUP BY u.id, u.full_name, u.email, u.status, u.last_login_at
         ORDER BY u.full_name`),
      classes: await c.query('SELECT id, name FROM school_class ORDER BY name'),
    })))

  app.post('/api/v1/school/teachers', requires('user:create'), async req => {
    const b = (req.body ?? {}) as any
    const fullName = String(b.fullName ?? '').trim()
    const email = String(b.email ?? '').trim().toLowerCase()
    const classIds: string[] = Array.isArray(b.classIds) ? b.classIds : []
    if (!fullName || !email) throw badRequest('A teacher needs a name and an email address.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('That does not look like an email address.')

    return req.db(async c => {
      if ((await c.query('SELECT 1 FROM app_user WHERE lower(email) = lower($1) AND deleted_at IS NULL', [email])).length) {
        throw conflict('That email already has a login.', 'email_taken')
      }
      const id = randomUUID()
      const temp = tempPassword(8)
      await c.query(
        `INSERT INTO app_user (id, tenant_id, email, username, password_hash, full_name, phone, status, must_change_pw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',true)`,
        [id, req.access.tenantId, email, email.split('@')[0], await hashPassword(temp), fullName, b.phone ?? ''])
      await c.query('INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)',
        [req.access.tenantId, id, await roleId(c, 'TEACHER')])
      await c.query('INSERT INTO teacher_profile (tenant_id, user_id, subject) VALUES ($1,$2,$3)',
        [req.access.tenantId, id, b.subject ?? 'Python & AI'])

      for (const classId of classIds) {
        // Composite FK means a class id from another school simply cannot land here.
        await c.query(
          'INSERT INTO class_teacher (tenant_id, class_id, user_id, role_in_class) VALUES ($1,$2,$3,$4)',
          [req.access.tenantId, classId, id, 'lead'])
      }

      await req.log_audit(c, {
        action: 'user.created', entityType: 'app_user', entityId: id,
        summary: `Created teacher login for ${fullName}`, after: { full_name: fullName, email },
      })
      return { id, email, temporaryPassword: temp }
    })
  })

  app.post('/api/v1/school/teachers/:id/deactivate', requires('user:deactivate'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const t = (await c.query<any>('SELECT full_name, status FROM app_user WHERE id = $1', [id]))[0]
      if (!t) throw notFound('No such teacher.')
      // Deactivate, never delete: a teacher who leaves keeps their grading
      // history attached to the students they taught.
      await c.query(
        `UPDATE app_user SET status = 'disabled', perm_version = perm_version + 1 WHERE id = $1`, [id])
      await c.query('UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id])
      invalidateAccess(id)
      await req.log_audit(c, {
        action: 'user.deactivated', entityType: 'app_user', entityId: id,
        summary: `Deactivated ${t.full_name}`, before: t, after: { status: 'disabled' },
      })
      return { ok: true }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/school/students', requires('user:read'), async req => {
    const classId = (req.query as any)?.classId
    return req.db(async c => ({
      seats: await seatSummary(c, req.access.tenantId),
      classes: await c.query(
        `SELECT sc.id, sc.name, count(cs.user_id)::int AS students
           FROM school_class sc LEFT JOIN class_student cs ON cs.class_id = sc.id AND cs.left_at IS NULL
          GROUP BY sc.id, sc.name ORDER BY sc.name`),
      students: await c.query(`
        SELECT u.id, u.full_name, u.status, u.last_login_at, sp.roll_no,
               sc.name AS class_name, sc.id AS class_id,
               (SELECT count(*)::int FROM progress p WHERE p.user_id = u.id AND p.status='completed') AS done,
               coalesce((SELECT round(sum(p.seconds_spent)/60.0)::int FROM progress p WHERE p.user_id = u.id), 0) AS minutes
          FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id
          JOIN role r ON r.id = ur.role_id AND r.key='STUDENT'
          LEFT JOIN student_profile sp ON sp.user_id = u.id
          LEFT JOIN class_student cs ON cs.user_id = u.id AND cs.left_at IS NULL
          LEFT JOIN school_class sc ON sc.id = cs.class_id
         WHERE u.deleted_at IS NULL AND ($1::uuid IS NULL OR sc.id = $1)
         ORDER BY sc.name NULLS LAST, sp.roll_no
         LIMIT 400`, [classId ?? null]),
    }))
  })

  /**
   * Bulk import. Two passes on purpose: `commit: false` reports what would
   * happen (including the seat cap) before anything is written, because a
   * 250-student school will not type them in one at a time and will not accept
   * "some of them worked".
   */
  app.post('/api/v1/school/students/import', requires('user:import'), async req => {
    const b = (req.body ?? {}) as any
    const rows: Array<{ name?: string; roll?: string; section?: string }> = Array.isArray(b.rows) ? b.rows : []
    const classId = b.classId as string | undefined
    if (!rows.length) throw badRequest('No rows to import.')

    return req.db(async c => {
      const existing = new Set((await c.query<{ roll_no: string }>('SELECT roll_no FROM student_profile'))
        .map(r => r.roll_no.toLowerCase()))
      const seen = new Set<string>()

      const checked = rows.map((r, i) => {
        const name = String(r.name ?? '').trim()
        const roll = String(r.roll ?? '').trim()
        let problem: string | null = null
        if (!name) problem = 'No name'
        else if (!roll) problem = 'Missing roll number'
        else if (existing.has(roll.toLowerCase())) problem = 'Roll number already used'
        else if (seen.has(roll.toLowerCase())) problem = 'Duplicated in this file'
        if (roll) seen.add(roll.toLowerCase())
        return { line: i + 1, name, roll, section: String(r.section ?? '').trim(), problem }
      })

      const ready = checked.filter(r => !r.problem)
      const seats = await seatSummary(c, req.access.tenantId)

      if (!b.commit) {
        return {
          preview: true, rows: checked,
          readyCount: ready.length,
          problemCount: checked.length - ready.length,
          seats,
          wouldExceed: ready.length > seats.left,
        }
      }

      // Seats are the commercial control; the block happens here, in one place.
      await assertSeatsAvailable(c, req.access.tenantId, ready.length)
      if (!classId) throw badRequest('Choose the class these students join.')

      const studentRole = await roleId(c, 'STUDENT')
      const cls = (await c.query<any>('SELECT id, name, grade_level, section_label FROM school_class WHERE id = $1',
        [classId]))[0]
      if (!cls) throw notFound('No such class.')

      const slips: Array<{ name: string; roll: string; password: string }> = []
      for (const r of ready) {
        const id = randomUUID()
        const temp = tempPassword(6)
        // Students get a username, not an email address: most of them do not
        // have one, and requiring it would manufacture a child-data liability.
        await c.query(
          `INSERT INTO app_user (id, tenant_id, email, username, password_hash, full_name, status, must_change_pw)
           VALUES ($1,$2,NULL,$3,$4,$5,'active',true)`,
          [id, req.access.tenantId, r.roll, await hashPassword(temp), r.name])
        await c.query('INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)',
          [req.access.tenantId, id, studentRole])
        await c.query(
          `INSERT INTO student_profile (tenant_id, user_id, roll_no, grade_level, section_label)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.access.tenantId, id, r.roll, `Class ${cls.grade_level}`, r.section || cls.section_label])
        await c.query('INSERT INTO class_student (tenant_id, class_id, user_id) VALUES ($1,$2,$3)',
          [req.access.tenantId, classId, id])
        const course = (await c.query<{ course_id: string }>('SELECT course_id FROM school_class WHERE id = $1',
          [classId]))[0]
        await c.query(
          `INSERT INTO enrollment (id, tenant_id, user_id, course_id, class_id, source)
           VALUES ($1,$2,$3,$4,$5,'class')`,
          [randomUUID(), req.access.tenantId, id, course.course_id, classId])
        slips.push({ name: r.name, roll: r.roll, password: temp })
      }

      await req.log_audit(c, {
        action: 'user.imported', entityType: 'school_class', entityId: classId,
        summary: `Imported ${slips.length} students into ${cls.name}`,
      })
      return { preview: false, created: slips.length, slips, seats: await seatSummary(c, req.access.tenantId) }
    })
  })

  app.post('/api/v1/school/students/:id/reset-password', requires('user:reset_password'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const s = (await c.query<any>('SELECT full_name FROM app_user WHERE id = $1', [id]))[0]
      if (!s) throw notFound('No such student.')
      const temp = tempPassword(6)
      await c.query(
        `UPDATE app_user SET password_hash = $1, must_change_pw = true, perm_version = perm_version + 1
          WHERE id = $2`, [await hashPassword(temp), id])
      await c.query('UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id])
      invalidateAccess(id)
      await req.log_audit(c, {
        action: 'user.password.reset', entityType: 'app_user', entityId: id,
        summary: `Issued a temporary password for ${s.full_name}`,
      })
      return { temporaryPassword: temp }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/school/classes', requires('class:read'), async req =>
    req.db(async c => ({
      classes: await c.query(`
        WITH node_total AS (
          SELECT count(*)::numeric AS n FROM (
            SELECT id FROM video UNION ALL SELECT id FROM material UNION ALL SELECT id FROM practice_lab) z)
        SELECT sc.id, sc.name, sc.grade_level, co.title AS course,
               coalesce(string_agg(DISTINCT tu.full_name, ', '), '—') AS teacher,
               count(DISTINCT cs.user_id)::int AS students,
               round(coalesce(count(p.id) FILTER (WHERE p.status='completed')::numeric
                 / nullif(count(DISTINCT cs.user_id) * (SELECT n FROM node_total), 0) * 100, 0))::int AS completion
          FROM school_class sc
          JOIN course co ON co.id = sc.course_id
          LEFT JOIN class_student cs ON cs.class_id = sc.id AND cs.left_at IS NULL
          LEFT JOIN class_teacher ct ON ct.class_id = sc.id
          LEFT JOIN app_user tu ON tu.id = ct.user_id
          LEFT JOIN progress p ON p.user_id = cs.user_id
         GROUP BY sc.id, sc.name, sc.grade_level, co.title
         ORDER BY sc.name`),
      teachers: await c.query(`
        SELECT u.id, u.full_name FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id
          JOIN role r ON r.id = ur.role_id AND r.key='TEACHER'
         WHERE u.deleted_at IS NULL ORDER BY u.full_name`),
      courses: await c.query(`
        SELECT co.id, co.title, co.level_label FROM course co
          JOIN tenant_entitlement e ON e.resource_id = co.id AND e.resource_type='course' AND e.status='active'
         ORDER BY co.level_label DESC`),
      unassigned: await c.query(`
        SELECT u.id, u.full_name, sp.roll_no FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id
          JOIN role r ON r.id = ur.role_id AND r.key='STUDENT'
          LEFT JOIN student_profile sp ON sp.user_id = u.id
         WHERE u.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM class_student cs WHERE cs.user_id = u.id AND cs.left_at IS NULL)
         ORDER BY sp.roll_no LIMIT 60`),
    })))

  app.post('/api/v1/school/classes', requires('class:create'), async req => {
    const b = (req.body ?? {}) as any
    const name = String(b.name ?? '').trim()
    if (!name || !b.courseId) throw badRequest('A class needs a name and a course.')
    return req.db(async c => {
      // Only courses the school is entitled to can be chosen — checked here,
      // not merely filtered out of the dropdown.
      const ent = await c.query('SELECT 1 FROM tenant_entitlement WHERE resource_type=$1 AND resource_id=$2 AND status=$3',
        ['course', b.courseId, 'active'])
      if (!ent.length) throw notFound('That course is not part of your licence.')

      const year = (await c.query<{ id: string }>(
        'SELECT id FROM academic_year WHERE is_current = true ORDER BY starts_on DESC LIMIT 1'))[0]
      if (!year) throw conflict('No academic year is set up yet.', 'no_academic_year')

      const id = randomUUID()
      await c.query(
        `INSERT INTO school_class (id, tenant_id, academic_year_id, course_id, name, grade_level, section_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, req.access.tenantId, year.id, b.courseId, name, b.gradeLevel ?? '', b.sectionLabel ?? ''])
      await c.query(
        `INSERT INTO course_assignment (id, tenant_id, class_id, course_id, assigned_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), req.access.tenantId, id, b.courseId, req.access.userId])

      if (b.teacherId) {
        await c.query('INSERT INTO class_teacher (tenant_id, class_id, user_id) VALUES ($1,$2,$3)',
          [req.access.tenantId, id, b.teacherId])
      }
      const studentIds: string[] = Array.isArray(b.studentIds) ? b.studentIds : []
      for (const sid of studentIds) {
        await c.query('INSERT INTO class_student (tenant_id, class_id, user_id) VALUES ($1,$2,$3)',
          [req.access.tenantId, id, sid])
        await c.query(
          `INSERT INTO enrollment (id, tenant_id, user_id, course_id, class_id, source)
           VALUES ($1,$2,$3,$4,$5,'class')
           ON CONFLICT (tenant_id, user_id, course_id) DO NOTHING`,
          [randomUUID(), req.access.tenantId, sid, b.courseId, id])
      }

      await req.log_audit(c, {
        action: 'class.created', entityType: 'school_class', entityId: id,
        summary: `Created ${name} with ${studentIds.length} students`, after: { name, course_id: b.courseId },
      })
      return { id, students: studentIds.length }
    })
  })

  app.get('/api/v1/school/classes/:id', requires('class:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const cls = (await c.query<any>(`
        SELECT sc.id, sc.name, sc.grade_level, co.title AS course,
               coalesce(string_agg(DISTINCT tu.full_name, ', '), '—') AS teacher
          FROM school_class sc JOIN course co ON co.id = sc.course_id
          LEFT JOIN class_teacher ct ON ct.class_id = sc.id
          LEFT JOIN app_user tu ON tu.id = ct.user_id
         WHERE sc.id = $1 GROUP BY sc.id, sc.name, sc.grade_level, co.title`, [id]))[0]
      if (!cls) throw notFound('No such class.')
      return { class: cls, students: await classRoster(c, id) }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/school/exams', requires('exam:read'), async req =>
    req.db(async c => ({
      exams: await c.query(`
        SELECT e.id, e.title, e.starts_at, e.status, sc.name AS class_name,
               (SELECT count(*)::int FROM class_student cs WHERE cs.class_id = e.class_id AND cs.left_at IS NULL) AS enrolled,
               (SELECT count(*)::int FROM exam_attempt a WHERE a.exam_id = e.id) AS sat,
               (SELECT round(avg(a.total_score / nullif(a.max_score,0))*100)::int
                  FROM exam_attempt a WHERE a.exam_id = e.id AND a.total_score IS NOT NULL) AS avg_pct,
               (SELECT count(*)::int FROM exam_answer ea
                  JOIN exam_attempt at2 ON at2.id = ea.attempt_id AND at2.exam_id = e.id
                  JOIN exam_question eq ON eq.id = ea.exam_question_id
                 WHERE eq.kind='written' AND ea.marks_awarded IS NULL) AS to_mark
          FROM exam e JOIN school_class sc ON sc.id = e.class_id
         ORDER BY e.starts_at DESC`),
    })))

  // -------------------------------------------------------------------------
  app.get('/api/v1/school/reports', requires('report:read:tenant'), async req =>
    req.db(async c => ({
      teacherActivity: await c.query(`
        SELECT u.full_name,
               (SELECT count(*)::int FROM assignment a
                 WHERE a.created_by = u.id AND a.created_at > now() - interval '30 days') AS assigned,
               (SELECT count(*)::int FROM lab_submission ls
                  JOIN class_teacher ct2 ON ct2.class_id = ls.class_id AND ct2.user_id = u.id
                 WHERE ls.status='submitted') AS pending
          FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id
          JOIN role r ON r.id = ur.role_id AND r.key='TEACHER'
         WHERE u.deleted_at IS NULL ORDER BY assigned DESC`),
      examAverages: await c.query(`
        SELECT e.title, round(avg(a.total_score / nullif(a.max_score,0))*100)::int AS avg_pct
          FROM exam e JOIN exam_attempt a ON a.exam_id = e.id
         WHERE a.total_score IS NOT NULL GROUP BY e.title ORDER BY e.title`),
      pending: (await c.query<any>(`
        SELECT (SELECT count(*)::int FROM lab_submission WHERE status='submitted') AS labs,
               (SELECT count(*)::int FROM exam_answer ea
                  JOIN exam_question eq ON eq.id = ea.exam_question_id
                 WHERE eq.kind='written' AND ea.marks_awarded IS NULL) AS papers`))[0],
      seats: await seatSummary(c, req.access.tenantId),
      inactive: await c.query(`
        SELECT u.full_name, sp.roll_no, sc.name AS class_name, max(p.last_activity_at) AS last_seen
          FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id
          JOIN role r ON r.id = ur.role_id AND r.key='STUDENT'
          LEFT JOIN student_profile sp ON sp.user_id = u.id
          LEFT JOIN class_student cs ON cs.user_id = u.id AND cs.left_at IS NULL
          LEFT JOIN school_class sc ON sc.id = cs.class_id
          LEFT JOIN progress p ON p.user_id = u.id
         WHERE u.deleted_at IS NULL
         GROUP BY u.full_name, sp.roll_no, sc.name
        HAVING max(p.last_activity_at) IS NULL OR max(p.last_activity_at) < now() - interval '7 days'
         ORDER BY last_seen NULLS FIRST LIMIT 25`),
    })))

  // -------------------------------------------------------------------------
  app.get('/api/v1/school/profile', requires('user:read'), async req =>
    req.db(async c => ({
      school: (await c.query<any>(`
        SELECT t.id, t.name, t.school_code, t.area, t.board, t.status, t.joined_on, t.contact,
               b.display_name, b.primary_color, b.secondary_color, b.welcome_message
          FROM tenant t JOIN tenant_branding b ON b.tenant_id = t.id WHERE t.id = $1`,
        [req.access.tenantId]))[0],
      licence: await seatSummary(c, req.access.tenantId),
      counts: (await c.query<any>(`
        SELECT (SELECT count(*)::int FROM app_user u JOIN user_role ur ON ur.user_id=u.id
                  JOIN role r ON r.id=ur.role_id AND r.key='TEACHER' WHERE u.deleted_at IS NULL) AS teachers,
               (SELECT count(*)::int FROM app_user u JOIN user_role ur ON ur.user_id=u.id
                  JOIN role r ON r.id=ur.role_id AND r.key='STUDENT' WHERE u.deleted_at IS NULL) AS students,
               (SELECT count(*)::int FROM school_class) AS classes`))[0],
    })))

  app.patch('/api/v1/school/profile', requires('school:update'), async req => {
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const before = (await c.query<any>('SELECT name, area, board FROM tenant WHERE id = $1', [req.access.tenantId]))[0]
      await c.query(
        `UPDATE tenant SET name = coalesce($1,name), area = coalesce($2,area), board = coalesce($3,board),
                           contact = coalesce($4, contact)
          WHERE id = $5`,
        [b.name ?? null, b.area ?? null, b.board ?? null,
          b.contact ? JSON.stringify(b.contact) : null, req.access.tenantId])
      await req.log_audit(c, {
        action: 'tenant.updated', entityType: 'tenant', entityId: req.access.tenantId,
        summary: 'Updated the school profile', before, after: { name: b.name, area: b.area, board: b.board },
      })
      return { ok: true }
    })
  })

  /**
   * Branding. Colours are validated server-side against a strict pattern before
   * they are ever interpolated into a stylesheet, so a branding field cannot
   * become a CSS injection.
   */
  app.patch('/api/v1/school/branding', requires('branding:manage'), async req => {
    const b = (req.body ?? {}) as any
    const hex = /^#[0-9a-fA-F]{6}$/
    if (b.primaryColor && !hex.test(b.primaryColor)) throw badRequest('Primary colour must be a hex value like #FFC93C.')
    if (b.secondaryColor && !hex.test(b.secondaryColor)) throw badRequest('Secondary colour must be a hex value like #2B6CB0.')
    return req.db(async c => {
      const before = (await c.query<any>(
        'SELECT display_name, primary_color, secondary_color, welcome_message FROM tenant_branding WHERE tenant_id = $1',
        [req.access.tenantId]))[0]
      await c.query(
        `UPDATE tenant_branding
            SET display_name = coalesce($1, display_name),
                primary_color = coalesce($2, primary_color),
                secondary_color = coalesce($3, secondary_color),
                welcome_message = coalesce($4, welcome_message)
          WHERE tenant_id = $5`,
        [b.displayName ?? null, b.primaryColor ?? null, b.secondaryColor ?? null,
          b.welcomeMessage ?? null, req.access.tenantId])
      await req.log_audit(c, {
        action: 'tenant.branding.updated', entityType: 'tenant', entityId: req.access.tenantId,
        summary: 'Updated branding', before, after: b,
      })
      return { ok: true }
    })
  })

  app.get('/api/v1/school/audit', requires('audit:read:tenant'), async req =>
    req.db(async c => ({
      entries: await c.query(`
        SELECT a.id, a.action, a.entity_type, a.summary, a.occurred_at, u.full_name AS actor
          FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id
         ORDER BY a.occurred_at DESC LIMIT 100`),
    })))
}

export async function classRoster(c: Conn, classId: string) {
  return c.query<any>(`
    WITH node_total AS (
      SELECT count(*)::numeric AS n FROM (
        SELECT id FROM video UNION ALL SELECT id FROM material UNION ALL SELECT id FROM practice_lab) z)
    SELECT u.id, u.full_name, u.last_login_at, sp.roll_no,
           count(p.id) FILTER (WHERE p.status='completed')::int AS done,
           (SELECT n FROM node_total)::int AS total_nodes,
           coalesce(round(sum(p.seconds_spent)/60.0)::int, 0) AS minutes,
           (SELECT count(*)::int FROM lab_submission ls WHERE ls.user_id = u.id AND ls.status='graded') AS labs_graded,
           (SELECT count(*)::int FROM graded_lab) AS labs_total,
           (SELECT round(max(a.total_score / nullif(a.max_score,0))*100)::int
              FROM exam_attempt a WHERE a.user_id = u.id AND a.total_score IS NOT NULL) AS last_exam
      FROM class_student cs
      JOIN app_user u ON u.id = cs.user_id
      LEFT JOIN student_profile sp ON sp.user_id = u.id
      LEFT JOIN progress p ON p.user_id = u.id
     WHERE cs.class_id = $1 AND cs.left_at IS NULL AND u.deleted_at IS NULL
     GROUP BY u.id, u.full_name, u.last_login_at, sp.roll_no
     ORDER BY sp.roll_no`, [classId])
}
