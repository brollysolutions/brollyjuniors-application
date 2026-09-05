import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { Conn } from '@brolly/db'
import { badRequest, conflict, forbidden, locked, notFound } from '../http.ts'
import { requires } from '../guards.ts'
import { assertEntitledToCourse, courseOfUnit, assertOwnRow } from '../policies.ts'
import type { TestResult } from '@brolly/shared'

/** The courses this student is actually enrolled in. Everything reads from here. */
async function myCourses(c: Conn, userId: string): Promise<string[]> {
  const rows = await c.query<{ course_id: string }>(
    `SELECT course_id FROM enrollment WHERE user_id = $1 AND status = 'active'`, [userId])
  return rows.map(r => r.course_id)
}

async function myClassIds(c: Conn, userId: string): Promise<string[]> {
  const rows = await c.query<{ class_id: string }>(
    'SELECT class_id FROM class_student WHERE user_id = $1 AND left_at IS NULL', [userId])
  return rows.map(r => r.class_id)
}

/**
 * Grade a run.
 *
 * Source rules (must use a loop, must not use sum()) are checked HERE, on the
 * server, against the submitted source — those cannot be faked from the browser.
 * Output rules compare against stdout produced by Pyodide in the student's tab,
 * which a determined student could forge; that is the v1 trade-off recorded as
 * decision D7, and it is why a server-side sandbox is the hardening step before
 * these scores are allowed to carry real weight.
 */
function gradeRun(
  tests: Array<{ name: string; stdin?: string; expect?: string; requireSource?: string; forbidSource?: string; hint?: string }>,
  source: string,
  outputs: Record<string, string>,
): { results: TestResult[]; passed: number; total: number } {
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
    return { name: t.name, passed: ok, detail: ok ? 'Output matched' : (t.hint ?? `Expected to see ${t.expect} in the output`) }
  })
  return { results, passed: results.filter(r => r.passed).length, total: results.length }
}

