/**
 * Brolly admin.
 *
 * Everything here returns counts and rates. The database itself refuses to hand
 * this scope a lab submission, an exam answer or a student profile — there is no
 * RLS policy granting platform scope access to those tables — so "Brolly cannot
 * open a student's answer sheet" is not a promise the UI is making.
 */

import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { withPlatformInTenant, hashPassword, tempPassword, sha256 } from '@brolly/db'
import type { Conn } from '@brolly/db'
import { badRequest, conflict, notFound } from '../http.ts'
import { requires } from '../guards.ts'
import { FEATURE_DEFAULTS } from '@brolly/shared'

const SEVEN_DAYS = `now() - interval '7 days'`

/** One query, every school, all rates computed from rows. */
async function schoolMetrics(c: Conn) {
  return c.query<any>(`
    WITH node_total AS (
      SELECT count(*)::numeric AS n FROM (
        SELECT id FROM video
        UNION ALL SELECT id FROM material
        UNION ALL SELECT id FROM practice_lab
      ) z
    ),
    students AS (
      SELECT u.tenant_id, u.id
        FROM app_user u
        JOIN user_role ur ON ur.user_id = u.id
        JOIN role r ON r.id = ur.role_id AND r.key = 'STUDENT'
       WHERE u.deleted_at IS NULL
    ),
    per_student AS (
      SELECT s.tenant_id, s.id,
             count(p.id) FILTER (WHERE p.status = 'completed')::numeric AS done,
             max(p.last_activity_at) AS last_seen
        FROM students s
        LEFT JOIN progress p ON p.user_id = s.id
       GROUP BY s.tenant_id, s.id
    ),
    exam_avg AS (
      SELECT e.tenant_id,
             avg(a.total_score / nullif(a.max_score, 0)) * 100 AS avg_pct
        FROM exam_attempt a JOIN exam e ON e.id = a.exam_id
       WHERE a.total_score IS NOT NULL
       GROUP BY e.tenant_id
    ),
    teachers AS (
      SELECT u.tenant_id, count(*)::int AS n
        FROM app_user u JOIN user_role ur ON ur.user_id = u.id
        JOIN role r ON r.id = ur.role_id AND r.key = 'TEACHER'
       WHERE u.deleted_at IS NULL GROUP BY u.tenant_id
    ),
    classes AS (SELECT tenant_id, count(*)::int AS n FROM school_class GROUP BY tenant_id)
    SELECT t.id, t.name, t.area, t.school_code, t.status, t.joined_on,
           l.seats, l.levels, l.valid_until,
           coalesce(cl.n, 0)                                          AS classes,
           coalesce(te.n, 0)                                          AS teachers,
           count(ps.id)::int                                          AS students,
           round(coalesce(avg(ps.done) / (SELECT n FROM node_total) * 100, 0))::int AS completion,
           round(coalesce(
             count(ps.id) FILTER (WHERE ps.last_seen > ${SEVEN_DAYS})::numeric
             / nullif(count(ps.id), 0) * 100, 0))::int                AS usage_pct,
           round(coalesce(ea.avg_pct, 0))::int                        AS avg_exam
      FROM tenant t
      LEFT JOIN licence l  ON l.tenant_id = t.id AND l.status = 'active'
      LEFT JOIN per_student ps ON ps.tenant_id = t.id
      LEFT JOIN exam_avg ea ON ea.tenant_id = t.id
      LEFT JOIN teachers te ON te.tenant_id = t.id
      LEFT JOIN classes  cl ON cl.tenant_id = t.id
     WHERE t.is_platform = false
     GROUP BY t.id, t.name, t.area, t.school_code, t.status, t.joined_on,
              l.seats, l.levels, l.valid_until, ea.avg_pct, te.n, cl.n
     ORDER BY usage_pct ASC`)
}

