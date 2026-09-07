/**
 * Brolly Admin: the whole platform.
 *
 * The Content Hub lives here. Its central promise — requirement 15 — is that
 * publishing a new version of a chapter reaches students with no deploy of any
 * kind. That is achieved by writing a new immutable content_version, archiving
 * the previous one and moving a single release pointer, all in one transaction.
 */

import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { hashPassword, tempPassword, sha256 } from '@brolly/b2c-db'
import { badRequest, conflict, notFound } from '../http.ts'
import { requires } from '../guards.ts'
import { invalidateAccess } from '../access.ts'
import { storageKeyFor, signAsset } from '../media.ts'

export default async function adminRoutes(app: FastifyInstance) {
  // =========================================================================
  // Overview and analytics
  // =========================================================================

  app.get('/api/v1/admin/overview', requires('analytics:read:platform'), async req =>
    req.db(async c => ({
      totals: (await c.query<any>(`
        SELECT
          (SELECT count(*)::int FROM app_user u JOIN user_role ur ON ur.user_id=u.id
             JOIN role r ON r.id=ur.role_id AND r.key='STUDENT' WHERE u.deleted_at IS NULL) AS students,
          (SELECT count(DISTINCT p.user_id)::int FROM progress p
            WHERE p.last_activity_at > now() - interval '7 days') AS active_students,
          (SELECT count(*)::int FROM app_user u JOIN user_role ur ON ur.user_id=u.id
             JOIN role r ON r.id=ur.role_id AND r.key='TEACHER' WHERE u.deleted_at IS NULL) AS teachers,
          (SELECT count(*)::int FROM course WHERE status='published') AS courses,
          (SELECT count(*)::int FROM enrollment) AS enrolments,
          (SELECT count(*)::int FROM enrollment WHERE status='completed') AS completions,
          (SELECT coalesce(sum(amount_minor),0)::bigint FROM course_order WHERE status='paid') AS revenue_minor,
          (SELECT count(*)::int FROM course_order WHERE status='paid') AS paid_orders,
          (SELECT count(*)::int FROM live_session WHERE starts_at > now() AND status='scheduled') AS upcoming_live,
          (SELECT count(*)::int FROM certificate) AS certificates`))[0],

      courses: await c.query(`
        WITH nodes AS (
          SELECT m.course_id, l.id FROM lesson l JOIN module m ON m.id = l.module_id
          UNION ALL
          SELECT m.course_id, e.id FROM exercise e JOIN lesson l ON l.id = e.lesson_id
            JOIN module m ON m.id = l.module_id
          UNION ALL
          SELECT r.course_id, r.id FROM recording r WHERE r.status='published')
        SELECT c.id, c.slug, c.title, c.status, c.price_minor, s.name AS subject,
               (SELECT count(*)::int FROM enrollment e WHERE e.course_id = c.id) AS enrolments,
               (SELECT count(*)::int FROM enrollment e WHERE e.course_id = c.id AND e.status='completed') AS completed,
               (SELECT coalesce(sum(o.amount_minor),0)::bigint FROM course_order o
                 WHERE o.course_id = c.id AND o.status='paid') AS revenue_minor,
               (SELECT count(*)::int FROM nodes n WHERE n.course_id = c.id) AS nodes,
               (SELECT count(*)::int FROM progress p WHERE p.course_id = c.id AND p.status='completed') AS completed_nodes
          FROM course c JOIN subject s ON s.id = c.subject_id
         ORDER BY enrolments DESC`),

      recentOrders: await c.query(`
        SELECT o.id, o.amount_minor, o.status, o.created_at, o.paid_at,
               u.full_name AS student, co.title AS course
          FROM course_order o JOIN app_user u ON u.id = o.user_id JOIN course co ON co.id = o.course_id
         ORDER BY o.created_at DESC LIMIT 10`),

      signupsByWeek: await c.query(`
        SELECT to_char(date_trunc('week', enrolled_at), 'DD Mon') AS week,
               count(*)::int AS enrolments
          FROM enrollment WHERE enrolled_at > now() - interval '12 weeks'
         GROUP BY date_trunc('week', enrolled_at) ORDER BY date_trunc('week', enrolled_at)`),
    })))

  // =========================================================================
  // Courses
  // =========================================================================

  app.get('/api/v1/admin/courses', requires('course:read'), async req =>
    req.db(async c => ({
      courses: await c.query(`
        SELECT c.id, c.slug, c.title, c.subtitle, c.status, c.level, c.price_minor, c.duration_hours,
               c.published_at, s.name AS subject,
               (SELECT count(*)::int FROM module m WHERE m.course_id = c.id) AS modules,
               (SELECT count(*)::int FROM lesson l JOIN module m ON m.id = l.module_id
                 WHERE m.course_id = c.id) AS lessons,
               (SELECT count(*)::int FROM enrollment e WHERE e.course_id = c.id) AS enrolments,
               coalesce((SELECT array_agg(u.full_name) FROM course_teacher ct
                           JOIN app_user u ON u.id = ct.user_id WHERE ct.course_id = c.id), '{}') AS teachers
          FROM course c JOIN subject s ON s.id = c.subject_id ORDER BY c.title`),
      subjects: await c.query('SELECT id, key, name FROM subject ORDER BY name'),
      teachers: await c.query(`
        SELECT u.id, u.full_name FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id AND r.key='TEACHER'
         WHERE u.deleted_at IS NULL ORDER BY u.full_name`),
    })))

  app.post('/api/v1/admin/courses', requires('course:create'), async req => {
    const b = (req.body ?? {}) as any
    const title = String(b.title ?? '').trim()
    const slug = String(b.slug ?? '').trim().toLowerCase()
    if (!title || !slug) throw badRequest('A course needs a title and a URL slug.')
    if (!/^[a-z0-9-]{3,60}$/.test(slug)) throw badRequest('The slug should be lowercase letters, digits and hyphens.')

    return req.db(async c => {
      if ((await c.query('SELECT 1 FROM course WHERE slug = $1', [slug])).length) {
        throw conflict('That slug is already used by another course.', 'slug_taken')
      }
      const id = randomUUID()
      await c.query(
        `INSERT INTO course (id, subject_id, slug, title, subtitle, description, level, age_range,
                             duration_hours, price_minor, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft')`,
        [id, b.subjectId, slug, title, String(b.subtitle ?? ''), String(b.description ?? ''),
          String(b.level ?? 'Beginner'), String(b.ageRange ?? '11–16'),
          Number(b.durationHours ?? 0), Number(b.priceMinor ?? 0)])
      await req.log_audit(c, {
        action: 'course.created', entityType: 'course', entityId: id,
        summary: `Created course "${title}"`, after: { title, slug, price_minor: b.priceMinor },
      })
      return { id, slug }
    })
  })

  app.patch('/api/v1/admin/courses/:id', requires('course:update'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const before = (await c.query<any>(
        'SELECT title, subtitle, price_minor, level, duration_hours, status FROM course WHERE id = $1', [id]))[0]
      if (!before) throw notFound('No such course.')
      await c.query(`
        UPDATE course SET title = coalesce($1,title), subtitle = coalesce($2,subtitle),
               description = coalesce($3,description), level = coalesce($4,level),
               duration_hours = coalesce($5,duration_hours), price_minor = coalesce($6,price_minor),
               updated_at = now()
         WHERE id = $7`,
        [b.title ?? null, b.subtitle ?? null, b.description ?? null, b.level ?? null,
          b.durationHours ?? null, b.priceMinor ?? null, id])
      await req.log_audit(c, {
        action: 'course.updated', entityType: 'course', entityId: id,
        summary: `Updated "${before.title}"`, before, after: b,
      })
      return { ok: true }
    })
  })

  app.post('/api/v1/admin/courses/:id/status', requires('course:publish'), async req => {
    const id = (req.params as any).id
    const status = String((req.body as any)?.status ?? '')
    if (!['draft', 'published', 'retired'].includes(status)) throw badRequest('Unknown status.')
    return req.db(async c => {
      const before = (await c.query<any>('SELECT title, status FROM course WHERE id = $1', [id]))[0]
      if (!before) throw notFound('No such course.')
      await c.query(
        `UPDATE course SET status = $1, published_at = CASE WHEN $1 = 'published' AND published_at IS NULL
           THEN now() ELSE published_at END WHERE id = $2`, [status, id])
      await req.log_audit(c, {
        action: status === 'published' ? 'course.published' : 'course.updated',
        entityType: 'course', entityId: id,
        summary: `"${before.title}" → ${status}`, before, after: { status },
      })
      return { ok: true, status }
    })
  })

  app.post('/api/v1/admin/courses/:id/teachers', requires('course:assign_teacher'), async req => {
    const courseId = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const course = (await c.query<any>('SELECT title FROM course WHERE id = $1', [courseId]))[0]
      if (!course) throw notFound('No such course.')
      if (b.remove) {
        await c.query('DELETE FROM course_teacher WHERE course_id = $1 AND user_id = $2', [courseId, b.teacherId])
        await req.log_audit(c, {
          action: 'course.teacher.removed', entityType: 'course', entityId: courseId,
          summary: `Removed a teacher from "${course.title}"`,
        })
        return { ok: true }
      }
      await c.query(
        `INSERT INTO course_teacher (course_id, user_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (course_id, user_id) DO UPDATE SET role = excluded.role`,
        [courseId, b.teacherId, b.role === 'lead' ? 'lead' : 'assistant'])
      await req.log_audit(c, {
        action: 'course.teacher.assigned', entityType: 'course', entityId: courseId,
        summary: `Assigned a teacher to "${course.title}"`,
      })
      return { ok: true }
    })
  })

  // =========================================================================
  // Content Hub
  // =========================================================================

  app.get('/api/v1/admin/content', requires('content:create'), async req =>
    req.db(async c => ({
      courses: await c.query(`
        SELECT c.id, c.title, c.slug, c.status,
               (SELECT release_no FROM content_release cr
                 WHERE cr.scope='course' AND cr.scope_id = c.id AND cr.status='published') AS release_no,
               (SELECT published_at FROM content_release cr
                 WHERE cr.scope='course' AND cr.scope_id = c.id AND cr.status='published') AS released_at
          FROM course c ORDER BY c.title`),
      items: await c.query(`
        SELECT ci.id, ci.key, ci.content_type, ci.title, ci.course_id, co.title AS course,
               cv.version_no, cv.status AS version_status, cv.published_at, cv.changelog,
               (SELECT count(*)::int FROM content_version v WHERE v.content_item_id = ci.id) AS versions,
               (SELECT count(*)::int FROM content_version v
                 WHERE v.content_item_id = ci.id AND v.status IN ('draft','review')) AS pending
          FROM content_item ci
          LEFT JOIN course co ON co.id = ci.course_id
          LEFT JOIN content_version cv ON cv.content_item_id = ci.id AND cv.status = 'published'
         ORDER BY co.title, ci.content_type, ci.title`),
      pendingReview: await c.query(`
        SELECT cv.id, cv.version_no, cv.status, cv.changelog, cv.created_at, ci.title, ci.content_type
          FROM content_version cv JOIN content_item ci ON ci.id = cv.content_item_id
         WHERE cv.status IN ('draft','review') ORDER BY cv.created_at DESC`),
    })))

  app.get('/api/v1/admin/content/:id', requires('content:create'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const item = (await c.query<any>(`
        SELECT ci.id, ci.key, ci.content_type, ci.title, ci.course_id, co.title AS course
          FROM content_item ci LEFT JOIN course co ON co.id = ci.course_id WHERE ci.id = $1`, [id]))[0]
      if (!item) throw notFound('No such content item.')
      return {
        item,
        versions: await c.query(`
          SELECT id, version_no, status, changelog, created_at, published_at, body
            FROM content_version WHERE content_item_id = $1 ORDER BY version_no DESC`, [id]),
      }
    })
  })

  /**
   * Save a draft. A published version is never edited in place — editing always
   * produces version n+1 — so a student mid-chapter never sees the text change
   * underneath them.
   */
  app.post('/api/v1/admin/content/:id/draft', requires('content:update'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    if (!Array.isArray(b.body)) throw badRequest('Content must be a list of blocks.')

    return req.db(async c => {
      const item = (await c.query<any>('SELECT id, title FROM content_item WHERE id = $1', [id]))[0]
      if (!item) throw notFound('No such content item.')

      const open = (await c.query<any>(
        `SELECT id, version_no FROM content_version
          WHERE content_item_id = $1 AND status IN ('draft','review') ORDER BY version_no DESC LIMIT 1`,
        [id]))[0]
      const payload = JSON.stringify(b.body)

      if (open) {
        await c.query(
          `UPDATE content_version SET body = $1, body_hash = $2, changelog = $3, status = 'draft' WHERE id = $4`,
          [payload, sha256(payload), String(b.changelog ?? ''), open.id])
        return { versionId: open.id, versionNo: open.version_no, status: 'draft' }
      }

      const latest = Number((await c.query<{ n: string }>(
        'SELECT coalesce(max(version_no),0)::text AS n FROM content_version WHERE content_item_id = $1',
        [id]))[0].n)
      const versionId = randomUUID()
      await c.query(
        `INSERT INTO content_version (id, content_item_id, version_no, locale, status, body, body_hash,
                                      changelog, created_by)
         VALUES ($1,$2,$3,'en','draft',$4,$5,$6,$7)`,
        [versionId, id, latest + 1, payload, sha256(payload), String(b.changelog ?? ''), req.access.userId])
      await req.log_audit(c, {
        action: 'content.draft.saved', entityType: 'content_item', entityId: id,
        summary: `Saved draft v${latest + 1} of "${item.title}"`, after: { version_no: latest + 1 },
      })
      return { versionId, versionNo: latest + 1, status: 'draft' }
    })
  })

  app.post('/api/v1/admin/content/versions/:id/review', requires('content:review'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const v = (await c.query<any>(`
        SELECT cv.id, cv.status, cv.version_no, ci.title
          FROM content_version cv JOIN content_item ci ON ci.id = cv.content_item_id WHERE cv.id = $1`, [id]))[0]
      if (!v) throw notFound('No such version.')
      if (v.status !== 'draft') throw conflict('Only a draft can be sent for review.', 'not_draft')
      await c.query(`UPDATE content_version SET status = 'review' WHERE id = $1`, [id])
      await req.log_audit(c, {
        action: 'content.review.requested', entityType: 'content_version', entityId: id,
        summary: `Sent v${v.version_no} of "${v.title}" for review`,
      })
      return { ok: true, status: 'review' }
    })
  })

  /**
   * Publish.
   *
   * One transaction: archive the current version, publish the new one, supersede
   * the old release and write a new one. The partial unique index on
   * content_version guarantees exactly one published version, so this is atomic
   * by construction rather than by convention. Students read the new text on
   * their next request. No deploy, and rollback is the same move in reverse.
   */
  app.post('/api/v1/admin/content/versions/:id/publish', requires('content:publish'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const v = (await c.query<any>(`
        SELECT cv.id, cv.status, cv.version_no, cv.content_item_id, cv.body, ci.title, ci.course_id
          FROM content_version cv JOIN content_item ci ON ci.id = cv.content_item_id WHERE cv.id = $1`, [id]))[0]
      if (!v) throw notFound('No such version.')
      if (v.status === 'published') return { ok: true, alreadyPublished: true }
      if (!Array.isArray(v.body) || v.body.length === 0) {
        throw badRequest('A version needs at least one block before it can be published.')
      }

      const current = (await c.query<any>(
        `SELECT id, version_no FROM content_version
          WHERE content_item_id = $1 AND status = 'published' AND locale = 'en'`, [v.content_item_id]))[0]
      if (current) await c.query(`UPDATE content_version SET status='archived' WHERE id = $1`, [current.id])
      await c.query(`UPDATE content_version SET status='published', published_at = now() WHERE id = $1`, [id])

      let releaseNo: number | null = null
      if (v.course_id) {
        const prev = (await c.query<any>(
          `SELECT id, release_no FROM content_release
            WHERE scope='course' AND scope_id=$1 AND status='published'`, [v.course_id]))[0]
        if (prev) await c.query(`UPDATE content_release SET status='superseded' WHERE id=$1`, [prev.id])
        releaseNo = (prev?.release_no ?? 0) + 1
        await c.query(
          `INSERT INTO content_release (id, scope, scope_id, release_no, status, manifest, published_by)
           VALUES ($1,'course',$2,$3,'published',$4,$5)`,
          [randomUUID(), v.course_id, releaseNo,
            JSON.stringify({ changed: v.title, versionNo: v.version_no }), req.access.userId])
      }

      await req.log_audit(c, {
        action: 'content.published', entityType: 'content_version', entityId: id,
        summary: `Published v${v.version_no} of "${v.title}"${releaseNo ? ` as release ${releaseNo}` : ''}`,
        after: { version_no: v.version_no, release_no: releaseNo },
      })
      return { ok: true, versionNo: v.version_no, releaseNo }
    })
  })

  /** Rollback is the same operation with the numbers swapped. */
  app.post('/api/v1/admin/content/:id/rollback', requires('content:publish'), async req => {
    const itemId = (req.params as any).id
    return req.db(async c => {
      const item = (await c.query<any>('SELECT title, course_id FROM content_item WHERE id = $1', [itemId]))[0]
      if (!item) throw notFound('No such content item.')

      const current = (await c.query<any>(
        `SELECT id, version_no FROM content_version
          WHERE content_item_id = $1 AND status = 'published'`, [itemId]))[0]
      const previous = (await c.query<any>(
        `SELECT id, version_no FROM content_version
          WHERE content_item_id = $1 AND status = 'archived' ORDER BY version_no DESC LIMIT 1`, [itemId]))[0]
      if (!previous) throw conflict('There is no earlier version to roll back to.', 'no_previous_version')

      if (current) await c.query(`UPDATE content_version SET status='archived' WHERE id=$1`, [current.id])
      await c.query(`UPDATE content_version SET status='published' WHERE id=$1`, [previous.id])

      await req.log_audit(c, {
        action: 'content.rolled_back', entityType: 'content_item', entityId: itemId,
        summary: `Rolled "${item.title}" back to v${previous.version_no}`,
        before: { version_no: current?.version_no }, after: { version_no: previous.version_no },
      })
      return { ok: true, versionNo: previous.version_no }
    })
  })

  // =========================================================================
  // Media
  // =========================================================================

  app.post('/api/v1/admin/media', requires('media:upload'), async req => {
    const b = (req.body ?? {}) as any
    const fileName = String(b.fileName ?? '').trim()
    if (!fileName) throw badRequest('A file needs a name.')
    // In production the bytes go straight to object storage with a pre-signed
    // PUT, and this call only records the metadata afterwards. The hash is what
    // makes the key content-addressed, so the same file is never stored twice.
    const sha = String(b.sha256 ?? sha256(`${fileName}:${Date.now()}`))

    return req.db(async c => {
      const existing = (await c.query<any>('SELECT id FROM media_asset WHERE sha256 = $1', [sha]))[0]
      if (existing) return { id: existing.id, deduplicated: true }

      const id = randomUUID()
      await c.query(
        `INSERT INTO media_asset (id, sha256, storage_key, file_name, kind, mime_type, bytes,
                                  duration_ms, visibility, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, sha, storageKeyFor(sha, fileName), fileName, String(b.kind ?? 'pdf'),
          String(b.mimeType ?? 'application/pdf'), Number(b.bytes ?? 0), b.durationMs ?? null,
          b.visibility === 'public' ? 'public' : 'protected', req.access.userId])
      await req.log_audit(c, {
        action: 'media.uploaded', entityType: 'media_asset', entityId: id,
        summary: `Uploaded ${fileName}`,
      })
      return { id, storageKey: storageKeyFor(sha, fileName) }
    })
  })

  app.get('/api/v1/admin/media', requires('media:upload'), async req =>
    req.db(async c => ({
      media: await c.query(`
        SELECT id, sha256, file_name, kind, mime_type, bytes, duration_ms, visibility, created_at
          FROM media_asset ORDER BY created_at DESC LIMIT 200`),
    })))

  // =========================================================================
  // Live sessions
  // =========================================================================

  app.get('/api/v1/admin/live', requires('live:manage'), async req =>
    req.db(async c => ({
      sessions: await c.query(`
        SELECT ls.id, ls.title, ls.starts_at, ls.ends_at, ls.status, ls.meeting_url,
               c.title AS course, c.id AS course_id, u.full_name AS teacher, u.id AS teacher_id,
               (SELECT count(*)::int FROM session_attendance sa WHERE sa.live_session_id = ls.id) AS registered,
               (SELECT count(*)::int FROM session_attendance sa
                 WHERE sa.live_session_id = ls.id AND sa.status='attended') AS attended
          FROM live_session ls JOIN course c ON c.id = ls.course_id JOIN app_user u ON u.id = ls.teacher_id
         ORDER BY ls.starts_at DESC LIMIT 100`),
      courses: await c.query(`SELECT id, title FROM course WHERE status='published' ORDER BY title`),
      teachers: await c.query(`
        SELECT u.id, u.full_name FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id AND r.key='TEACHER'
         WHERE u.deleted_at IS NULL ORDER BY u.full_name`),
    })))

  app.post('/api/v1/admin/live', requires('live:manage'), async req => {
    const b = (req.body ?? {}) as any
    if (!b.courseId || !b.teacherId || !b.title || !b.startsAt) {
      throw badRequest('A session needs a course, a teacher, a title and a start time.')
    }
    const starts = new Date(b.startsAt)
    const minutes = Number(b.durationMinutes ?? 60)
    if (Number.isNaN(starts.getTime())) throw badRequest('That start time could not be read.')
    if (starts.getTime() < Date.now() - 60_000) throw badRequest('Choose a start time in the future.')

    return req.db(async c => {
      const teaches = await c.query(
        'SELECT 1 FROM course_teacher WHERE course_id = $1 AND user_id = $2', [b.courseId, b.teacherId])
      if (!teaches.length) {
        throw conflict('That teacher is not assigned to this course. Assign them first.', 'not_assigned')
      }
      const id = randomUUID()
      const ends = new Date(starts.getTime() + minutes * 60_000)
      await c.query(
        `INSERT INTO live_session (id, course_id, module_id, teacher_id, title, description,
                                   starts_at, ends_at, provider, meeting_url, capacity, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'scheduled',$12)`,
        [id, b.courseId, b.moduleId ?? null, b.teacherId, String(b.title), String(b.description ?? ''),
          starts.toISOString(), ends.toISOString(), String(b.provider ?? 'manual'),
          String(b.meetingUrl ?? `https://meet.brollyjuniors.com/${id.slice(0, 8)}`),
          b.capacity ?? null, req.access.userId])

      const enrolled = Number((await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM enrollment WHERE course_id = $1 AND status='active'`,
        [b.courseId]))[0].n)
      await req.log_audit(c, {
        action: 'live.scheduled', entityType: 'live_session', entityId: id,
        summary: `Scheduled "${b.title}" for ${enrolled} students`,
        after: { title: b.title, starts_at: starts.toISOString() },
      })
      return { id, enrolled }
    })
  })

  // =========================================================================
  // People
  // =========================================================================

  app.get('/api/v1/admin/teachers', requires('user:read'), async req =>
    req.db(async c => ({
      teachers: await c.query(`
        SELECT u.id, u.full_name, u.email, u.status, u.last_login_at, u.created_at,
               tp.headline, tp.expertise, tp.years_exp,
               coalesce((SELECT array_agg(c.title) FROM course_teacher ct JOIN course c ON c.id = ct.course_id
                          WHERE ct.user_id = u.id), '{}') AS courses,
               (SELECT count(DISTINCT e.user_id)::int FROM course_teacher ct
                  JOIN enrollment e ON e.course_id = ct.course_id AND e.status='active'
                 WHERE ct.user_id = u.id) AS students,
               (SELECT count(*)::int FROM live_session ls WHERE ls.teacher_id = u.id) AS sessions
          FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id AND r.key='TEACHER'
          LEFT JOIN teacher_profile tp ON tp.user_id = u.id
         WHERE u.deleted_at IS NULL ORDER BY u.full_name`),
    })))

  app.post('/api/v1/admin/teachers', requires('user:create'), async req => {
    const b = (req.body ?? {}) as any
    const email = String(b.email ?? '').trim().toLowerCase()
    const fullName = String(b.fullName ?? '').trim()
    if (!fullName || !email) throw badRequest('A teacher needs a name and an email address.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('That does not look like an email address.')

    return req.db(async c => {
      if ((await c.query('SELECT 1 FROM app_user WHERE lower(email)=lower($1) AND deleted_at IS NULL', [email])).length) {
        throw conflict('That email already has an account.', 'email_taken')
      }
      const id = randomUUID()
      const temp = tempPassword(10)
      await c.query(
        `INSERT INTO app_user (id, email, password_hash, full_name, phone, status, must_change_pw)
         VALUES ($1,$2,$3,$4,$5,'active',true)`,
        [id, email, await hashPassword(temp), fullName, String(b.phone ?? '')])
      const roleId = (await c.query<{ id: string }>(`SELECT id FROM role WHERE key='TEACHER'`))[0].id
      await c.query('INSERT INTO user_role (user_id, role_id, granted_by) VALUES ($1,$2,$3)',
        [id, roleId, req.access.userId])
      await c.query(
        `INSERT INTO teacher_profile (user_id, headline, bio, expertise, years_exp)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, String(b.headline ?? ''), String(b.bio ?? ''),
          Array.isArray(b.expertise) ? b.expertise : [], Number(b.yearsExp ?? 0)])

      for (const courseId of (Array.isArray(b.courseIds) ? b.courseIds : [])) {
        await c.query(
          `INSERT INTO course_teacher (course_id, user_id, role) VALUES ($1,$2,'assistant')
           ON CONFLICT DO NOTHING`, [courseId, id])
      }

      await req.log_audit(c, {
        action: 'user.created', entityType: 'app_user', entityId: id,
        summary: `Created teacher account for ${fullName}`, after: { full_name: fullName, email },
      })
      return { id, email, temporaryPassword: temp }
    })
  })

  app.post('/api/v1/admin/users/:id/status', requires('user:deactivate'), async req => {
    const id = (req.params as any).id
    const status = String((req.body as any)?.status ?? '')
    if (!['active', 'disabled'].includes(status)) throw badRequest('Unknown status.')
    return req.db(async c => {
      const u = (await c.query<any>('SELECT full_name, status FROM app_user WHERE id = $1', [id]))[0]
      if (!u) throw notFound('No such account.')
      if (id === req.access.userId) throw conflict('You cannot deactivate your own account.', 'self_deactivate')

      await c.query('UPDATE app_user SET status = $1, perm_version = perm_version + 1 WHERE id = $2', [status, id])
      if (status === 'disabled') {
        await c.query('UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id])
      }
      invalidateAccess(id)
      await req.log_audit(c, {
        action: status === 'disabled' ? 'user.deactivated' : 'user.reactivated',
        entityType: 'app_user', entityId: id,
        summary: `${u.full_name} → ${status}`, before: u, after: { status },
      })
      return { ok: true, status }
    })
  })

  app.get('/api/v1/admin/students', requires('user:read'), async req => {
    const q = String((req.query as any)?.q ?? '').trim()
    return req.db(async c => ({
      students: await c.query(`
        SELECT u.id, u.full_name, u.email, u.status, u.last_login_at, u.created_at,
               (SELECT count(*)::int FROM enrollment e WHERE e.user_id = u.id) AS courses,
               (SELECT count(*)::int FROM enrollment e WHERE e.user_id = u.id AND e.status='completed') AS completed,
               (SELECT coalesce(sum(o.amount_minor),0)::bigint FROM course_order o
                 WHERE o.user_id = u.id AND o.status='paid') AS spent_minor,
               (SELECT max(p.last_activity_at) FROM progress p WHERE p.user_id = u.id) AS last_seen
          FROM app_user u
          JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id AND r.key='STUDENT'
         WHERE u.deleted_at IS NULL
           AND ($1 = '' OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
         ORDER BY u.created_at DESC LIMIT 200`, [q]),
    }))
  })

  app.get('/api/v1/admin/orders', requires('order:read:platform'), async req =>
    req.db(async c => ({
      orders: await c.query(`
        SELECT o.id, o.amount_minor, o.currency, o.status, o.provider, o.provider_ref,
               o.created_at, o.paid_at, u.full_name AS student, u.email, c.title AS course
          FROM course_order o JOIN app_user u ON u.id = o.user_id JOIN course c ON c.id = o.course_id
         ORDER BY o.created_at DESC LIMIT 200`),
      summary: (await c.query<any>(`
        SELECT count(*) FILTER (WHERE status='paid')::int AS paid,
               count(*) FILTER (WHERE status='pending')::int AS pending,
               count(*) FILTER (WHERE status='failed')::int AS failed,
               coalesce(sum(amount_minor) FILTER (WHERE status='paid'),0)::bigint AS revenue_minor
          FROM course_order`))[0],
    })))

  app.get('/api/v1/admin/audit', requires('audit:read'), async req =>
    req.db(async c => ({
      entries: await c.query(`
        SELECT a.id, a.action, a.entity_type, a.summary, a.occurred_at, a.actor_role,
               u.full_name AS actor
          FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id
         ORDER BY a.occurred_at DESC LIMIT 150`),
    })))
}