export default async function studentRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  app.get('/api/v1/student/home', requires('progress:read:self'), async req =>
    req.db(async c => {
      const uid = req.access.userId
      const classIds = await myClassIds(c, uid)

      const counts = (await c.query<any>(`
        SELECT
          (SELECT count(*)::int FROM video)        AS videos_total,
          (SELECT count(*)::int FROM material)     AS materials_total,
          (SELECT count(*)::int FROM practice_lab) AS practice_total,
          (SELECT count(*)::int FROM graded_lab)   AS labs_total,
          (SELECT count(*)::int FROM progress WHERE user_id=$1 AND node_type='video'        AND status='completed') AS videos_done,
          (SELECT count(*)::int FROM progress WHERE user_id=$1 AND node_type='material'     AND status='completed') AS materials_done,
          (SELECT count(*)::int FROM progress WHERE user_id=$1 AND node_type='practice_lab' AND status='completed') AS practice_done,
          (SELECT count(*)::int FROM lab_submission WHERE user_id=$1 AND status='graded')    AS labs_done`,
        [uid]))[0]

      // "Carry on where you stopped" — genuinely the next unfinished thing.
      const continueItems = await c.query<any>(`
        SELECT v.id, v.title, 'video' AS kind, u.code AS unit, v.duration_seconds,
               coalesce(p.percent, 0) AS percent
          FROM video v JOIN unit u ON u.id = v.unit_id
          LEFT JOIN progress p ON p.node_id = v.id AND p.user_id = $1
         WHERE coalesce(p.status,'not_started') <> 'completed'
         ORDER BY (p.percent IS NULL), u.position, v.position LIMIT 3`, [uid])

      const nextExam = (await c.query<any>(`
        SELECT e.id, e.title, e.starts_at, e.duration_minutes, e.status
          FROM exam e WHERE e.class_id = ANY($1::uuid[]) AND e.starts_at > now() - interval '1 day'
         ORDER BY e.starts_at LIMIT 1`, [classIds.length ? classIds : [randomUUID()]]))[0] ?? null

      const nextLab = (await c.query<any>(`
        SELECT g.id, g.program_no, g.title FROM graded_lab g
         WHERE NOT EXISTS (SELECT 1 FROM lab_submission ls
                            WHERE ls.graded_lab_id = g.id AND ls.user_id = $1 AND ls.status <> 'revision')
         ORDER BY g.program_no LIMIT 1`, [uid]))[0] ?? null

      const announcements = classIds.length ? await c.query<any>(`
        SELECT a.body, a.created_at, u.full_name AS teacher
          FROM announcement a JOIN app_user u ON u.id = a.created_by
         WHERE a.class_id = ANY($1::uuid[]) ORDER BY a.created_at DESC LIMIT 3`, [classIds]) : []

      return { counts, continueItems, nextExam, nextLab, announcements }
    }))

  // -------------------------------------------------------------------------
  app.get('/api/v1/student/videos', requires('content:read'), async req =>
    req.db(async c => ({
      units: await c.query('SELECT id, code, title FROM unit ORDER BY position'),
      videos: await c.query(`
        SELECT v.id, v.title, v.duration_seconds, u.code AS unit,
               coalesce(p.percent, 0)::int AS percent, coalesce(p.status,'not_started') AS status
          FROM video v JOIN unit u ON u.id = v.unit_id
          LEFT JOIN progress p ON p.node_id = v.id AND p.user_id = $1
         ORDER BY u.position, v.position`, [req.access.userId]),
    })))

  app.get('/api/v1/student/videos/:id', requires('content:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const v = (await c.query<any>(`
        SELECT v.id, v.title, v.duration_seconds, v.summary, u.code AS unit, u.id AS unit_id, u.title AS unit_title
          FROM video v JOIN unit u ON u.id = v.unit_id WHERE v.id = $1`, [id]))[0]
      if (!v) throw notFound('No such video.')
      // Entitlement first, every time. Hiding it in the UI has no security role.
      await assertEntitledToCourse(c, req.access, await courseOfUnit(c, v.unit_id))
      return {
        video: v,
        progress: (await c.query<any>(
          `SELECT percent, status FROM progress WHERE user_id=$1 AND node_id=$2`, [req.access.userId, id]))[0] ?? null,
        note: (await c.query<any>(
          `SELECT body FROM video_note WHERE user_id=$1 AND video_id=$2`, [req.access.userId, id]))[0]?.body ?? '',
        nextInUnit: await c.query(`
          SELECT v.id, v.title, v.duration_seconds FROM video v
           WHERE v.unit_id = $1 AND v.id <> $2 ORDER BY v.position LIMIT 3`, [v.unit_id, id]),
      }
    })
  })

  app.post('/api/v1/student/videos/:id/progress', requires('content:read'), async req => {
    const id = (req.params as any).id
    const percent = Math.max(0, Math.min(100, Number((req.body as any)?.percent ?? 0)))
    const seconds = Math.max(0, Math.min(7200, Number((req.body as any)?.seconds ?? 0)))
    return req.db(async c => {
      await upsertProgress(c, req.access.tenantId, req.access.userId, 'video', id, percent, seconds)
      return { ok: true, percent }
    })
  })

  app.put('/api/v1/student/videos/:id/note', requires('content:read'), async req => {
    const id = (req.params as any).id
    const body = String((req.body as any)?.body ?? '').slice(0, 4000)
    return req.db(async c => {
      await c.query(`
        INSERT INTO video_note (id, tenant_id, user_id, video_id, body)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (tenant_id, user_id, video_id) DO UPDATE SET body = excluded.body, updated_at = now()`,
        [randomUUID(), req.access.tenantId, req.access.userId, id, body])
      return { ok: true }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/student/materials', requires('content:read'), async req =>
    req.db(async c => ({
      materials: await c.query(`
        SELECT m.id, m.title, m.kind, m.pages, u.code AS unit, 'Brolly' AS source,
               (p.status = 'completed') AS read
          FROM material m JOIN unit u ON u.id = m.unit_id
          LEFT JOIN progress p ON p.node_id = m.id AND p.user_id = $1
         ORDER BY u.position, m.position`, [req.access.userId]),
      fromTeacher: await c.query(`
        SELECT tm.id, tm.title, tm.kind, u.full_name AS teacher, tm.created_at
          FROM teacher_material tm
          JOIN teacher_material_class tmc ON tmc.material_id = tm.id
          JOIN class_student cs ON cs.class_id = tmc.class_id AND cs.user_id = $1 AND cs.left_at IS NULL
          JOIN app_user u ON u.id = tm.created_by
         WHERE tm.status = 'shared'
         ORDER BY tm.created_at DESC`, [req.access.userId]),
    })))

  app.get('/api/v1/student/materials/:id', requires('content:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const m = (await c.query<any>(`
        SELECT m.id, m.title, m.kind, m.pages, u.code AS unit, u.id AS unit_id,
               cv.body, cv.version_no, cv.published_at
          FROM material m JOIN unit u ON u.id = m.unit_id
          LEFT JOIN content_version cv
            ON cv.content_item_id = m.content_item_id AND cv.status = 'published' AND cv.locale = 'en'
         WHERE m.id = $1`, [id]))[0]
      if (!m) throw notFound('No such material.')
      await assertEntitledToCourse(c, req.access, await courseOfUnit(c, m.unit_id))
      // The body comes from the currently published content_version, so a
      // Content Hub publish reaches this student with no deploy of any kind.
      return { material: m }
    })
  })

  app.get('/api/v1/student/teacher-materials/:id', requires('content:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const m = (await c.query<any>(`
        SELECT tm.id, tm.title, tm.kind, tm.body, u.full_name AS teacher, tm.created_at
          FROM teacher_material tm
          JOIN teacher_material_class tmc ON tmc.material_id = tm.id
          JOIN class_student cs ON cs.class_id = tmc.class_id AND cs.user_id = $1 AND cs.left_at IS NULL
          JOIN app_user u ON u.id = tm.created_by
         WHERE tm.id = $2 AND tm.status = 'shared'`, [req.access.userId, id]))[0]
      if (!m) throw notFound('No such material.')
      return { material: m }
    })
  })

  app.post('/api/v1/student/materials/:id/read', requires('content:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      await upsertProgress(c, req.access.tenantId, req.access.userId, 'material', id, 100, 60)
      return { ok: true }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/student/practice', requires('practice:attempt'), async req =>
    req.db(async c => ({
      stats: (await c.query<any>(`
        SELECT (SELECT count(*)::int FROM practice_lab) AS total,
               (SELECT count(*)::int FROM progress
                 WHERE user_id=$1 AND node_type='practice_lab' AND status='completed') AS solved,
               (SELECT count(*)::int FROM practice_attempt WHERE user_id=$1) AS attempts,
               (SELECT count(*)::int FROM lab_submission WHERE user_id=$1 AND status='graded') AS labs_done,
               (SELECT count(*)::int FROM graded_lab) AS labs_total`, [req.access.userId]))[0],
      labs: await c.query(`
        SELECT p.id, p.title, p.level, u.code AS unit,
               (SELECT count(*)::int FROM practice_attempt a WHERE a.practice_lab_id=p.id AND a.user_id=$1) AS attempts,
               coalesce(pr.status,'not_started') AS status
          FROM practice_lab p JOIN unit u ON u.id = p.unit_id
          LEFT JOIN progress pr ON pr.node_id = p.id AND pr.user_id = $1
         ORDER BY u.position, p.position`, [req.access.userId]),
    })))

  app.get('/api/v1/student/practice/:id', requires('practice:attempt'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const p = (await c.query<any>(`
        SELECT p.id, p.title, p.level, p.brief, p.starter_code, p.hints, p.solution, p.test_cases, u.id AS unit_id, u.code AS unit
          FROM practice_lab p JOIN unit u ON u.id = p.unit_id WHERE p.id = $1`, [id]))[0]
      if (!p) throw notFound('No such practice lab.')
      await assertEntitledToCourse(c, req.access, await courseOfUnit(c, p.unit_id))
      const last = (await c.query<any>(
        `SELECT code FROM practice_attempt WHERE user_id=$1 AND practice_lab_id=$2
          ORDER BY created_at DESC LIMIT 1`, [req.access.userId, id]))[0]
      return {
        lab: {
          id: p.id, title: p.title, level: p.level, brief: p.brief, unit: p.unit,
          starterCode: last?.code ?? p.starter_code,
          hints: p.hints,
          // Looking at the answer is allowed in practice. It is not in a graded lab.
          solution: p.solution,
          tests: (p.test_cases ?? []).map((t: any) => ({ name: t.name, stdin: t.stdin ?? '' })),
        },
      }
    })
  })

  app.post('/api/v1/student/practice/:id/attempt', requires('practice:attempt'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    const source = String(b.code ?? '')
    return req.db(async c => {
      const p = (await c.query<any>('SELECT id, test_cases, unit_id FROM practice_lab WHERE id = $1', [id]))[0]
      if (!p) throw notFound('No such practice lab.')
      await assertEntitledToCourse(c, req.access, await courseOfUnit(c, p.unit_id))

      const { results, passed, total } = gradeRun(p.test_cases ?? [], source, b.outputs ?? {})
      await c.query(
        `INSERT INTO practice_attempt (id, tenant_id, user_id, practice_lab_id, code, stdout, passed_count, total_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), req.access.tenantId, req.access.userId, id, source,
          String(b.stdout ?? '').slice(0, 8000), passed, total])

      // Practice is never marked. Solving it only marks the node complete.
      if (total > 0 && passed === total) {
        await upsertProgress(c, req.access.tenantId, req.access.userId, 'practice_lab', id, 100, 120)
      }
      return { results, passed, total, solved: total > 0 && passed === total }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/student/labs', requires('lab:submit'), async req =>
    req.db(async c => ({
      labs: await c.query(`
        SELECT g.id, g.program_no, g.title, g.mode, g.max_score,
               ls.id AS submission_id, ls.status, ls.score, ls.submitted_at, ls.mode AS submitted_mode
          FROM graded_lab g
          LEFT JOIN LATERAL (
            SELECT * FROM lab_submission s
             WHERE s.graded_lab_id = g.id AND s.user_id = $1
             ORDER BY s.attempt_no DESC LIMIT 1) ls ON true
         ORDER BY g.program_no`, [req.access.userId]),
    })))

  app.get('/api/v1/student/labs/:id', requires('lab:submit'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const g = (await c.query<any>(
        `SELECT g.*, u.code AS unit FROM graded_lab g LEFT JOIN unit u ON u.id = g.unit_id WHERE g.id = $1`, [id]))[0]
      if (!g) throw notFound('No such lab.')
      await assertEntitledToCourse(c, req.access, g.course_id)
      const mine = (await c.query<any>(
        `SELECT * FROM lab_submission WHERE graded_lab_id=$1 AND user_id=$2 ORDER BY attempt_no DESC LIMIT 1`,
        [id, req.access.userId]))[0] ?? null
      return {
        lab: {
          id: g.id, programNo: g.program_no, title: g.title, brief: g.brief, mode: g.mode,
          maxScore: g.max_score,
          // The student sees the rubric BEFORE starting. No hidden goalposts.
          rubric: g.rubric,
          starterCode: mine?.code || g.starter_code,
          tests: (g.test_cases ?? []).map((t: any) => ({ name: t.name, stdin: t.stdin ?? '' })),
          unit: g.unit,
        },
        submission: mine,
      }
    })
  })

  app.post('/api/v1/student/labs/:id/submit', requires('lab:submit'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const g = (await c.query<any>('SELECT * FROM graded_lab WHERE id=$1', [id]))[0]
      if (!g) throw notFound('No such lab.')
      await assertEntitledToCourse(c, req.access, g.course_id)

      const classId = (await myClassIds(c, req.access.userId))[0]
      if (!classId) throw conflict('You are not in a class yet. Ask your school admin.', 'no_class')

      const prev = (await c.query<any>(
        `SELECT id, attempt_no, status FROM lab_submission
          WHERE graded_lab_id=$1 AND user_id=$2 ORDER BY attempt_no DESC LIMIT 1`, [id, req.access.userId]))[0]
      if (prev && prev.status === 'graded') {
        throw conflict('This program has already been graded. Ask your teacher to reopen it.', 'already_graded')
      }

      const mode = b.mode === 'uploaded' ? 'uploaded' : 'in_app'
      const source = String(b.code ?? '')
      let autoScore: number | null = null
      let detail: TestResult[] = []
      if (mode === 'in_app') {
        const graded = gradeRun(g.test_cases ?? [], source, b.outputs ?? {})
        detail = graded.results
        autoScore = graded.total ? Math.round(graded.passed / graded.total * g.max_score) : null
      }

      // A revision reuses the same attempt number: sending work back for a fix
      // is not meant to cost the student an attempt.
      const attemptNo = prev ? prev.attempt_no : 1
      if (prev) {
        await c.query(
          `UPDATE lab_submission SET mode=$1, code=$2, stdout=$3, auto_score=$4, auto_detail=$5,
                  file_name=$6, student_note=$7, status='submitted', submitted_at=now()
            WHERE id=$8`,
          [mode, source, String(b.stdout ?? '').slice(0, 8000), autoScore, JSON.stringify(detail),
            String(b.fileName ?? ''), String(b.note ?? ''), prev.id])
        return { ok: true, submissionId: prev.id, autoScore, results: detail }
      }
      const subId = randomUUID()
      await c.query(
        `INSERT INTO lab_submission
           (id, tenant_id, user_id, class_id, graded_lab_id, attempt_no, mode, code, stdout,
            auto_score, auto_detail, file_name, student_note, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'submitted')`,
        [subId, req.access.tenantId, req.access.userId, classId, id, attemptNo, mode, source,
          String(b.stdout ?? '').slice(0, 8000), autoScore, JSON.stringify(detail),
          String(b.fileName ?? ''), String(b.note ?? '')])
      return { ok: true, submissionId: subId, autoScore, results: detail }
    })
  })

  app.post('/api/v1/student/labs/:id/run', requires('lab:submit'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const g = (await c.query<any>('SELECT test_cases, max_score, course_id FROM graded_lab WHERE id=$1', [id]))[0]
      if (!g) throw notFound('No such lab.')
      await assertEntitledToCourse(c, req.access, g.course_id)
      // Running is free and unlimited. Only Submit counts.
      return gradeRun(g.test_cases ?? [], String(b.code ?? ''), b.outputs ?? {})
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/student/exams', requires('exam:read'), async req =>
    req.db(async c => {
      const classIds = await myClassIds(c, req.access.userId)
      if (!classIds.length) return { exams: [] }
      return {
        exams: await c.query(`
          SELECT e.id, e.title, e.starts_at, e.duration_minutes, e.status,
                 a.id AS attempt_id, a.status AS attempt_status, a.total_score, a.max_score
            FROM exam e
            LEFT JOIN exam_attempt a ON a.exam_id = e.id AND a.user_id = $1
           WHERE e.class_id = ANY($2::uuid[])
           ORDER BY e.starts_at DESC`, [req.access.userId, classIds]),
      }
    }))

  /**
   * Exam gating is entirely server-side. The paper does not exist in any
   * response until the start time has passed — there is nothing in the client
   * to unlock early.
   */
  app.get('/api/v1/student/exams/:id', requires('exam:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const e = (await c.query<any>(`
        SELECT e.id, e.title, e.starts_at, e.duration_minutes, e.status, e.class_id
          FROM exam e
          JOIN class_student cs ON cs.class_id = e.class_id AND cs.user_id = $1 AND cs.left_at IS NULL
         WHERE e.id = $2`, [req.access.userId, id]))[0]
      if (!e) throw notFound('No such exam.')

      const now = Date.now()
      const opensAt = new Date(e.starts_at).getTime()
      const attempt = (await c.query<any>(
        'SELECT * FROM exam_attempt WHERE exam_id=$1 AND user_id=$2', [id, req.access.userId]))[0] ?? null

      const closesAt = attempt
        ? new Date(attempt.started_at).getTime() + e.duration_minutes * 60_000
        : opensAt + e.duration_minutes * 60_000

      if (now < opensAt) {
        return { exam: { ...e, questionCount: await countQuestions(c, id) }, state: 'locked', opensAt: e.starts_at, attempt: null }
      }
      if (e.status === 'released' && attempt) {
        return { exam: e, state: 'released', attempt, answers: await releasedAnswers(c, id, attempt.id) }
      }
      if (attempt?.status === 'submitted' || attempt?.status === 'marked') {
        return { exam: e, state: 'submitted', attempt }
      }
      if (now > closesAt && !attempt) {
        return { exam: e, state: 'closed', attempt: null }
      }

      // Questions are only ever sent without answer_index.
      const questions = await c.query<any>(`
        SELECT eq.id, eq.position, eq.kind, eq.text, eq.options, eq.marks
          FROM exam_question eq WHERE eq.exam_id = $1 ORDER BY eq.position`, [id])
      const answers = attempt ? await c.query<any>(
        `SELECT exam_question_id, choice_index, text_answer FROM exam_answer WHERE attempt_id = $1`,
        [attempt.id]) : []

      return {
        exam: e, state: attempt ? 'in_progress' : 'ready',
        questions, answers, attempt,
        closesAt: new Date(closesAt).toISOString(),
      }
    })
  })

  app.post('/api/v1/student/exams/:id/start', requires('exam:sit'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const e = (await c.query<any>(`
        SELECT e.id, e.starts_at, e.duration_minutes, e.status
          FROM exam e
          JOIN class_student cs ON cs.class_id = e.class_id AND cs.user_id = $1 AND cs.left_at IS NULL
         WHERE e.id = $2`, [req.access.userId, id]))[0]
      if (!e) throw notFound('No such exam.')
      if (Date.now() < new Date(e.starts_at).getTime()) {
        throw locked('The paper unlocks by itself at the start time.', 'exam_not_open')
      }
      if (e.status === 'released') throw conflict('This exam is finished.', 'exam_closed')

      const existing = (await c.query<any>(
        'SELECT id, status FROM exam_attempt WHERE exam_id=$1 AND user_id=$2', [id, req.access.userId]))[0]
      if (existing) {
        if (existing.status !== 'in_progress') throw conflict('You have already submitted this paper.', 'already_submitted')
        return { attemptId: existing.id, resumed: true }
      }

      const maxScore = Number((await c.query<{ n: string }>(
        'SELECT coalesce(sum(marks),0)::text AS n FROM exam_question WHERE exam_id=$1', [id]))[0].n)
      const attemptId = randomUUID()
      await c.query(
        `INSERT INTO exam_attempt (id, tenant_id, exam_id, user_id, status, max_score)
         VALUES ($1,$2,$3,$4,'in_progress',$5)`,
        [attemptId, req.access.tenantId, id, req.access.userId, maxScore])
      return { attemptId, resumed: false }
    })
  })

  /**
   * Autosave. Answers are written to the server on every change, which is what
   * makes a dropped connection in a school computer lab a non-event: signing
   * back in resumes from the last saved answer.
   */
  app.post('/api/v1/student/exams/:id/answer', requires('exam:sit'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const attempt = (await c.query<any>(
        `SELECT a.id, a.status, a.started_at, e.duration_minutes
           FROM exam_attempt a JOIN exam e ON e.id = a.exam_id
          WHERE a.exam_id=$1 AND a.user_id=$2`, [id, req.access.userId]))[0]
      if (!attempt) throw notFound('You have not started this paper.')
      assertOwnRow(req.access, req.access.userId)
      if (attempt.status !== 'in_progress') throw conflict('This paper is already submitted.', 'already_submitted')
      if (Date.now() > new Date(attempt.started_at).getTime() + attempt.duration_minutes * 60_000) {
        throw locked('Time is up. The paper submitted itself.', 'time_up')
      }

      const q = (await c.query<any>(
        'SELECT id, kind, answer_index, marks FROM exam_question WHERE id=$1 AND exam_id=$2',
        [b.questionId, id]))[0]
      if (!q) throw notFound('No such question on this paper.')

      // Objective questions mark themselves, here, out of the snapshot. The
      // correct index is never sent to the browser.
      const isCorrect = q.kind === 'objective' ? Number(b.choiceIndex) === q.answer_index : null
      const marks = q.kind === 'objective' ? (isCorrect ? q.marks : 0) : null

      await c.query(`
        INSERT INTO exam_answer (id, tenant_id, attempt_id, exam_question_id, choice_index, text_answer, is_correct, marks_awarded)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (tenant_id, attempt_id, exam_question_id) DO UPDATE
          SET choice_index = excluded.choice_index,
              text_answer  = excluded.text_answer,
              is_correct   = excluded.is_correct,
              marks_awarded = excluded.marks_awarded,
              saved_at = now()`,
        [randomUUID(), req.access.tenantId, attempt.id, q.id,
          q.kind === 'objective' ? Number(b.choiceIndex) : null,
          q.kind === 'written' ? String(b.text ?? '').slice(0, 8000) : '',
          isCorrect, marks])

      await c.query('UPDATE exam_attempt SET last_saved_at = now() WHERE id = $1', [attempt.id])
      return { ok: true, savedAt: new Date().toISOString() }
    })
  })

  app.post('/api/v1/student/exams/:id/submit', requires('exam:sit'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const attempt = (await c.query<any>(
        'SELECT id, status FROM exam_attempt WHERE exam_id=$1 AND user_id=$2', [id, req.access.userId]))[0]
      if (!attempt) throw notFound('You have not started this paper.')
      if (attempt.status !== 'in_progress') return { ok: true, alreadySubmitted: true }

      const obj = Number((await c.query<{ n: string }>(`
        SELECT coalesce(sum(ea.marks_awarded),0)::text AS n FROM exam_answer ea
          JOIN exam_question eq ON eq.id = ea.exam_question_id AND eq.kind='objective'
         WHERE ea.attempt_id = $1`, [attempt.id]))[0].n)

      await c.query(
        `UPDATE exam_attempt SET status='submitted', submitted_at=now(), objective_score=$1 WHERE id=$2`,
        [obj, attempt.id])
      await c.query(`UPDATE exam SET status='marking' WHERE id=$1 AND status='scheduled'`, [id])
      // No score is returned: written answers are not marked yet, and a student
      // must never see half a result.
      return { ok: true, submittedAt: new Date().toISOString() }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/student/results', requires('progress:read:self'), async req =>
    req.db(async c => {
      const uid = req.access.userId
      return {
        results: await c.query(`
          SELECT e.id, e.title, e.starts_at, e.status,
                 CASE WHEN e.status='released' THEN a.total_score END AS score,
                 CASE WHEN e.status='released' THEN a.max_score   END AS max_score,
                 CASE WHEN e.status='released' THEN (
                   SELECT round(avg(x.total_score/nullif(x.max_score,0))*100)::int
                     FROM exam_attempt x WHERE x.exam_id = e.id AND x.total_score IS NOT NULL) END AS class_avg,
                 a.status AS attempt_status
            FROM exam_attempt a JOIN exam e ON e.id = a.exam_id
           WHERE a.user_id = $1 ORDER BY e.starts_at DESC`, [uid]),
        // Strong and weak topics, from the student's own released answers only.
        topics: await c.query(`
          SELECT q.topic,
                 round(avg(CASE WHEN eq.kind='objective'
                                THEN CASE WHEN ea.is_correct THEN 100 ELSE 0 END
                                ELSE ea.marks_awarded / nullif(eq.marks,0) * 100 END))::int AS pct
            FROM exam_answer ea
            JOIN exam_attempt a ON a.id = ea.attempt_id AND a.user_id = $1
            JOIN exam e ON e.id = a.exam_id AND e.status = 'released'
            JOIN exam_question eq ON eq.id = ea.exam_question_id
            JOIN question q ON q.id = eq.question_id
           WHERE q.topic <> ''
           GROUP BY q.topic ORDER BY pct DESC`, [uid]),
      }
    }))

  /** The practical file: 15 approved programs unlock the PDF for the board practical. */
  app.get('/api/v1/student/practical-file', requires('lab:submit'), async req =>
    req.db(async c => {
      const rows = await c.query<any>(`
        SELECT g.program_no, g.title, g.mode, g.max_score,
               ls.status, ls.score, ls.mode AS submitted_mode, ls.submitted_at, ls.feedback
          FROM graded_lab g
          LEFT JOIN LATERAL (
            SELECT * FROM lab_submission s WHERE s.graded_lab_id=g.id AND s.user_id=$1
             ORDER BY s.attempt_no DESC LIMIT 1) ls ON true
         ORDER BY g.program_no`, [req.access.userId])
      const approved = rows.filter(r => r.status === 'graded').length
      return {
        programs: rows,
        approved,
        total: rows.length,
        canDownload: approved === rows.length && rows.length > 0,
      }
    }))

  app.get('/api/v1/student/profile', requires('progress:read:self'), async req =>
    req.db(async c => ({
      profile: (await c.query<any>(`
        SELECT u.id, u.full_name, u.username, sp.roll_no, sp.grade_level, sp.section_label,
               sp.guardian_name, sp.guardian_phone, t.name AS school, sc.name AS class_name
          FROM app_user u
          LEFT JOIN student_profile sp ON sp.user_id = u.id
          JOIN tenant t ON t.id = u.tenant_id
          LEFT JOIN class_student cs ON cs.user_id = u.id AND cs.left_at IS NULL
          LEFT JOIN school_class sc ON sc.id = cs.class_id
         WHERE u.id = $1`, [req.access.userId]))[0],
      stats: (await c.query<any>(`
        SELECT (SELECT count(*)::int FROM progress WHERE user_id=$1 AND status='completed') AS completed,
               (SELECT coalesce(round(sum(seconds_spent)/60.0)::int,0) FROM progress WHERE user_id=$1) AS minutes,
               (SELECT count(*)::int FROM lab_submission WHERE user_id=$1 AND status='graded') AS labs,
               (SELECT round(avg(total_score/nullif(max_score,0))*100)::int FROM exam_attempt
                 WHERE user_id=$1 AND total_score IS NOT NULL) AS avg_exam`, [req.access.userId]))[0],
      badges: await c.query(
        'SELECT badge_key, earned_at FROM achievement WHERE user_id=$1 ORDER BY earned_at', [req.access.userId]),
    })))

  app.patch('/api/v1/student/profile', requires('progress:read:self'), async req => {
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      await c.query(
        `UPDATE student_profile SET guardian_name = coalesce($1, guardian_name),
                                    guardian_phone = coalesce($2, guardian_phone)
          WHERE user_id = $3`,
        [b.guardianName ?? null, b.guardianPhone ?? null, req.access.userId])
      return { ok: true }
    })
  })
}

// ---------------------------------------------------------------------------

async function upsertProgress(
  c: Conn, tenantId: string, userId: string, nodeType: string, nodeId: string,
  percent: number, seconds: number,
) {
  await c.query(`
    INSERT INTO progress (id, tenant_id, user_id, node_type, node_id, status, percent, seconds_spent, attempts, last_activity_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1, now())
    ON CONFLICT (tenant_id, user_id, node_type, node_id) DO UPDATE
      SET status = CASE WHEN excluded.percent >= 100 THEN 'completed' ELSE progress.status END,
          percent = greatest(progress.percent, excluded.percent),
          seconds_spent = progress.seconds_spent + excluded.seconds_spent,
          attempts = progress.attempts + 1,
          last_activity_at = now()`,
    [randomUUID(), tenantId, userId, nodeType, nodeId, percent >= 100 ? 'completed' : 'in_progress', percent, seconds])
}

async function countQuestions(c: Conn, examId: string) {
  return Number((await c.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM exam_question WHERE exam_id=$1', [examId]))[0].n)
}

async function releasedAnswers(c: Conn, examId: string, attemptId: string) {
  return c.query(`
    SELECT eq.position, eq.text, eq.kind, eq.marks, eq.options, eq.answer_index,
           ea.choice_index, ea.text_answer, ea.is_correct, ea.marks_awarded
      FROM exam_question eq
      LEFT JOIN exam_answer ea ON ea.exam_question_id = eq.id AND ea.attempt_id = $2
     WHERE eq.exam_id = $1 ORDER BY eq.position`, [examId, attemptId])
}