async function syncState(c: Conn) {
  const s = (await c.query<any>('SELECT * FROM hub_sync_state WHERE id = 1'))[0]
  const held = (await c.query<{ n: string }>(`
    SELECT (
      (SELECT count(*) FROM video) + (SELECT count(*) FROM material) +
      (SELECT count(*) FROM practice_lab) + (SELECT count(*) FROM graded_lab) +
      (SELECT count(*) FROM question)
    )::text AS n`))[0].n
  const pending = (await c.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM hub_change WHERE seq > $1', [s?.cursor_seq ?? 0]))[0].n
  const release = (await c.query<any>(
    `SELECT release_no, published_at FROM content_release
      WHERE scope = 'course' AND status = 'published' ORDER BY published_at DESC LIMIT 1`))[0]
  return {
    cursor: `v${s?.cursor_seq ?? 0}`,
    lastRunAt: s?.last_run_at ?? null,
    itemsHeld: Number(held),
    pending: Number(pending),
    failedRuns: s?.failed_runs ?? 0,
    releaseNo: release?.release_no ?? null,
    releasePublishedAt: release?.published_at ?? null,
  }
}

export default async function platformRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  app.get('/api/v1/platform/overview', requires('report:read:platform'), async req =>
    req.platformDb(async c => {
      const schools = await schoolMetrics(c)
      const totals = schools.reduce((a, s) => ({
        students: a.students + s.students,
        teachers: a.teachers + s.teachers,
        seats: a.seats + (s.seats ?? 0),
      }), { students: 0, teachers: 0, seats: 0 })
      const admins = Number((await c.query<{ n: string }>(`
        SELECT count(DISTINCT u.id)::text AS n FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id
          JOIN role r ON r.id = ur.role_id AND r.key = 'SCHOOL_ADMIN'`))[0].n)
      return { schools, totals: { ...totals, admins, schools: schools.length }, sync: await syncState(c) }
    }))

  // -------------------------------------------------------------------------
  app.get('/api/v1/platform/schools', requires('tenant:read'), async req =>
    req.platformDb(async c => ({ schools: await schoolMetrics(c) })))

  app.get('/api/v1/platform/schools/:id', requires('tenant:read'), async req => {
    const id = (req.params as any).id
    return req.platformDb(async c => {
      const rows = await schoolMetrics(c)
      const school = rows.find(r => r.id === id)
      if (!school) throw notFound('No such school.')
      const classes = await c.query<any>(
        `SELECT sc.id, sc.name, sc.grade_level,
                (SELECT count(*)::int FROM class_student cs WHERE cs.class_id = sc.id) AS students
           FROM school_class sc WHERE sc.tenant_id = $1 ORDER BY sc.name`, [id])
      return { school, classes }
    })
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/platform/schools', requires('tenant:create'), async req => {
    const b = (req.body ?? {}) as any
    const name = String(b.name ?? '').trim()
    const schoolCode = String(b.schoolCode ?? '').trim().toUpperCase()
    const adminName = String(b.adminName ?? '').trim()
    const adminEmail = String(b.adminEmail ?? '').trim().toLowerCase()
    if (!name || !schoolCode || !adminName || !adminEmail) {
      throw badRequest('School name, school code, admin name and admin email are all needed.')
    }
    if (!/^[A-Z0-9-]{3,16}$/.test(schoolCode)) {
      throw badRequest('School code: 3–16 characters, letters, digits and hyphens. Students type this at login.')
    }

    const result = await req.platformDb(async c => {
      if ((await c.query('SELECT 1 FROM tenant WHERE lower(school_code) = lower($1)', [schoolCode])).length) {
        throw conflict('That school code is already taken.', 'code_taken')
      }
      if ((await c.query('SELECT 1 FROM app_user WHERE lower(email) = lower($1)', [adminEmail])).length) {
        throw conflict('That email already has a login on the platform.', 'email_taken')
      }

      const tenantId = randomUUID()
      await c.query(
        `INSERT INTO tenant (id, school_code, name, area, board, tenant_type, status, contact)
         VALUES ($1,$2,$3,$4,$5,'B2B','provisioning',$6)`,
        [tenantId, schoolCode, name, b.area ?? '', b.board ?? 'CBSE',
          JSON.stringify({ person: adminName, email: adminEmail, phone: b.adminPhone ?? '' })])

      await c.query(
        `INSERT INTO tenant_branding (tenant_id, display_name, short_name, logo_text,
           primary_color, secondary_color, welcome_message)
         VALUES ($1,$2,$3,$4,'#FFC93C','#2B6CB0',$5)`,
        [tenantId, name, name.split(' ')[0],
          name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
          `Welcome to ${name}`])

      for (const [key, enabled] of Object.entries(FEATURE_DEFAULTS.B2B)) {
        await c.query('INSERT INTO tenant_feature (tenant_id, feature_key, enabled) VALUES ($1,$2,$3)',
          [tenantId, key, enabled])
      }

      const seats = Number(b.seats ?? 150)
      await c.query(
        `INSERT INTO licence (id, tenant_id, seats, levels, valid_until, status)
         VALUES ($1,$2,$3,$4,$5,'active')`,
        [randomUUID(), tenantId, seats, b.levels ?? 'Class 9', b.validUntil ?? '2027-03-31'])

      const courses = await c.query<{ id: string; level_label: string }>(
        `SELECT id, level_label FROM course WHERE status = 'published'`)
      for (const course of courses) {
        const wanted = String(b.levels ?? 'Class 9')
        if (!wanted.includes(course.level_label.replace('Class ', ''))) continue
        await c.query(
          `INSERT INTO tenant_entitlement (id, tenant_id, resource_type, resource_id, source, status)
           VALUES ($1,$2,'course',$3,'licence','active')`, [randomUUID(), tenantId, course.id])
      }

      // The one login Brolly creates. After this the school runs itself, which
      // is what keeps Brolly out of daily account work as schools are added.
      const adminId = randomUUID()
      const temp = tempPassword(8)
      const roleId = (await c.query<{ id: string }>(
        `SELECT id FROM role WHERE key = 'SCHOOL_ADMIN' AND tenant_id IS NULL`))[0].id
      await c.query(
        `INSERT INTO app_user (id, tenant_id, email, username, password_hash, full_name, phone, status, must_change_pw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',true)`,
        [adminId, tenantId, adminEmail, adminEmail.split('@')[0], await hashPassword(temp),
          adminName, b.adminPhone ?? ''])
      await c.query('INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)',
        [tenantId, adminId, roleId])

      await req.log_audit(c, {
        action: 'tenant.created', entityType: 'tenant', entityId: tenantId,
        summary: `Created school — ${name} (${schoolCode})`,
        after: { name, school_code: schoolCode, seats },
      })
      return { tenantId, adminEmail, temporaryPassword: temp, schoolCode, seats }
    })

    // Tenant-scoped rows are written with platform scope dropped, so the same
    // rules that bind a school admin bind Brolly here too.
    await withPlatformInTenant(result.tenantId, req.access.userId, async c => {
      await c.query(
        `INSERT INTO academic_year (id, tenant_id, name, starts_on, ends_on, is_current)
         VALUES ($1,$2,'2026–27','2026-04-01','2027-03-31',true)`,
        [randomUUID(), result.tenantId])
    })

    return result
  })

  app.post('/api/v1/platform/schools/:id/status', requires('tenant:suspend'), async req => {
    const id = (req.params as any).id
    const status = String((req.body as any)?.status ?? '')
    if (!['active', 'suspended', 'archived', 'provisioning'].includes(status)) throw badRequest('Unknown status.')
    return req.platformDb(async c => {
      const before = (await c.query<any>('SELECT name, status FROM tenant WHERE id = $1', [id]))[0]
      if (!before) throw notFound('No such school.')
      await c.query('UPDATE tenant SET status = $1 WHERE id = $2', [status, id])
      await req.log_audit(c, {
        action: status === 'suspended' ? 'tenant.suspended' : 'tenant.updated',
        entityType: 'tenant', entityId: id,
        summary: `${before.name} → ${status}`, before, after: { status },
      })
      return { ok: true, status }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/platform/licences', requires('licence:manage'), async req =>
    req.platformDb(async c => ({ schools: await schoolMetrics(c) })))

  app.put('/api/v1/platform/licences/:tenantId', requires('licence:manage'), async req => {
    const tenantId = (req.params as any).tenantId
    const b = (req.body ?? {}) as any
    return req.platformDb(async c => {
      const before = (await c.query<any>(
        `SELECT id, seats, levels, valid_until FROM licence WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId]))[0]
      if (!before) throw notFound('That school has no active licence.')

      const inUse = Number((await c.query<{ n: string }>(`
        SELECT count(*)::text AS n FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id
          JOIN role r ON r.id = ur.role_id AND r.key = 'STUDENT'
         WHERE u.tenant_id = $1 AND u.deleted_at IS NULL`, [tenantId]))[0].n)
      const seats = Number(b.seats ?? before.seats)
      if (seats < inUse) throw conflict(`That school already has ${inUse} students. Seats cannot go below that.`, 'seats_below_used')

      await c.query(
        `UPDATE licence SET seats = $1, levels = $2, valid_until = $3 WHERE id = $4`,
        [seats, b.levels ?? before.levels, b.validUntil ?? before.valid_until, before.id])
      const name = (await c.query<any>('SELECT name FROM tenant WHERE id = $1', [tenantId]))[0]?.name
      await req.log_audit(c, {
        action: 'licence.updated', entityType: 'licence', entityId: before.id,
        summary: `${name} — ${seats} seats, ${b.levels ?? before.levels}, to ${b.validUntil ?? before.valid_until}`,
        before, after: { seats, levels: b.levels ?? before.levels, valid_until: b.validUntil ?? before.valid_until },
      })
      return { ok: true }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/platform/content', requires('content:read'), async req =>
    req.platformDb(async c => ({
      sync: await syncState(c),
      courses: await c.query(
        `SELECT c.id, c.title, c.level_label, c.code, c.status,
                (SELECT count(*)::int FROM unit WHERE course_id = c.id) AS units,
                (SELECT count(*)::int FROM tenant_entitlement e
                  WHERE e.resource_type='course' AND e.resource_id = c.id AND e.status='active') AS schools
           FROM course c ORDER BY c.level_label DESC`),
      units: await c.query(
        `SELECT u.id, u.code, u.title, u.hours_label, u.marks, u.status,
                (SELECT count(*)::int FROM video WHERE unit_id = u.id)        AS videos,
                (SELECT count(*)::int FROM material WHERE unit_id = u.id)     AS materials,
                (SELECT count(*)::int FROM practice_lab WHERE unit_id = u.id) AS practice,
                (SELECT count(*)::int FROM question WHERE unit_id = u.id AND kind='objective') AS objective,
                (SELECT count(*)::int FROM question WHERE unit_id = u.id AND kind='written')   AS written
           FROM unit u ORDER BY u.position`),
      videos: await c.query(
        `SELECT v.id, v.title, v.duration_seconds, u.code AS unit
           FROM video v JOIN unit u ON u.id = v.unit_id ORDER BY u.position, v.position`),
      materials: await c.query(
        `SELECT m.id, m.title, m.kind, m.pages, u.code AS unit,
                cv.version_no, cv.published_at
           FROM material m
           JOIN unit u ON u.id = m.unit_id
           LEFT JOIN content_version cv
             ON cv.content_item_id = m.content_item_id AND cv.status = 'published'
          ORDER BY u.position, m.position`),
      practice: await c.query(
        `SELECT p.id, p.title, p.level, u.code AS unit
           FROM practice_lab p JOIN unit u ON u.id = p.unit_id ORDER BY u.position, p.position`),
      gradedLabs: await c.query(
        `SELECT g.id, g.program_no, g.title, g.mode, g.max_score FROM graded_lab g ORDER BY g.program_no`),
    })))

  /**
   * Publish a new version of a material.
   *
   * This is the §44 scenario end to end: a new immutable content_version is
   * written, the old one archived, a new release pinned and the pointer moved —
   * all inside one transaction, guarded by the partial unique index that allows
   * exactly one published version per item. No deploy, and rollback is the same
   * operation with the release numbers swapped.
   */
  app.post('/api/v1/platform/materials/:id/publish', requires('content:publish'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    if (!Array.isArray(b.body) || !b.body.length) throw badRequest('A material needs at least one block.')

    return req.platformDb(async c => {
      const m = (await c.query<any>(
        `SELECT m.id, m.title, m.content_item_id, u.course_id
           FROM material m JOIN unit u ON u.id = m.unit_id WHERE m.id = $1`, [id]))[0]
      if (!m) throw notFound('No such material.')

      const current = (await c.query<any>(
        `SELECT id, version_no FROM content_version
          WHERE content_item_id = $1 AND status = 'published' AND locale = 'en'`, [m.content_item_id]))[0]

      const nextNo = (current?.version_no ?? 0) + 1
      const payload = JSON.stringify(b.body)

      if (current) await c.query(`UPDATE content_version SET status = 'archived' WHERE id = $1`, [current.id])
      const versionId = randomUUID()
      await c.query(
        `INSERT INTO content_version
           (id, content_item_id, version_no, locale, status, body, body_hash, changelog, created_by, published_at)
         VALUES ($1,$2,$3,'en','published',$4,$5,$6,$7, now())`,
        [versionId, m.content_item_id, nextNo, payload, sha256(payload),
          String(b.changelog ?? 'Edited in the Content Hub'), req.access.userId])

      // move the pointer
      const prev = (await c.query<any>(
        `SELECT id, release_no FROM content_release
          WHERE scope='course' AND scope_id=$1 AND status='published'`, [m.course_id]))[0]
      if (prev) await c.query(`UPDATE content_release SET status='superseded' WHERE id=$1`, [prev.id])
      const releaseNo = (prev?.release_no ?? 0) + 1
      await c.query(
        `INSERT INTO content_release (id, scope, scope_id, release_no, status, manifest, published_at, published_by)
         VALUES ($1,'course',$2,$3,'published',$4, now(), $5)`,
        [randomUUID(), m.course_id, releaseNo,
          JSON.stringify({ changed: m.title, versionNo: nextNo, changelog: b.changelog ?? '' }),
          req.access.userId])

      await c.query(
        `INSERT INTO hub_change (entity_type, entity_id, op, payload) VALUES ('material',$1,'upsert',$2)`,
        [id, JSON.stringify({ versionNo: nextNo })])

      await req.log_audit(c, {
        action: 'content.release.published', entityType: 'material', entityId: id,
        summary: `Published "${m.title}" version ${nextNo} as release ${releaseNo}`,
        after: { title: m.title, release_no: releaseNo },
      })
      return { ok: true, versionNo: nextNo, releaseNo }
    })
  })

  app.get('/api/v1/platform/materials/:id', requires('content:read'), async req => {
    const id = (req.params as any).id
    return req.platformDb(async c => {
      const rows = await c.query<any>(
        `SELECT m.id, m.title, m.kind, m.pages, u.code AS unit, cv.body, cv.version_no, cv.published_at, cv.changelog
           FROM material m JOIN unit u ON u.id = m.unit_id
           LEFT JOIN content_version cv ON cv.content_item_id = m.content_item_id AND cv.status = 'published'
          WHERE m.id = $1`, [id])
      if (!rows.length) throw notFound('No such material.')
      const history = await c.query<any>(
        `SELECT cv.version_no, cv.status, cv.published_at, cv.changelog
           FROM content_version cv
           JOIN material m ON m.content_item_id = cv.content_item_id
          WHERE m.id = $1 ORDER BY cv.version_no DESC`, [id])
      return { material: rows[0], history }
    })
  })

  // -------------------------------------------------------------------------
  app.post('/api/v1/platform/sync/run', requires('sync:run'), async req =>
    req.platformDb(async c => {
      const state = (await c.query<any>('SELECT * FROM hub_sync_state WHERE id = 1'))[0]
      const pending = await c.query<any>(
        'SELECT seq, entity_type, entity_id FROM hub_change WHERE seq > $1 ORDER BY seq', [state?.cursor_seq ?? 0])
      const newCursor = pending.length ? pending[pending.length - 1].seq : (state?.cursor_seq ?? 0)
      await c.query(
        `UPDATE hub_sync_state SET cursor_seq = $1, last_run_at = now(), last_ok_at = now() WHERE id = 1`,
        [newCursor])
      await req.log_audit(c, {
        action: 'sync.run', entityType: 'hub', summary: `Pulled ${pending.length} change(s) from the Content Hub`,
      })
      return { pulled: pending.length, sync: await syncState(c) }
    }))

  // -------------------------------------------------------------------------
  app.get('/api/v1/platform/reports', requires('report:read:platform'), async req =>
    req.platformDb(async c => ({
      schools: await schoolMetrics(c),
      byUnit: await c.query<any>(`
        WITH nodes AS (
          SELECT u.code, u.position, v.id FROM unit u JOIN video v ON v.unit_id = u.id
          UNION ALL
          SELECT u.code, u.position, m.id FROM unit u JOIN material m ON m.unit_id = u.id
          UNION ALL
          SELECT u.code, u.position, p.id FROM unit u JOIN practice_lab p ON p.unit_id = u.id
        ),
        learners AS (
          SELECT count(DISTINCT u.id)::numeric AS n FROM app_user u
            JOIN user_role ur ON ur.user_id = u.id
            JOIN role r ON r.id = ur.role_id AND r.key = 'STUDENT'
           WHERE u.deleted_at IS NULL
        )
        SELECT n.code, min(n.position) AS position,
               round(count(p.id) FILTER (WHERE p.status='completed')::numeric
                     / nullif(count(DISTINCT n.id) * (SELECT n FROM learners), 0) * 100)::int AS completion
          FROM nodes n
          LEFT JOIN progress p ON p.node_id = n.id
         GROUP BY n.code ORDER BY position`),
      examAverages: await c.query<any>(`
        SELECT e.title, round(avg(a.total_score / nullif(a.max_score,0)) * 100)::int AS avg_pct,
               count(*)::int AS sat
          FROM exam_attempt a JOIN exam e ON e.id = a.exam_id
         WHERE a.total_score IS NOT NULL
         GROUP BY e.title ORDER BY e.title`),
    })))

  app.get('/api/v1/platform/audit', requires('audit:read:platform'), async req =>
    req.platformDb(async c => ({
      entries: await c.query(
        `SELECT a.id, a.action, a.entity_type, a.summary, a.occurred_at, a.actor_scope,
                u.full_name AS actor, t.name AS school
           FROM audit_log a
           LEFT JOIN app_user u ON u.id = a.actor_user_id
           LEFT JOIN tenant t ON t.id = a.tenant_id
          ORDER BY a.occurred_at DESC LIMIT 100`),
    })))
}
