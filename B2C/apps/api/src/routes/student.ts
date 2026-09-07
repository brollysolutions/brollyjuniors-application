import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { Conn } from '@brolly/b2c-db'
import { badRequest, conflict, forbidden, notFound } from '../http.ts'
import { requires } from '../guards.ts'
import {
  assertCanReach, assertOwn, courseOfLesson, courseOfQuiz, courseOfAssignment, isEnrolled,
} from '../entitlement.ts'
import { signAsset } from '../media.ts'
import { payments } from '../payments.ts'
import type { TestResult } from '@brolly/b2c-shared'

/**
 * Grade a run.
 *
 * Source rules — "use a loop", "do not use max()" — are checked HERE, on the
 * server, against the submitted source, so they cannot be faked from the
 * browser. Output matching is trusted from Pyodide in the student's tab, which
 * a determined student could forge. That is the standing limitation, and it is
 * why exercises are practice rather than assessment.
 */
function gradeRun(
  tests: Array<{ name: string; stdin?: string; expect?: string; requireSource?: string; forbidSource?: string; hint?: string }>,
  source: string,
  outputs: Record<string, string>,
) {
  const results: TestResult[] = tests.map(t => {
    if (t.requireSource) {
      const ok = new RegExp(t.requireSource, 'm').test(source)
      return { name: t.name, passed: ok, detail: ok ? 'Found in your code' : (t.hint ?? 'Not found in your code') }
    }
    if (t.forbidSource) {
      const bad = new RegExp(t.forbidSource, 'm').test(source)
      return { name: t.name, passed: !bad, detail: bad ? (t.hint ?? 'That is not allowed for this task') : 'Good' }
    }
    const out = outputs[t.name] ?? ''
    const ok = t.expect ? out.includes(t.expect) : out.trim().length > 0
    return { name: t.name, passed: ok, detail: ok ? 'Output matched' : (t.hint ?? `Expected to see ${t.expect}`) }
  })
  return { results, passed: results.filter(r => r.passed).length, total: results.length }
}

async function upsertProgress(
  c: Conn, userId: string, courseId: string, nodeType: string, nodeId: string,
  percent: number, seconds: number,
) {
  await c.query(`
    INSERT INTO progress (id, user_id, course_id, node_type, node_id, status, percent, seconds_spent, attempts, last_activity_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1, now())
    ON CONFLICT (user_id, node_type, node_id) DO UPDATE
      SET status = CASE WHEN excluded.percent >= 100 THEN 'completed' ELSE progress.status END,
          percent = greatest(progress.percent, excluded.percent),
          seconds_spent = progress.seconds_spent + excluded.seconds_spent,
          attempts = progress.attempts + 1,
          last_activity_at = now()`,
    [randomUUID(), userId, courseId, nodeType, nodeId, percent >= 100 ? 'completed' : 'in_progress', percent, seconds])
}

/** Course completion, computed the same way everywhere. */
const COMPLETION_SQL = `
  WITH nodes AS (
    SELECT l.id, 'lesson' AS t FROM lesson l JOIN module m ON m.id = l.module_id WHERE m.course_id = $2
    UNION ALL
    SELECT e.id, 'exercise' FROM exercise e JOIN lesson l ON l.id = e.lesson_id
      JOIN module m ON m.id = l.module_id WHERE m.course_id = $2
    UNION ALL
    SELECT r.id, 'recording' FROM recording r WHERE r.course_id = $2 AND r.status = 'published'
  )
  SELECT count(*)::int AS total,
         count(p.id) FILTER (WHERE p.status = 'completed')::int AS done
    FROM nodes n
    LEFT JOIN progress p ON p.node_id = n.id AND p.user_id = $1`

