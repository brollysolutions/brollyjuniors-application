import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { Conn } from '@brolly/db'
import { badRequest, conflict, notFound } from '../http.ts'
import { requires } from '../guards.ts'
import { assertTeachesClass, assertCanSeeStudent, teacherClassIds } from '../policies.ts'
import { classRoster } from './school.ts'

export default async function teacherRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  app.get('/api/v1/teacher/classes', requires('class:read'), async req =>
    req.db(async c => ({
      classes: await c.query(`
        WITH node_total AS (
          SELECT count(*)::numeric AS n FROM (
            SELECT id FROM video UNION ALL SELECT id FROM material UNION ALL SELECT id FROM practice_lab) z)
        SELECT sc.id, sc.name, co.title AS course,
               count(DISTINCT cs.user_id)::int AS students,
               round(coalesce(count(p.id) FILTER (WHERE p.status='completed')::numeric
                 / nullif(count(DISTINCT cs.user_id) * (SELECT n FROM node_total),0) * 100, 0))::int AS completion,
               (SELECT count(*)::int FROM lab_submission ls
                 WHERE ls.class_id = sc.id AND ls.status='submitted') AS pending_labs
          FROM class_teacher ct
          JOIN school_class sc ON sc.id = ct.class_id
          JOIN course co ON co.id = sc.course_id
          LEFT JOIN class_student cs ON cs.class_id = sc.id AND cs.left_at IS NULL
          LEFT JOIN progress p ON p.user_id = cs.user_id
         WHERE ct.user_id = $1
         GROUP BY sc.id, sc.name, co.title
         ORDER BY sc.name`, [req.access.userId]),
    })))

  app.get('/api/v1/teacher/classes/:id', requires('class:read'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      await assertTeachesClass(c, req.access, id)
      const cls = (await c.query<any>(
        `SELECT sc.id, sc.name, co.title AS course, co.id AS course_id
           FROM school_class sc JOIN course co ON co.id = sc.course_id WHERE sc.id = $1`, [id]))[0]
      if (!cls) throw notFound('No such class.')
      return {
        class: cls,
        students: await classRoster(c, id),
        announcements: await c.query(
          `SELECT id, body, created_at FROM announcement WHERE class_id = $1 ORDER BY created_at DESC LIMIT 10`, [id]),
      }
    })
  })

  app.get('/api/v1/teacher/students/:id', requires('progress:read:class'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      await assertCanSeeStudent(c, req.access, id)
      const student = (await c.query<any>(`
        SELECT u.id, u.full_name, u.last_login_at, sp.roll_no, sp.guardian_name, sp.guardian_phone,
               sc.name AS class_name,
               coalesce(round(sum(p.seconds_spent)/60.0)::int, 0) AS minutes,
               count(p.id) FILTER (WHERE p.status='completed')::int AS done
          FROM app_user u
          LEFT JOIN student_profile sp ON sp.user_id = u.id
          LEFT JOIN class_student cs ON cs.user_id = u.id AND cs.left_at IS NULL
          LEFT JOIN school_class sc ON sc.id = cs.class_id
          LEFT JOIN progress p ON p.user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id, u.full_name, u.last_login_at, sp.roll_no, sp.guardian_name, sp.guardian_phone, sc.name`,
        [id]))[0]
      if (!student) throw notFound('No such student.')

      return {
        student,
        totalNodes: Number((await c.query<{ n: string }>(
          `SELECT (
             (SELECT count(*) FROM video) + (SELECT count(*) FROM material) + (SELECT count(*) FROM practice_lab)
           )::text AS n`))[0].n),
        lessons: await c.query(`
          SELECT v.id, v.title, u.code AS unit,
                 coalesce(p.status, 'not_started') AS status, coalesce(p.percent, 0) AS percent
            FROM video v JOIN unit u ON u.id = v.unit_id
            LEFT JOIN progress p ON p.node_id = v.id AND p.user_id = $1
           ORDER BY u.position, v.position`, [id]),
        labs: await c.query(`
          SELECT ls.id, g.program_no, g.title, ls.mode, ls.status, ls.score, ls.auto_score, ls.submitted_at
            FROM lab_submission ls JOIN graded_lab g ON g.id = ls.graded_lab_id
           WHERE ls.user_id = $1 ORDER BY g.program_no`, [id]),
        exams: await c.query(`
          SELECT e.title, a.total_score, a.max_score, a.status, e.status AS exam_status
            FROM exam_attempt a JOIN exam e ON e.id = a.exam_id
           WHERE a.user_id = $1 ORDER BY e.starts_at DESC`, [id]),
      }
    })
  })

  // -------------------------------------------------------------------------
  /** Library = master curriculum this school is entitled to, plus your own material. */
  app.get('/api/v1/teacher/library', requires('content:read'), async req =>
    req.db(async c => ({
      units: await c.query(`
        SELECT u.id, u.code, u.title, u.status FROM unit u
          JOIN tenant_entitlement e ON e.resource_type='course' AND e.resource_id = u.course_id AND e.status='active'
         ORDER BY u.position`),
      videos: await c.query(`
        SELECT v.id, v.title, v.duration_seconds, u.code AS unit FROM video v
          JOIN unit u ON u.id = v.unit_id
          JOIN tenant_entitlement e ON e.resource_type='course' AND e.resource_id = u.course_id AND e.status='active'
         ORDER BY u.position, v.position`),
      materials: await c.query(`
        SELECT m.id, m.title, m.kind, m.pages, u.code AS unit, 'Brolly' AS source FROM material m
          JOIN unit u ON u.id = m.unit_id
          JOIN tenant_entitlement e ON e.resource_type='course' AND e.resource_id = u.course_id AND e.status='active'
         ORDER BY u.position, m.position`),
      practice: await c.query(`
        SELECT p.id, p.title, p.level, u.code AS unit FROM practice_lab p
          JOIN unit u ON u.id = p.unit_id
          JOIN tenant_entitlement e ON e.resource_type='course' AND e.resource_id = u.course_id AND e.status='active'
         ORDER BY u.position, p.position`),
      gradedLabs: await c.query(
        `SELECT g.id, g.program_no, g.title, g.mode FROM graded_lab g
           JOIN tenant_entitlement e ON e.resource_type='course' AND e.resource_id = g.course_id AND e.status='active'
          ORDER BY g.program_no`),
      mine: await c.query(`
        SELECT tm.id, tm.title, tm.kind, tm.status, tm.created_at,
               coalesce(array_agg(sc.name) FILTER (WHERE sc.name IS NOT NULL), '{}') AS classes
          FROM teacher_material tm
          LEFT JOIN teacher_material_class tmc ON tmc.material_id = tm.id
          LEFT JOIN school_class sc ON sc.id = tmc.class_id
         WHERE tm.created_by = $1
         GROUP BY tm.id, tm.title, tm.kind, tm.status, tm.created_at
         ORDER BY tm.created_at DESC`, [req.access.userId]),
    })))

  // -------------------------------------------------------------------------
  app.post('/api/v1/teacher/assignments', requires('assignment:create'), async req => {
    const b = (req.body ?? {}) as any
    const items: Array<{ type: string; id: string }> = Array.isArray(b.items) ? b.items : []
    if (!b.classId || !items.length) throw badRequest('Choose a class and at least one item.')
    const ALLOWED = new Set(['video', 'material', 'practice_lab', 'graded_lab', 'teacher_material'])
    if (items.some(i => !ALLOWED.has(i.type))) throw badRequest('Unknown item type.')

    return req.db(async c => {
      await assertTeachesClass(c, req.access, b.classId)
      const id = randomUUID()
      await c.query(
        `INSERT INTO assignment (id, tenant_id, class_id, created_by, title, due_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,'published')`,
        [id, req.access.tenantId, b.classId, req.access.userId,
          String(b.title ?? 'This week'), b.dueAt ?? null])
      for (const it of items) {
        await c.query(
          `INSERT INTO assignment_item (tenant_id, assignment_id, resource_type, resource_id)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [req.access.tenantId, id, it.type, it.id])
      }
      const n = Number((await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM class_student WHERE class_id = $1 AND left_at IS NULL', [b.classId]))[0].n)
      await req.log_audit(c, {
        action: 'assignment.created', entityType: 'assignment', entityId: id,
        summary: `Assigned ${items.length} item(s) to ${n} students`, after: { title: b.title, due_at: b.dueAt },
      })
      return { id, students: n }
    })
  })

  app.get('/api/v1/teacher/assignments', requires('assignment:read'), async req =>
    req.db(async c => {
      const ids = await teacherClassIds(c, req.access.userId)
      if (!ids.length) return { assignments: [] }
      return {
        assignments: await c.query(`
          SELECT a.id, a.title, a.due_at, a.created_at, sc.name AS class_name,
                 count(ai.resource_id)::int AS items
            FROM assignment a
            JOIN school_class sc ON sc.id = a.class_id
            LEFT JOIN assignment_item ai ON ai.assignment_id = a.id
           WHERE a.class_id = ANY($1::uuid[])
           GROUP BY a.id, a.title, a.due_at, a.created_at, sc.name
           ORDER BY a.created_at DESC LIMIT 40`, [ids]),
      }
    }))

  // -------------------------------------------------------------------------
  app.get('/api/v1/teacher/labs', requires('lab:read:class'), async req =>
    req.db(async c => {
      const ids = await teacherClassIds(c, req.access.userId)
      if (!ids.length) return { submissions: [] }
      return {
        submissions: await c.query(`
          SELECT ls.id, ls.mode, ls.status, ls.auto_score, ls.score, ls.submitted_at, ls.file_name,
                 g.program_no, g.title, g.max_score, u.full_name AS student, sp.roll_no, sc.name AS class_name
            FROM lab_submission ls
            JOIN graded_lab g ON g.id = ls.graded_lab_id
            JOIN app_user u ON u.id = ls.user_id
            LEFT JOIN student_profile sp ON sp.user_id = u.id
            JOIN school_class sc ON sc.id = ls.class_id
           WHERE ls.class_id = ANY($1::uuid[])
           ORDER BY (ls.status = 'submitted') DESC, ls.submitted_at DESC
           LIMIT 100`, [ids]),
      }
    }))

  app.get('/api/v1/teacher/labs/:id', requires('lab:read:class'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const s = (await c.query<any>(`
        SELECT ls.*, g.program_no, g.title, g.brief, g.rubric, g.max_score,
               u.full_name AS student, sp.roll_no
          FROM lab_submission ls
          JOIN graded_lab g ON g.id = ls.graded_lab_id
          JOIN app_user u ON u.id = ls.user_id
          LEFT JOIN student_profile sp ON sp.user_id = u.id
         WHERE ls.id = $1`, [id]))[0]
      if (!s) throw notFound('No such submission.')
      await assertTeachesClass(c, req.access, s.class_id)
      return { submission: s }
    })
  })

  app.post('/api/v1/teacher/labs/:id/grade', requires('lab:grade'), async req => {
    const id = (req.params as any).id
    const b = (req.body ?? {}) as any
    return req.db(async c => {
      const s = (await c.query<any>(`
        SELECT ls.id, ls.class_id, ls.user_id, ls.status, ls.score, g.rubric, g.max_score, g.title,
               u.full_name AS student
          FROM lab_submission ls JOIN graded_lab g ON g.id = ls.graded_lab_id
          JOIN app_user u ON u.id = ls.user_id WHERE ls.id = $1`, [id]))[0]
      if (!s) throw notFound('No such submission.')
      await assertTeachesClass(c, req.access, s.class_id)

      if (b.action === 'revise') {
        await c.query(
          `UPDATE lab_submission SET status='revision', feedback=$1, graded_by=$2 WHERE id=$3`,
          [String(b.feedback ?? ''), req.access.userId, id])
        await req.log_audit(c, {
          action: 'submission.returned', entityType: 'lab_submission', entityId: id,
          summary: `Sent ${s.title} back to ${s.student} for revision`,
        })
        // A revision does not consume an attempt: the point is the student
        // fixing it, not the mark.
        return { ok: true, status: 'revision' }
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
        `UPDATE lab_submission
            SET status='graded', rubric_scores=$1, score=$2, feedback=$3, graded_by=$4, graded_at=now()
          WHERE id=$5`,
        [JSON.stringify(scores), total, String(b.feedback ?? ''), req.access.userId, id])
      await req.log_audit(c, {
        action: 'submission.graded', entityType: 'lab_submission', entityId: id,
        summary: `Graded ${s.title} for ${s.student}: ${total}/${s.max_score}`,
        before: { score: s.score }, after: { score: total, feedback: b.feedback },
      })
      return { ok: true, score: total }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/teacher/exams', requires('exam:read'), async req =>
    req.db(async c => {
      const ids = await teacherClassIds(c, req.access.userId)
      return {
        exams: ids.length ? await c.query(`
          SELECT e.id, e.title, e.starts_at, e.duration_minutes, e.status, sc.name AS class_name,
                 (SELECT count(*)::int FROM class_student cs WHERE cs.class_id=e.class_id AND cs.left_at IS NULL) AS enrolled,
                 (SELECT count(*)::int FROM exam_attempt a WHERE a.exam_id=e.id) AS sat,
                 (SELECT round(avg(a.total_score/nullif(a.max_score,0))*100)::int FROM exam_attempt a
                   WHERE a.exam_id=e.id AND a.total_score IS NOT NULL) AS avg_pct,
                 (SELECT round(max(a.total_score/nullif(a.max_score,0))*100)::int FROM exam_attempt a
                   WHERE a.exam_id=e.id AND a.total_score IS NOT NULL) AS high_pct,
                 (SELECT round(min(a.total_score/nullif(a.max_score,0))*100)::int FROM exam_attempt a
                   WHERE a.exam_id=e.id AND a.total_score IS NOT NULL) AS low_pct,
                 (SELECT count(*)::int FROM exam_answer ea
                    JOIN exam_attempt at2 ON at2.id=ea.attempt_id AND at2.exam_id=e.id
                    JOIN exam_question eq ON eq.id=ea.exam_question_id
                   WHERE eq.kind='written' AND ea.marks_awarded IS NULL) AS to_mark
            FROM exam e JOIN school_class sc ON sc.id=e.class_id
           WHERE e.class_id = ANY($1::uuid[]) ORDER BY e.starts_at DESC`, [ids]) : [],
        blueprints: await c.query(`
          SELECT bp.id, bp.title, bp.duration_minutes, bp.objective_marks, bp.written_marks, u.code AS unit,
                 (SELECT count(*)::int FROM exam_blueprint_question q WHERE q.blueprint_id = bp.id) AS questions
            FROM exam_blueprint bp JOIN unit u ON u.id = bp.unit_id
            JOIN tenant_entitlement e ON e.resource_type='course' AND e.resource_id=u.course_id AND e.status='active'
           ORDER BY u.position`),
        classes: await c.query(
          `SELECT sc.id, sc.name FROM class_teacher ct JOIN school_class sc ON sc.id=ct.class_id
            WHERE ct.user_id=$1 ORDER BY sc.name`, [req.access.userId]),
      }
    }))

  /**
   * Scheduling snapshots the paper out of the question bank. Editing the bank
   * afterwards therefore cannot change a paper students have already sat.
   */
  app.post('/api/v1/teacher/exams', requires('exam:schedule'), async req => {
    const b = (req.body ?? {}) as any
    if (!b.classId || !b.blueprintId || !b.startsAt) throw badRequest('Choose a class, a paper and a start time.')
    return req.db(async c => {
      await assertTeachesClass(c, req.access, b.classId)
      const bp = (await c.query<any>(
        `SELECT bp.id, bp.title, bp.duration_minutes FROM exam_blueprint bp WHERE bp.id = $1`, [b.blueprintId]))[0]
      if (!bp) throw notFound('No such paper.')
      if (new Date(b.startsAt).getTime() < Date.now() - 60_000) {
        throw badRequest('Choose a start time in the future — the paper unlocks by itself at that moment.')
      }

      const examId = randomUUID()
      await c.query(
        `INSERT INTO exam (id, tenant_id, class_id, blueprint_id, title, starts_at, duration_minutes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8)`,
        [examId, req.access.tenantId, b.classId, bp.id, b.title || bp.title, b.startsAt,
          Number(b.durationMinutes ?? bp.duration_minutes), req.access.userId])

      const bank = await c.query<any>(`
        SELECT q.id, q.kind, q.text, q.options, q.answer_index, q.marks
          FROM exam_blueprint_question bq JOIN question q ON q.id = bq.question_id
         WHERE bq.blueprint_id = $1 ORDER BY bq.position`, [bp.id])
      let position = 0
      for (const q of bank) {
        await c.query(
          `INSERT INTO exam_question (id, tenant_id, exam_id, question_id, position, kind, text, options, answer_index, marks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [randomUUID(), req.access.tenantId, examId, q.id, ++position, q.kind, q.text,
            JSON.stringify(q.options), q.answer_index, q.marks])
      }

      const n = Number((await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM class_student WHERE class_id=$1 AND left_at IS NULL', [b.classId]))[0].n)
      await req.log_audit(c, {
        action: 'exam.scheduled', entityType: 'exam', entityId: examId,
        summary: `Scheduled ${b.title || bp.title} for ${n} students`,
        after: { title: b.title || bp.title, starts_at: b.startsAt },
      })
      return { id: examId, questions: position, students: n }
    })
  })

  /** Only written answers reach a teacher; objectives were marked on submission. */
  app.get('/api/v1/teacher/exams/:id/marking', requires('exam:mark'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const exam = (await c.query<any>(
        `SELECT e.id, e.title, e.class_id, e.status, sc.name AS class_name
           FROM exam e JOIN school_class sc ON sc.id=e.class_id WHERE e.id=$1`, [id]))[0]
      if (!exam) throw notFound('No such exam.')
      await assertTeachesClass(c, req.access, exam.class_id)

      return {
        exam,
        stats: (await c.query<any>(`
          SELECT count(*)::int AS papers,
                 round(avg(a.objective_score))::int AS avg_objective,
                 (SELECT count(*)::int FROM exam_answer ea
                    JOIN exam_attempt at2 ON at2.id=ea.attempt_id AND at2.exam_id=$1
                    JOIN exam_question eq ON eq.id=ea.exam_question_id
                   WHERE eq.kind='written' AND ea.marks_awarded IS NULL) AS to_mark
            FROM exam_attempt a WHERE a.exam_id=$1`, [id]))[0],
        questions: await c.query(
          `SELECT id, position, text, marks FROM exam_question
            WHERE exam_id=$1 AND kind='written' ORDER BY position`, [id]),
        answers: await c.query(`
          SELECT ea.id, ea.text_answer, ea.marks_awarded, eq.id AS question_id, eq.text AS question,
                 eq.marks AS max_marks, u.full_name AS student, sp.roll_no
            FROM exam_answer ea
            JOIN exam_attempt a ON a.id = ea.attempt_id
            JOIN exam_question eq ON eq.id = ea.exam_question_id
            JOIN app_user u ON u.id = a.user_id
            LEFT JOIN student_profile sp ON sp.user_id = u.id
           WHERE a.exam_id = $1 AND eq.kind = 'written'
           ORDER BY eq.position, sp.roll_no`, [id]),
      }
    })
  })

  app.post('/api/v1/teacher/exams/:id/marks', requires('exam:mark'), async req => {
    const id = (req.params as any).id
    const marks: Array<{ answerId: string; marks: number }> = (req.body as any)?.marks ?? []
    if (!marks.length) throw badRequest('Nothing to save.')
    return req.db(async c => {
      const exam = (await c.query<any>('SELECT id, class_id, title FROM exam WHERE id=$1', [id]))[0]
      if (!exam) throw notFound('No such exam.')
      await assertTeachesClass(c, req.access, exam.class_id)

      for (const m of marks) {
        const a = (await c.query<any>(`
          SELECT ea.id, ea.marks_awarded, eq.marks AS max_marks
            FROM exam_answer ea JOIN exam_question eq ON eq.id = ea.exam_question_id
            JOIN exam_attempt at2 ON at2.id = ea.attempt_id
           WHERE ea.id = $1 AND at2.exam_id = $2`, [m.answerId, id]))[0]
        if (!a) continue
        const value = Number(m.marks)
        if (Number.isNaN(value) || value < 0 || value > a.max_marks) {
          throw badRequest(`Marks must be between 0 and ${a.max_marks}.`)
        }
        await c.query(
          `UPDATE exam_answer SET marks_awarded=$1, marked_by=$2, marked_at=now() WHERE id=$3`,
          [value, req.access.userId, m.answerId])
      }
      await c.query(`UPDATE exam SET status='marking' WHERE id=$1 AND status='scheduled'`, [id])
      return { ok: true, saved: marks.length }
    })
  })

  /**
   * Release is one deliberate action. Until it happens a student sees "being
   * marked" rather than a partial score that changes under them.
   */
  app.post('/api/v1/teacher/exams/:id/release', requires('exam:release'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const exam = (await c.query<any>('SELECT id, class_id, title, status FROM exam WHERE id=$1', [id]))[0]
      if (!exam) throw notFound('No such exam.')
      await assertTeachesClass(c, req.access, exam.class_id)

      const unmarked = Number((await c.query<{ n: string }>(`
        SELECT count(*)::text AS n FROM exam_answer ea
          JOIN exam_attempt a ON a.id = ea.attempt_id AND a.exam_id = $1
          JOIN exam_question eq ON eq.id = ea.exam_question_id
         WHERE eq.kind='written' AND ea.marks_awarded IS NULL`, [id]))[0].n)
      if (unmarked > 0) {
        throw conflict(`${unmarked} written answer${unmarked === 1 ? '' : 's'} still to mark. ` +
          `Results stay hidden until every paper is finished.`, 'unmarked_answers')
      }

      // Recompute totals from the answers, not from anything cached.
      await c.query(`
        UPDATE exam_attempt a SET
          objective_score = sub.objective,
          written_score   = sub.written,
          total_score     = sub.objective + sub.written,
          status          = 'marked'
        FROM (
          SELECT ea.attempt_id,
                 coalesce(sum(ea.marks_awarded) FILTER (WHERE eq.kind='objective'), 0) AS objective,
                 coalesce(sum(ea.marks_awarded) FILTER (WHERE eq.kind='written'), 0)   AS written
            FROM exam_answer ea JOIN exam_question eq ON eq.id = ea.exam_question_id
           GROUP BY ea.attempt_id
        ) sub
        WHERE sub.attempt_id = a.id AND a.exam_id = $1`, [id])

      await c.query(`UPDATE exam SET status='released', released_at=now() WHERE id=$1`, [id])
      const n = Number((await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM exam_attempt WHERE exam_id=$1', [id]))[0].n)
      await req.log_audit(c, {
        action: 'exam.results.released', entityType: 'exam', entityId: id,
        summary: `Released ${exam.title} to ${n} students`, before: { status: exam.status }, after: { status: 'released' },
      })
      return { ok: true, students: n }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/teacher/reports', requires('report:read:class'), async req =>
    req.db(async c => {
      const ids = await teacherClassIds(c, req.access.userId)
      if (!ids.length) return { exams: [], questionAnalysis: [], students: [] }
      return {
        summary: (await c.query<any>(`
          SELECT count(DISTINCT e.id)::int AS exams,
                 round(avg(a.total_score/nullif(a.max_score,0))*100)::int AS avg_pct
            FROM exam e LEFT JOIN exam_attempt a ON a.exam_id=e.id AND a.total_score IS NOT NULL
           WHERE e.class_id = ANY($1::uuid[])`, [ids]))[0],
        exams: await c.query(`
          SELECT e.id, e.title, e.starts_at, e.status, sc.name AS class_name,
                 (SELECT count(*)::int FROM exam_attempt a WHERE a.exam_id=e.id) AS sat,
                 (SELECT round(avg(a.total_score/nullif(a.max_score,0))*100)::int FROM exam_attempt a
                   WHERE a.exam_id=e.id AND a.total_score IS NOT NULL) AS avg_pct
            FROM exam e JOIN school_class sc ON sc.id=e.class_id
           WHERE e.class_id = ANY($1::uuid[]) ORDER BY e.starts_at DESC`, [ids]),
        // Which QUESTION the class failed, not just who failed the paper.
        questionAnalysis: await c.query(`
          SELECT eq.position, eq.text, eq.kind, e.title AS exam,
                 round(avg(CASE WHEN eq.kind='objective'
                                THEN CASE WHEN ea.is_correct THEN 100 ELSE 0 END
                                ELSE ea.marks_awarded / nullif(eq.marks,0) * 100 END))::int AS pct
            FROM exam_answer ea
            JOIN exam_question eq ON eq.id = ea.exam_question_id
            JOIN exam_attempt a ON a.id = ea.attempt_id
            JOIN exam e ON e.id = a.exam_id
           WHERE e.class_id = ANY($1::uuid[]) AND (ea.is_correct IS NOT NULL OR ea.marks_awarded IS NOT NULL)
           GROUP BY eq.position, eq.text, eq.kind, e.title
           ORDER BY pct ASC LIMIT 12`, [ids]),
        students: await c.query(`
          SELECT u.full_name, sp.roll_no,
                 round(avg(a.objective_score))::int AS objective,
                 round(avg(a.written_score))::int AS written,
                 round(avg(a.total_score/nullif(a.max_score,0))*100)::int AS pct
            FROM exam_attempt a
            JOIN exam e ON e.id = a.exam_id
            JOIN app_user u ON u.id = a.user_id
            LEFT JOIN student_profile sp ON sp.user_id = u.id
           WHERE e.class_id = ANY($1::uuid[]) AND a.total_score IS NOT NULL
           GROUP BY u.full_name, sp.roll_no ORDER BY pct DESC`, [ids]),
      }
    }))

  // -------------------------------------------------------------------------
  app.get('/api/v1/teacher/materials/:id', requires('material:create'), async req => {
    const id = (req.params as any).id
    return req.db(async c => {
      const m = (await c.query<any>(
        'SELECT * FROM teacher_material WHERE id = $1 AND created_by = $2', [id, req.access.userId]))[0]
      if (!m) throw notFound('No such material.')
      return { material: m }
    })
  })

  app.post('/api/v1/teacher/materials', requires('material:create'), async req => {
    const b = (req.body ?? {}) as any
    const title = String(b.title ?? '').trim()
    if (!title) throw badRequest('Give your material a title.')
    const blocks = Array.isArray(b.body) ? b.body : []

    return req.db(async c => {
      const id = b.id ?? randomUUID()
      const existing = b.id
        ? (await c.query<any>('SELECT id FROM teacher_material WHERE id=$1 AND created_by=$2', [b.id, req.access.userId]))[0]
        : null
      if (b.id && !existing) throw notFound('No such material.')

      const status = b.share ? 'shared' : 'draft'
      if (existing) {
        await c.query(
          `UPDATE teacher_material SET title=$1, kind=$2, body=$3, status=$4, unit_id=$5, updated_at=now()
            WHERE id=$6`,
          [title, b.kind ?? 'Notes', JSON.stringify(blocks), status, b.unitId ?? null, id])
      } else {
        await c.query(
          `INSERT INTO teacher_material (id, tenant_id, created_by, unit_id, title, kind, body, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, req.access.tenantId, req.access.userId, b.unitId ?? null, title,
            b.kind ?? 'Notes', JSON.stringify(blocks), status])
      }

      await c.query('DELETE FROM teacher_material_class WHERE material_id = $1', [id])
      for (const classId of (Array.isArray(b.classIds) ? b.classIds : [])) {
        await assertTeachesClass(c, req.access, classId)
        await c.query(
          'INSERT INTO teacher_material_class (tenant_id, material_id, class_id) VALUES ($1,$2,$3)',
          [req.access.tenantId, id, classId])
      }

      await req.log_audit(c, {
        action: existing ? 'material.updated' : 'material.created',
        entityType: 'teacher_material', entityId: id,
        summary: `${status === 'shared' ? 'Shared' : 'Saved a draft of'} "${title}"`, after: { title, status },
      })
      // Teacher material never syncs upward: the Content Hub feed is one-way,
      // and there is no code path here that writes to it.
      return { id, status }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/teacher/curriculum', requires('curriculum:plan'), async req =>
    req.db(async c => ({
      plans: await c.query(`
        SELECT p.id, p.name, p.term, p.weeks, sc.name AS class_name, sc.id AS class_id
          FROM curriculum_plan p JOIN school_class sc ON sc.id = p.class_id
         WHERE p.created_by = $1 ORDER BY p.created_at DESC`, [req.access.userId]),
      items: await c.query(`
        SELECT ci.id, ci.plan_id, ci.position, ci.origin, ci.resource_type, ci.label
          FROM curriculum_item ci
          JOIN curriculum_plan p ON p.id = ci.plan_id AND p.created_by = $1
         ORDER BY ci.position`, [req.access.userId]),
    })))

  app.post('/api/v1/teacher/curriculum', requires('curriculum:plan'), async req => {
    const b = (req.body ?? {}) as any
    if (!b.classId || !b.name) throw badRequest('A plan needs a class and a name.')
    return req.db(async c => {
      await assertTeachesClass(c, req.access, b.classId)
      const id = b.id ?? randomUUID()
      const items: Array<any> = Array.isArray(b.items) ? b.items : []
      if (b.id) {
        await c.query('UPDATE curriculum_plan SET name=$1, term=$2, weeks=$3 WHERE id=$4 AND created_by=$5',
          [b.name, b.term ?? 'Term 1', Number(b.weeks ?? 12), id, req.access.userId])
        await c.query('DELETE FROM curriculum_item WHERE plan_id = $1', [id])
      } else {
        await c.query(
          `INSERT INTO curriculum_plan (id, tenant_id, class_id, created_by, name, term, weeks)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, req.access.tenantId, b.classId, req.access.userId, b.name, b.term ?? 'Term 1', Number(b.weeks ?? 12)])
      }
      let position = 0
      for (const it of items) {
        await c.query(
          `INSERT INTO curriculum_item (id, tenant_id, plan_id, position, origin, resource_type, resource_id, label)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), req.access.tenantId, id, ++position,
            it.origin ?? 'brolly', it.resourceType, it.resourceId, String(it.label ?? '')])
      }
      await req.log_audit(c, {
        action: 'curriculum.saved', entityType: 'curriculum_plan', entityId: id,
        summary: `Saved teaching order "${b.name}" (${position} items)`,
      })
      return { id, items: position }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/teacher/announcements', requires('announcement:create'), async req =>
    req.db(async c => {
      const ids = await teacherClassIds(c, req.access.userId)
      return {
        announcements: ids.length ? await c.query(`
          SELECT a.id, a.body, a.created_at, sc.name AS class_name,
                 (SELECT count(*)::int FROM class_student cs WHERE cs.class_id=a.class_id AND cs.left_at IS NULL) AS students
            FROM announcement a JOIN school_class sc ON sc.id=a.class_id
           WHERE a.class_id = ANY($1::uuid[]) ORDER BY a.created_at DESC LIMIT 30`, [ids]) : [],
      }
    }))

  app.post('/api/v1/teacher/announcements', requires('announcement:create'), async req => {
    const b = (req.body ?? {}) as any
    const body = String(b.body ?? '').trim()
    if (!body) throw badRequest('Write something to post.')
    if (body.length > 2000) throw badRequest('Keep it under 2000 characters.')
    const classIds: string[] = Array.isArray(b.classIds) ? b.classIds : (b.classId ? [b.classId] : [])
    if (!classIds.length) throw badRequest('Choose at least one class.')

    return req.db(async c => {
      let students = 0
      for (const classId of classIds) {
        await assertTeachesClass(c, req.access, classId)
        await c.query(
          `INSERT INTO announcement (id, tenant_id, class_id, created_by, body) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), req.access.tenantId, classId, req.access.userId, body])
        students += Number((await c.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM class_student WHERE class_id=$1 AND left_at IS NULL', [classId]))[0].n)
      }
      // One-way, class-wide, and visible to any parent using the student login.
      // There is deliberately no private teacher-to-student channel.
      await req.log_audit(c, {
        action: 'announcement.posted', entityType: 'announcement',
        summary: `Posted to ${students} students`,
      })
      return { ok: true, students }
    })
  })
}