export default async function studentRoutes(app: FastifyInstance) {
  // =========================================================================
  // Checkout — purchase, then enrolment. Never the other way round.
  // =========================================================================

  app.post('/api/v1/checkout/orders', requires('order:create'), async req => {
    const b = (req.body ?? {}) as any
    if (!b.courseId) throw badRequest('Choose a course.')

    return req.db(async c => {
      const course = (await c.query<any>(
        `SELECT id, title, price_minor, currency FROM course WHERE id = $1 AND status = 'published'`,
        [b.courseId]))[0]
      if (!course) throw notFound('No such course.')

      if (await isEnrolled(c, req.access.userId, course.id)) {
        throw conflict('You are already enrolled in this course.', 'already_enrolled')
      }

      // An idempotency key means a double-tapped Pay button cannot create two
      // orders, which is the commonest way a checkout charges twice.
      const idem = String(b.idempotencyKey ?? '') || `${req.access.userId}:${course.id}`
      const existing = (await c.query<any>(
        `SELECT id, status, amount_minor, provider_ref FROM course_order WHERE idempotency_key = $1`, [idem]))[0]
      if (existing && existing.status === 'pending') {
        return { orderId: existing.id, amountMinor: existing.amount_minor, providerRef: existing.provider_ref, reused: true }
      }

      const orderId = randomUUID()
      const intent = await payments.createIntent({
        orderId, amountMinor: course.price_minor, currency: course.currency, email: req.access.email,
      })
      await c.query(
        `INSERT INTO course_order (id, user_id, course_id, amount_minor, currency, status, provider, provider_ref, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8)`,
        [orderId, req.access.userId, course.id, course.price_minor, course.currency,
          payments.name, intent.providerRef, idem])

      await req.log_audit(c, {
        action: 'order.created', entityType: 'course_order', entityId: orderId,
        summary: `Started checkout for ${course.title}`,
        after: { amount_minor: course.price_minor, provider: payments.name },
      })
      return {
        orderId, amountMinor: course.price_minor, currency: course.currency,
        providerRef: intent.providerRef, clientPayload: intent.clientPayload,
      }
    })
  })

  /**
   * Confirmation is what grants access — and it is a server-side verification
   * with the provider, never the browser reporting that payment went well.
   */
  app.post('/api/v1/checkout/orders/:id/confirm', requires('order:create'), async req => {
    const orderId = (req.params as any).id
    const token = (req.body as any)?.token as string | undefined

    return req.db(async c => {
      const order = (await c.query<any>(
        `SELECT o.id, o.user_id, o.course_id, o.status, o.provider_ref, o.amount_minor, co.title
           FROM course_order o JOIN course co ON co.id = o.course_id
          WHERE o.id = $1`, [orderId]))[0]
      if (!order) throw notFound('No such order.')
      assertOwn(req.access, order.user_id)
      if (order.status === 'paid') return { ok: true, alreadyPaid: true }

      const result = await payments.confirm({ orderId, providerRef: order.provider_ref, token })
      if (!result.paid) {
        await c.query(`UPDATE course_order SET status = 'failed' WHERE id = $1`, [orderId])
        await req.log_audit(c, {
          action: 'order.failed', entityType: 'course_order', entityId: orderId,
          summary: `Payment failed for ${order.title}`,
        })
        throw conflict(result.failureReason ?? 'That payment did not go through.', 'payment_failed')
      }

      await c.query(`UPDATE course_order SET status = 'paid', paid_at = now() WHERE id = $1`, [orderId])
      const enrollmentId = randomUUID()
      await c.query(
        `INSERT INTO enrollment (id, user_id, course_id, status, source, order_id)
         VALUES ($1,$2,$3,'active','purchase',$4)
         ON CONFLICT (user_id, course_id) DO UPDATE SET status = 'active'`,
        [enrollmentId, order.user_id, order.course_id, orderId])
      await c.query(`SELECT notify($1,'enrolment',$2,$3,'mycourses')`,
        [order.user_id, `You are enrolled in ${order.title}`,
          'Everything is unlocked — lessons, the textbook, recordings and live classes.'])

      await req.log_audit(c, {
        action: 'order.paid', entityType: 'course_order', entityId: orderId,
        summary: `Paid for ${order.title} and enrolled`,
        after: { amount_minor: order.amount_minor, provider_ref: order.provider_ref },
      })
      return { ok: true, enrolled: true, courseId: order.course_id }
    })
  })

  /** Free enrolment, for a course priced at zero. Same path, no payment. */
  app.post('/api/v1/checkout/enroll-free', requires('order:create'), async req => {
    const courseId = (req.body as any)?.courseId
    return req.db(async c => {
      const course = (await c.query<any>(
        `SELECT id, title, price_minor FROM course WHERE id = $1 AND status = 'published'`, [courseId]))[0]
      if (!course) throw notFound('No such course.')
      if (course.price_minor > 0) throw forbidden('That course is not free.')
      await c.query(
        `INSERT INTO enrollment (id, user_id, course_id, status, source)
         VALUES ($1,$2,$3,'active','free') ON CONFLICT (user_id, course_id) DO NOTHING`,
        [randomUUID(), req.access.userId, course.id])
      await req.log_audit(c, {
        action: 'enrollment.created', entityType: 'course', entityId: course.id,
        summary: `Enrolled in ${course.title} (free)`,
      })
      return { ok: true, courseId: course.id }
    })
  })

  app.get('/api/v1/student/orders', requires('order:read:self'), async req =>
    req.db(async c => ({
      orders: await c.query(`
        SELECT o.id, o.amount_minor, o.currency, o.status, o.created_at, o.paid_at,
               o.provider, o.provider_ref, co.title AS course
          FROM course_order o JOIN course co ON co.id = o.course_id
         WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [req.access.userId]),
    })))

  // =========================================================================
  // Home and courses
  // =========================================================================

  app.get('/api/v1/student/home', requires('progress:read:self'), async req =>
    req.db(async c => {
      const uid = req.access.userId
      const courses = await c.query<any>(`
        SELECT c.id, c.slug, c.title, c.subtitle, s.name AS subject, e.status AS enrollment_status,
               e.enrolled_at, e.completed_at
          FROM enrollment e JOIN course c ON c.id = e.course_id JOIN subject s ON s.id = c.subject_id
         WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC`, [uid])

      for (const course of courses) {
        const r = (await c.query<any>(COMPLETION_SQL, [uid, course.id]))[0]
        course.total = r.total
        course.done = r.done
        course.completion = r.total ? Math.round(r.done / r.total * 100) : 0
      }

      // The genuinely next unfinished thing, not a guess.
      const next = await c.query<any>(`
        SELECT l.id, l.title, l.est_minutes, m.course_id, c.title AS course, m.title AS module,
               coalesce(p.percent, 0) AS percent
          FROM lesson l
          JOIN module m ON m.id = l.module_id
          JOIN course c ON c.id = m.course_id
          JOIN enrollment e ON e.course_id = m.course_id AND e.user_id = $1 AND e.status = 'active'
          LEFT JOIN progress p ON p.node_id = l.id AND p.user_id = $1
         WHERE coalesce(p.status, 'not_started') <> 'completed'
         ORDER BY (p.percent IS NULL), m.position, l.position LIMIT 3`, [uid])

      const upcoming = await c.query<any>(`
        SELECT ls.id, ls.title, ls.starts_at, ls.ends_at, ls.status, c.title AS course,
               u.full_name AS teacher, sa.status AS my_status
          FROM live_session ls
          JOIN course c ON c.id = ls.course_id
          JOIN app_user u ON u.id = ls.teacher_id
          JOIN enrollment e ON e.course_id = ls.course_id AND e.user_id = $1 AND e.status = 'active'
          LEFT JOIN session_attendance sa ON sa.live_session_id = ls.id AND sa.user_id = $1
         WHERE ls.starts_at > now() - interval '2 hours' AND ls.status <> 'cancelled'
         ORDER BY ls.starts_at LIMIT 4`, [uid])

      const due = await c.query<any>(`
        SELECT a.id, a.title, a.due_at, c.title AS course, s.status AS submission_status, s.score, a.max_score
          FROM assignment a
          JOIN course c ON c.id = a.course_id
          JOIN enrollment e ON e.course_id = a.course_id AND e.user_id = $1 AND e.status = 'active'
          LEFT JOIN submission s ON s.assignment_id = a.id AND s.user_id = $1
         WHERE a.status = 'published'
         ORDER BY (s.id IS NOT NULL), a.due_at LIMIT 5`, [uid])

      const stats = (await c.query<any>(`
        SELECT (SELECT count(*)::int FROM enrollment WHERE user_id = $1) AS courses,
               (SELECT coalesce(round(sum(seconds_spent)/60.0)::int, 0) FROM progress WHERE user_id = $1) AS minutes,
               (SELECT count(*)::int FROM certificate WHERE user_id = $1) AS certificates,
               (SELECT count(*)::int FROM achievement WHERE user_id = $1) AS badges`, [uid]))[0]

      return { courses, next, upcoming, due, stats }
    }))

  app.get('/api/v1/student/courses/:id', requires('course:read'), async req => {
    const courseId = (req.params as any).id
    return req.db(async c => {
      await assertCanReach(c, req.access, courseId)
      const course = (await c.query<any>(`
        SELECT c.id, c.slug, c.title, c.subtitle, c.description, c.level, c.duration_hours,
               s.name AS subject, e.status AS enrollment_status, e.enrolled_at, e.completed_at
          FROM course c JOIN subject s ON s.id = c.subject_id
          LEFT JOIN enrollment e ON e.course_id = c.id AND e.user_id = $2
         WHERE c.id = $1`, [courseId, req.access.userId]))[0]
      if (!course) throw notFound('No such course.')

      const completion = (await c.query<any>(COMPLETION_SQL, [req.access.userId, courseId]))[0]

      return {
        course,
        completion: { ...completion, percent: completion.total ? Math.round(completion.done / completion.total * 100) : 0 },
        modules: await c.query(`
          SELECT m.id, m.position, m.title, m.summary,
                 coalesce((SELECT json_agg(json_build_object(
                     'id', l.id, 'title', l.title, 'position', l.position, 'minutes', l.est_minutes,
                     'status', coalesce(p.status, 'not_started'), 'percent', coalesce(p.percent, 0),
                     'exercises', (SELECT count(*)::int FROM exercise ex WHERE ex.lesson_id = l.id))
                   ORDER BY l.position)
                   FROM lesson l LEFT JOIN progress p ON p.node_id = l.id AND p.user_id = $2
                  WHERE l.module_id = m.id), '[]'::json) AS lessons
            FROM module m WHERE m.course_id = $1 ORDER BY m.position`, [courseId, req.access.userId]),
        textbook: (await c.query<any>(`
          SELECT t.id, t.title, t.edition,
                 (SELECT count(*)::int FROM chapter ch WHERE ch.textbook_id = t.id) AS chapters
            FROM textbook t WHERE t.course_id = $1`, [courseId]))[0] ?? null,
        quizzes: await c.query(`
          SELECT q.id, q.title, q.description, q.pass_mark_pct, q.max_attempts,
                 (SELECT count(*)::int FROM question WHERE quiz_id = q.id) AS questions,
                 (SELECT max(score) FROM quiz_attempt a WHERE a.quiz_id = q.id AND a.user_id = $2) AS best_score,
                 (SELECT max(max_score) FROM quiz_attempt a WHERE a.quiz_id = q.id AND a.user_id = $2) AS out_of,
                 (SELECT count(*)::int FROM quiz_attempt a WHERE a.quiz_id = q.id AND a.user_id = $2) AS attempts
            FROM quiz q WHERE q.course_id = $1 ORDER BY q.title`, [courseId, req.access.userId]),
        materials: await c.query(`
          SELECT lm.id, lm.title, lm.description, lm.kind, lm.media_asset_id
            FROM learning_material lm WHERE lm.course_id = $1 AND lm.status = 'published'
           ORDER BY lm.position`, [courseId]),
        recordings: await c.query(`
          SELECT r.id, r.title, r.description, r.duration_seconds, r.recorded_on,
                 coalesce(p.status, 'not_started') AS status
            FROM recording r
            LEFT JOIN progress p ON p.node_id = r.id AND p.user_id = $2
           WHERE r.course_id = $1 AND r.status = 'published' ORDER BY r.position`, [courseId, req.access.userId]),
        assignments: await c.query(`
          SELECT a.id, a.title, a.due_at, a.max_score, s.status AS submission_status, s.score, s.feedback
            FROM assignment a
            LEFT JOIN submission s ON s.assignment_id = a.id AND s.user_id = $2
           WHERE a.course_id = $1 AND a.status = 'published' ORDER BY a.due_at`, [courseId, req.access.userId]),
      }
    })
  })

  // =========================================================================
  // Lessons, textbook, materials, recordings
  // =========================================================================

  app.get('/api/v1/student/lessons/:id', requires('content:read'), async req => {
    const lessonId = (req.params as any).id
    return req.db(async c => {
      const courseId = await courseOfLesson(c, lessonId)
      await assertCanReach(c, req.access, courseId)

      const lesson = (await c.query<any>(`
        SELECT l.id, l.title, l.est_minutes, l.position, m.title AS module, m.course_id,
               cv.body, cv.version_no, cv.published_at
          FROM lesson l
          JOIN module m ON m.id = l.module_id
          LEFT JOIN content_version cv
            ON cv.content_item_id = l.content_item_id AND cv.status = 'published' AND cv.locale = 'en'
         WHERE l.id = $1`, [lessonId]))[0]
      if (!lesson) throw notFound('No such lesson.')

      return {
        lesson,
        exercises: await c.query(`
          SELECT e.id, e.title, e.level, e.brief,
                 coalesce(p.status, 'not_started') AS status
            FROM exercise e
            LEFT JOIN progress p ON p.node_id = e.id AND p.user_id = $2
           WHERE e.lesson_id = $1 ORDER BY e.position`, [lessonId, req.access.userId]),
        progress: (await c.query<any>(
          `SELECT status, percent FROM progress WHERE user_id = $1 AND node_id = $2`,
          [req.access.userId, lessonId]))[0] ?? null,
        next: (await c.query<any>(`
          SELECT l.id, l.title FROM lesson l
            JOIN module m ON m.id = l.module_id
           WHERE m.course_id = $1 AND (m.position, l.position) > (
             SELECT m2.position, l2.position FROM lesson l2 JOIN module m2 ON m2.id = l2.module_id
              WHERE l2.id = $2)
           ORDER BY m.position, l.position LIMIT 1`, [lesson.course_id, lessonId]))[0] ?? null,
      }
    })
  })

  app.post('/api/v1/student/lessons/:id/progress', requires('progress:read:self'), async req => {
    const lessonId = (req.params as any).id
    const percent = Math.max(0, Math.min(100, Number((req.body as any)?.percent ?? 100)))
    const seconds = Math.max(0, Math.min(7200, Number((req.body as any)?.seconds ?? 60)))
    return req.db(async c => {
      const courseId = await courseOfLesson(c, lessonId)
      await assertCanReach(c, req.access, courseId)
      await upsertProgress(c, req.access.userId, courseId, 'lesson', lessonId, percent, seconds)
      return { ok: true, percent }
    })
  })

  app.get('/api/v1/student/textbooks/:id', requires('content:read'), async req => {
    const textbookId = (req.params as any).id
    return req.db(async c => {
      const book = (await c.query<any>(
        'SELECT id, course_id, title, edition FROM textbook WHERE id = $1', [textbookId]))[0]
      if (!book) throw notFound('No such textbook.')
      await assertCanReach(c, req.access, book.course_id)
      return {
        textbook: book,
        chapters: await c.query(`
          SELECT ch.id, ch.position, ch.title,
                 coalesce((SELECT json_agg(json_build_object('id', s.id, 'title', s.title, 'position', s.position)
                   ORDER BY s.position) FROM section s WHERE s.chapter_id = ch.id), '[]'::json) AS sections
            FROM chapter ch WHERE ch.textbook_id = $1 ORDER BY ch.position`, [textbookId]),
      }
    })
  })

  app.get('/api/v1/student/sections/:id', requires('content:read'), async req => {
    const sectionId = (req.params as any).id
    return req.db(async c => {
      // The RLS policy on section already refuses an unentitled reader; this
      // fetch simply comes back empty, and 404 is the honest answer.
      const row = (await c.query<any>(`
        SELECT s.id, s.title, ch.title AS chapter, t.title AS textbook, t.course_id,
               cv.body, cv.version_no, cv.published_at
          FROM section s
          JOIN chapter ch ON ch.id = s.chapter_id
          JOIN textbook t ON t.id = ch.textbook_id
          LEFT JOIN content_version cv
            ON cv.content_item_id = s.content_item_id AND cv.status = 'published' AND cv.locale = 'en'
         WHERE s.id = $1`, [sectionId]))[0]
      if (!row) throw notFound('No such section.')
      return { section: row }
    })
  })

  /** Materials and recordings hand back a short-lived signed link, never a path. */
  app.get('/api/v1/student/materials/:id/link', requires('content:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const row = (await c.query<any>(`
        SELECT lm.id, lm.title, lm.course_id, lm.external_url,
               ma.storage_key, ma.kind, ma.mime_type, ma.bytes, ma.duration_ms, ma.file_name, ma.visibility
          FROM learning_material lm
          LEFT JOIN media_asset ma ON ma.id = lm.media_asset_id
         WHERE lm.id = $1 AND lm.status = 'published'`, [id]))[0]
      if (!row) throw notFound('No such material.')
      await assertCanReach(c, req.access, row.course_id)
      if (!row.storage_key) return { title: row.title, url: row.external_url, external: true }
      return { title: row.title, ...signAsset(row, req.access.userId) }
    })
  })

  app.get('/api/v1/student/recordings/:id', requires('recording:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const row = (await c.query<any>(`
        SELECT r.id, r.title, r.description, r.duration_seconds, r.recorded_on, r.course_id,
               c.title AS course, ma.storage_key, ma.kind, ma.mime_type, ma.bytes, ma.duration_ms,
               ma.file_name, ma.visibility, coalesce(p.percent, 0) AS percent
          FROM recording r
          JOIN course c ON c.id = r.course_id
          LEFT JOIN media_asset ma ON ma.id = r.media_asset_id
          LEFT JOIN progress p ON p.node_id = r.id AND p.user_id = $2
         WHERE r.id = $1 AND r.status = 'published'`, [id, req.access.userId]))[0]
      if (!row) throw notFound('No such recording.')
      await assertCanReach(c, req.access, row.course_id)
      return {
        recording: row,
        media: row.storage_key ? signAsset(row, req.access.userId) : null,
      }
    })
  })

  app.post('/api/v1/student/recordings/:id/progress', requires('recording:read'), async req => {
    const id = (req.params as any).id
    const percent = Math.max(0, Math.min(100, Number((req.body as any)?.percent ?? 0)))
    const seconds = Math.max(0, Math.min(21600, Number((req.body as any)?.seconds ?? 0)))
    return req.db(async c => {
      const row = (await c.query<any>('SELECT course_id FROM recording WHERE id = $1', [id]))[0]
      if (!row) throw notFound('No such recording.')
      await assertCanReach(c, req.access, row.course_id)
      await upsertProgress(c, req.access.userId, row.course_id, 'recording', id, percent, seconds)
      return { ok: true }
    })
  })

  app.get('/api/v1/student/recordings', requires('recording:read'), async req =>
    req.db(async c => ({
      recordings: await c.query(`
        SELECT r.id, r.title, r.description, r.duration_seconds, r.recorded_on,
               c.title AS course, c.id AS course_id, coalesce(p.percent, 0) AS percent
          FROM recording r
          JOIN course c ON c.id = r.course_id
          JOIN enrollment e ON e.course_id = r.course_id AND e.user_id = $1
          LEFT JOIN progress p ON p.node_id = r.id AND p.user_id = $1
         WHERE r.status = 'published' ORDER BY r.recorded_on DESC NULLS LAST`, [req.access.userId]),
    })))

  // =========================================================================
  // Exercises — Python in the browser
  // =========================================================================

  app.get('/api/v1/student/exercises/:id', requires('exercise:attempt'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const ex = (await c.query<any>(`
        SELECT e.id, e.title, e.level, e.brief, e.starter_code, e.hints, e.solution, e.test_cases,
               l.id AS lesson_id, l.title AS lesson, m.course_id
          FROM exercise e JOIN lesson l ON l.id = e.lesson_id JOIN module m ON m.id = l.module_id
         WHERE e.id = $1`, [id]))[0]
      if (!ex) throw notFound('No such exercise.')
      await assertCanReach(c, req.access, ex.course_id)
      const last = (await c.query<any>(
        `SELECT code FROM exercise_attempt WHERE user_id = $1 AND exercise_id = $2
          ORDER BY created_at DESC LIMIT 1`, [req.access.userId, id]))[0]
      return {
        exercise: {
          id: ex.id, title: ex.title, level: ex.level, brief: ex.brief, lesson: ex.lesson,
          lessonId: ex.lesson_id, courseId: ex.course_id,
          starterCode: last?.code ?? ex.starter_code,
          hints: ex.hints,
          solution: ex.solution,   // practice, so the answer is available
          // Expected outputs are never sent: only the name and the stdin.
          tests: (ex.test_cases ?? []).map((t: any) => ({ name: t.name, stdin: t.stdin ?? '' })),
        },
      }
    })
  })

  app.post('/api/v1/student/exercises/:id/run', requires('exercise:attempt'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const ex = (await c.query<any>(`
        SELECT e.test_cases, m.course_id FROM exercise e
          JOIN lesson l ON l.id = e.lesson_id JOIN module m ON m.id = l.module_id WHERE e.id = $1`, [id]))[0]
      if (!ex) throw notFound('No such exercise.')
      await assertCanReach(c, req.access, ex.course_id)

      const graded = gradeRun(ex.test_cases ?? [], String(b.code ?? ''), b.outputs ?? {})
      await c.query(
        `INSERT INTO exercise_attempt (id, user_id, exercise_id, code, stdout, passed_count, total_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), req.access.userId, id, String(b.code ?? ''),
          String(b.stdout ?? '').slice(0, 8000), graded.passed, graded.total])

      const solved = graded.total > 0 && graded.passed === graded.total
      if (solved) await upsertProgress(c, req.access.userId, ex.course_id, 'exercise', id, 100, 120)
      return { ...graded, solved }
    })
  })

  // =========================================================================
  // Quizzes
  // =========================================================================

  app.get('/api/v1/student/quizzes/:id', requires('quiz:attempt'), async req => {
    const quizId = (req.params as any).id
    return req.db(async c => {
      const courseId = await courseOfQuiz(c, quizId)
      await assertCanReach(c, req.access, courseId)
      const quiz = (await c.query<any>(
        `SELECT id, title, description, pass_mark_pct, time_limit_min, max_attempts, course_id
           FROM quiz WHERE id = $1`, [quizId]))[0]

      const attempts = await c.query<any>(`
        SELECT id, attempt_no, status, score, max_score, passed, submitted_at
          FROM quiz_attempt WHERE quiz_id = $1 AND user_id = $2 ORDER BY attempt_no DESC`,
        [quizId, req.access.userId])
      const open = attempts.find(a => a.status === 'in_progress')

      // The correct index is never sent to the browser. Marking happens server-side.
      const questions = await c.query(
        `SELECT id, position, kind, text, options, marks FROM question WHERE quiz_id = $1 ORDER BY position`,
        [quizId])

      return {
        quiz, attempts, questions,
        openAttemptId: open?.id ?? null,
        attemptsLeft: Math.max(0, quiz.max_attempts - attempts.filter((a: any) => a.status === 'submitted').length),
        savedAnswers: open ? await c.query(
          'SELECT question_id, choice_index FROM quiz_answer WHERE attempt_id = $1', [open.id]) : [],
      }
    })
  })

  app.post('/api/v1/student/quizzes/:id/start', requires('quiz:attempt'), async req => {
    const quizId = (req.params as any).id
    return req.db(async c => {
      const courseId = await courseOfQuiz(c, quizId)
      await assertCanReach(c, req.access, courseId)
      const quiz = (await c.query<any>('SELECT max_attempts FROM quiz WHERE id = $1', [quizId]))[0]

      const existing = await c.query<any>(
        'SELECT id, attempt_no, status FROM quiz_attempt WHERE quiz_id = $1 AND user_id = $2 ORDER BY attempt_no DESC',
        [quizId, req.access.userId])
      const open = existing.find(a => a.status === 'in_progress')
      if (open) return { attemptId: open.id, resumed: true }
      if (existing.length >= quiz.max_attempts) {
        throw conflict(`You have used all ${quiz.max_attempts} attempts on this quiz.`, 'no_attempts_left')
      }

      const max = Number((await c.query<{ n: string }>(
        'SELECT coalesce(sum(marks),0)::text AS n FROM question WHERE quiz_id = $1', [quizId]))[0].n)
      const attemptId = randomUUID()
      await c.query(
        `INSERT INTO quiz_attempt (id, quiz_id, user_id, attempt_no, status, max_score)
         VALUES ($1,$2,$3,$4,'in_progress',$5)`,
        [attemptId, quizId, req.access.userId, existing.length + 1, max])
      return { attemptId, resumed: false }
    })
  })

  app.post('/api/v1/student/quiz-attempts/:id/answer', requires('quiz:attempt'), async req => {
    const attemptId = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const attempt = (await c.query<any>(
        'SELECT id, user_id, quiz_id, status FROM quiz_attempt WHERE id = $1', [attemptId]))[0]
      if (!attempt) throw notFound('No such attempt.')
      assertOwn(req.access, attempt.user_id)
      if (attempt.status !== 'in_progress') throw conflict('That attempt is already submitted.', 'already_submitted')

      const q = (await c.query<any>(
        'SELECT id, answer_index, marks FROM question WHERE id = $1 AND quiz_id = $2',
        [b.questionId, attempt.quiz_id]))[0]
      if (!q) throw notFound('No such question on this quiz.')

      // Marked here, out of the row the browser never sees.
      const isCorrect = Number(b.choiceIndex) === q.answer_index
      await c.query(`
        INSERT INTO quiz_answer (id, attempt_id, question_id, choice_index, is_correct, marks_awarded)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (attempt_id, question_id) DO UPDATE
          SET choice_index = excluded.choice_index, is_correct = excluded.is_correct,
              marks_awarded = excluded.marks_awarded, saved_at = now()`,
        [randomUUID(), attemptId, q.id, Number(b.choiceIndex), isCorrect, isCorrect ? q.marks : 0])
      return { ok: true, savedAt: new Date().toISOString() }
    })
  })

  app.post('/api/v1/student/quiz-attempts/:id/submit', requires('quiz:attempt'), async req => {
    const attemptId = (req.params as any).id
    return req.db(async c => {
      const attempt = (await c.query<any>(`
        SELECT a.id, a.user_id, a.quiz_id, a.status, a.max_score, q.pass_mark_pct, q.course_id, q.title
          FROM quiz_attempt a JOIN quiz q ON q.id = a.quiz_id WHERE a.id = $1`, [attemptId]))[0]
      if (!attempt) throw notFound('No such attempt.')
      assertOwn(req.access, attempt.user_id)
      if (attempt.status !== 'in_progress') return { ok: true, alreadySubmitted: true }

      const score = Number((await c.query<{ n: string }>(
        'SELECT coalesce(sum(marks_awarded),0)::text AS n FROM quiz_answer WHERE attempt_id = $1',
        [attemptId]))[0].n)
      const pct = attempt.max_score ? (score / attempt.max_score) * 100 : 0
      const passed = pct >= attempt.pass_mark_pct

      await c.query(
        `UPDATE quiz_attempt SET status='submitted', score=$1, passed=$2, submitted_at=now() WHERE id=$3`,
        [score, passed, attemptId])
      await upsertProgress(c, req.access.userId, attempt.course_id, 'quiz', attempt.quiz_id, 100, 300)

      if (passed) {
        await c.query(
          `INSERT INTO achievement (id, user_id, badge_key) VALUES ($1,$2,'quiz_passed')
           ON CONFLICT (user_id, badge_key, course_id) DO NOTHING`, [randomUUID(), req.access.userId])
      }

      // Results are immediate — a quiz has no written answers waiting on a human.
      return {
        ok: true, score, maxScore: attempt.max_score, passed,
        percent: Math.round(pct),
        review: await c.query(`
          SELECT q.position, q.text, q.options, q.answer_index, q.explanation,
                 qa.choice_index, qa.is_correct
            FROM question q
            LEFT JOIN quiz_answer qa ON qa.question_id = q.id AND qa.attempt_id = $1
           WHERE q.quiz_id = $2 ORDER BY q.position`, [attemptId, attempt.quiz_id]),
      }
    })
  })

  // =========================================================================
  // Assignments
  // =========================================================================

  app.get('/api/v1/student/assignments', requires('assignment:read'), async req =>
    req.db(async c => ({
      assignments: await c.query(`
        SELECT a.id, a.title, a.due_at, a.max_score, c.title AS course, c.id AS course_id,
               s.id AS submission_id, s.status AS submission_status, s.score, s.feedback,
               s.submitted_at, s.graded_at
          FROM assignment a
          JOIN course c ON c.id = a.course_id
          JOIN enrollment e ON e.course_id = a.course_id AND e.user_id = $1
          LEFT JOIN submission s ON s.assignment_id = a.id AND s.user_id = $1
         WHERE a.status = 'published' ORDER BY a.due_at`, [req.access.userId]),
    })))

  app.get('/api/v1/student/assignments/:id', requires('assignment:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const courseId = await courseOfAssignment(c, id)
      await assertCanReach(c, req.access, courseId)
      const a = (await c.query<any>(`
        SELECT a.id, a.title, a.instructions, a.rubric, a.max_score, a.due_at, a.allow_resubmit,
               c.title AS course, c.id AS course_id
          FROM assignment a JOIN course c ON c.id = a.course_id WHERE a.id = $1`, [id]))[0]
      if (!a) throw notFound('No such assignment.')
      return {
        assignment: a,
        submission: (await c.query<any>(
          `SELECT * FROM submission WHERE assignment_id = $1 AND user_id = $2 ORDER BY attempt_no DESC LIMIT 1`,
          [id, req.access.userId]))[0] ?? null,
      }
    })
  })

  app.post('/api/v1/student/assignments/:id/submit', requires('assignment:submit'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const courseId = await courseOfAssignment(c, id)
      await assertCanReach(c, req.access, courseId)
      const a = (await c.query<any>(
        'SELECT id, title, allow_resubmit, status FROM assignment WHERE id = $1', [id]))[0]
      if (!a || a.status !== 'published') throw notFound('No such assignment.')

      const prev = (await c.query<any>(
        `SELECT id, attempt_no, status FROM submission
          WHERE assignment_id = $1 AND user_id = $2 ORDER BY attempt_no DESC LIMIT 1`,
        [id, req.access.userId]))[0]

      if (prev && prev.status === 'graded' && !a.allow_resubmit) {
        throw conflict('This has already been graded and does not allow resubmission.', 'already_graded')
      }

      const body = String(b.body ?? '').slice(0, 20000)
      const code = String(b.code ?? '').slice(0, 20000)
      if (!body.trim() && !code.trim() && !b.fileName) throw badRequest('Write something, or attach a file.')

      if (prev && prev.status !== 'graded') {
        await c.query(
          `UPDATE submission SET body=$1, code=$2, file_name=$3, status='submitted', submitted_at=now()
            WHERE id=$4`, [body, code, String(b.fileName ?? ''), prev.id])
        return { ok: true, submissionId: prev.id, resubmitted: true }
      }

      const subId = randomUUID()
      await c.query(
        `INSERT INTO submission (id, assignment_id, user_id, attempt_no, body, code, file_name, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted')`,
        [subId, id, req.access.userId, (prev?.attempt_no ?? 0) + 1, body, code, String(b.fileName ?? '')])
      return { ok: true, submissionId: subId }
    })
  })

  // =========================================================================
  // Live classes
  // =========================================================================

  app.get('/api/v1/student/live', requires('live:attend'), async req =>
    req.db(async c => ({
      sessions: await c.query(`
        SELECT ls.id, ls.title, ls.description, ls.starts_at, ls.ends_at, ls.status,
               c.title AS course, c.id AS course_id, u.full_name AS teacher,
               sa.status AS my_status
          FROM live_session ls
          JOIN course c ON c.id = ls.course_id
          JOIN app_user u ON u.id = ls.teacher_id
          JOIN enrollment e ON e.course_id = ls.course_id AND e.user_id = $1
          LEFT JOIN session_attendance sa ON sa.live_session_id = ls.id AND sa.user_id = $1
         ORDER BY ls.starts_at DESC`, [req.access.userId]),
    })))

  /**
   * The meeting link is issued at join time, and only inside the window.
   * Putting it in the list response would make it shareable days in advance.
   */
  app.post('/api/v1/student/live/:id/join', requires('live:attend'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const s = (await c.query<any>(`
        SELECT ls.id, ls.title, ls.course_id, ls.starts_at, ls.ends_at, ls.meeting_url, ls.status
          FROM live_session ls WHERE ls.id = $1`, [id]))[0]
      if (!s) throw notFound('No such session.')
      await assertCanReach(c, req.access, s.course_id)

      const now = Date.now()
      const opens = new Date(s.starts_at).getTime() - 15 * 60_000
      const closes = new Date(s.ends_at).getTime() + 30 * 60_000
      if (now < opens) {
        throw conflict('The room opens fifteen minutes before the start time.', 'too_early')
      }
      if (now > closes || s.status === 'ended') {
        throw conflict('That session has finished. The recording appears here once it is uploaded.', 'session_ended')
      }

      await c.query(`
        INSERT INTO session_attendance (live_session_id, user_id, status, joined_at)
        VALUES ($1,$2,'attended', now())
        ON CONFLICT (live_session_id, user_id) DO UPDATE
          SET status = 'attended', joined_at = coalesce(session_attendance.joined_at, now())`,
        [id, req.access.userId])
      return { meetingUrl: s.meeting_url, title: s.title }
    })
  })

  app.post('/api/v1/student/live/:id/register', requires('live:attend'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const s = (await c.query<any>('SELECT id, course_id FROM live_session WHERE id = $1', [id]))[0]
      if (!s) throw notFound('No such session.')
      await assertCanReach(c, req.access, s.course_id)
      await c.query(`
        INSERT INTO session_attendance (live_session_id, user_id, status) VALUES ($1,$2,'registered')
        ON CONFLICT (live_session_id, user_id) DO NOTHING`, [id, req.access.userId])
      return { ok: true }
    })
  })

  // =========================================================================
  // Progress, certificates, profile
  // =========================================================================

  app.get('/api/v1/student/progress', requires('progress:read:self'), async req =>
    req.db(async c => {
      const uid = req.access.userId
      const courses = await c.query<any>(`
        SELECT c.id, c.title, s.name AS subject, e.status, e.enrolled_at, e.completed_at
          FROM enrollment e JOIN course c ON c.id = e.course_id JOIN subject s ON s.id = c.subject_id
         WHERE e.user_id = $1 ORDER BY e.enrolled_at`, [uid])
      for (const course of courses) {
        const r = (await c.query<any>(COMPLETION_SQL, [uid, course.id]))[0]
        course.total = r.total; course.done = r.done
        course.completion = r.total ? Math.round(r.done / r.total * 100) : 0
        course.quiz = (await c.query<any>(`
          SELECT count(*)::int AS taken,
                 round(avg(a.score / nullif(a.max_score,0)) * 100)::int AS avg_pct,
                 count(*) FILTER (WHERE a.passed)::int AS passed
            FROM quiz_attempt a JOIN quiz q ON q.id = a.quiz_id
           WHERE q.course_id = $1 AND a.user_id = $2 AND a.status = 'submitted'`, [course.id, uid]))[0]
      }
      return {
        courses,
        stats: (await c.query<any>(`
          SELECT (SELECT coalesce(round(sum(seconds_spent)/60.0)::int,0) FROM progress WHERE user_id=$1) AS minutes,
                 (SELECT count(*)::int FROM exercise_attempt WHERE user_id=$1) AS exercise_attempts,
                 (SELECT count(*)::int FROM submission WHERE user_id=$1 AND status='graded') AS graded,
                 (SELECT round(avg(score))::int FROM submission WHERE user_id=$1 AND score IS NOT NULL) AS avg_assignment
          `, [uid]))[0],
        badges: await c.query(
          'SELECT badge_key, earned_at FROM achievement WHERE user_id = $1 ORDER BY earned_at DESC', [uid]),
        recent: await c.query(`
          SELECT p.node_type, p.status, p.last_activity_at, c.title AS course
            FROM progress p JOIN course c ON c.id = p.course_id
           WHERE p.user_id = $1 ORDER BY p.last_activity_at DESC LIMIT 12`, [uid]),
      }
    }))

  app.get('/api/v1/student/certificates', requires('certificate:read'), async req =>
    req.db(async c => ({
      certificates: await c.query(`
        SELECT cert.id, cert.serial, cert.verification_code, cert.final_score, cert.issued_at,
               c.title AS course, c.level
          FROM certificate cert JOIN course c ON c.id = cert.course_id
         WHERE cert.user_id = $1 ORDER BY cert.issued_at DESC`, [req.access.userId]),
    })))

  app.get('/api/v1/student/profile', requires('me:read'), async req =>
    req.db(async c => ({
      profile: (await c.query<any>(`
        SELECT u.id, u.full_name, u.email, u.phone, u.created_at,
               sp.grade_level, sp.guardian_name, sp.guardian_email, sp.guardian_phone, sp.consent_status
          FROM app_user u LEFT JOIN student_profile sp ON sp.user_id = u.id WHERE u.id = $1`,
        [req.access.userId]))[0],
    })))

  app.patch('/api/v1/student/profile', requires('me:read'), async req => {
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      await c.query(`
        UPDATE student_profile
           SET grade_level = coalesce($1, grade_level),
               guardian_name = coalesce($2, guardian_name),
               guardian_email = coalesce($3, guardian_email),
               guardian_phone = coalesce($4, guardian_phone)
         WHERE user_id = $5`,
        [b.gradeLevel ?? null, b.guardianName ?? null, b.guardianEmail ?? null, b.guardianPhone ?? null,
          req.access.userId])
      return { ok: true }
    })
  })
}
