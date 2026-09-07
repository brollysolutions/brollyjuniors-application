/**
 * Entitlement, proved at the database.
 *
 * These tests talk to Postgres directly, with no application code in the way,
 * so they prove the rule that survives a coding mistake: a course id is not a
 * key. If somebody adds an endpoint next year and forgets assertCanReach(), the
 * query still comes back empty.
 *
 * The META tests at the end fail when a new table is added without row-level
 * security, which is how this class of bug actually gets in.
 *
 *   npm test
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withAdmin, withActor, withAnon, closeDb, type Conn } from '@brolly/b2c-db'

type Ctx = {
  pythonId: string; aiId: string
  bothCourses: string       // student enrolled in both
  aiOnly: string            // student enrolled in AI only
  pythonTeacher: string     // teaches Python, not AI
  aiTeacher: string         // teaches AI, not Python
  admin: string
  pythonLesson: string; pythonRecording: string; pythonMaterial: string
  pythonQuiz: string; pythonExercise: string; pythonSection: string
}
let ctx: Ctx

before(async () => {
  ctx = await withAdmin(async c => {
    const one = async <T>(sql: string, p: any[] = []): Promise<T> => {
      const rows = await c.query<any>(sql, p)
      assert.ok(rows.length, `seed the database first (npm run db:reset) — no rows for: ${sql.slice(0, 60)}`)
      return rows[0]
    }
    const python = await one<any>(`SELECT id FROM course WHERE slug = 'python-foundations'`)
    const ai = await one<any>(`SELECT id FROM course WHERE slug = 'ai-for-beginners'`)

    const bothCourses = await one<any>(`
      SELECT e.user_id FROM enrollment e WHERE e.course_id = $1
        AND EXISTS (SELECT 1 FROM enrollment e2 WHERE e2.user_id = e.user_id AND e2.course_id = $2)
      LIMIT 1`, [python.id, ai.id])
    const aiOnly = await one<any>(`
      SELECT e.user_id FROM enrollment e WHERE e.course_id = $1
        AND NOT EXISTS (SELECT 1 FROM enrollment e2 WHERE e2.user_id = e.user_id AND e2.course_id = $2)
      LIMIT 1`, [ai.id, python.id])

    const pythonTeacher = await one<any>(`
      SELECT ct.user_id FROM course_teacher ct WHERE ct.course_id = $1
        AND NOT EXISTS (SELECT 1 FROM course_teacher c2 WHERE c2.user_id = ct.user_id AND c2.course_id = $2)
      LIMIT 1`, [python.id, ai.id])
    const aiTeacher = await one<any>(`
      SELECT ct.user_id FROM course_teacher ct WHERE ct.course_id = $1
        AND NOT EXISTS (SELECT 1 FROM course_teacher c2 WHERE c2.user_id = ct.user_id AND c2.course_id = $2)
      LIMIT 1`, [ai.id, python.id])

    const admin = await one<any>(`
      SELECT u.id FROM app_user u JOIN user_role ur ON ur.user_id = u.id
        JOIN role r ON r.id = ur.role_id AND r.key = 'BROLLY_ADMIN' LIMIT 1`)

    const lesson = await one<any>(`
      SELECT l.id FROM lesson l JOIN module m ON m.id = l.module_id WHERE m.course_id = $1 LIMIT 1`, [python.id])
    const rec = await one<any>(`SELECT id FROM recording WHERE course_id = $1 LIMIT 1`, [python.id])
    const mat = await one<any>(`SELECT id FROM learning_material WHERE course_id = $1 LIMIT 1`, [python.id])
    const quiz = await one<any>(`SELECT id FROM quiz WHERE course_id = $1 LIMIT 1`, [python.id])
    const ex = await one<any>(`
      SELECT e.id FROM exercise e JOIN lesson l ON l.id = e.lesson_id
        JOIN module m ON m.id = l.module_id WHERE m.course_id = $1 LIMIT 1`, [python.id])
    const sec = await one<any>(`
      SELECT s.id FROM section s JOIN chapter ch ON ch.id = s.chapter_id
        JOIN textbook t ON t.id = ch.textbook_id WHERE t.course_id = $1 LIMIT 1`, [python.id])

    return {
      pythonId: python.id, aiId: ai.id,
      bothCourses: bothCourses.user_id, aiOnly: aiOnly.user_id,
      pythonTeacher: pythonTeacher.user_id, aiTeacher: aiTeacher.user_id, admin: admin.id,
      pythonLesson: lesson.id, pythonRecording: rec.id, pythonMaterial: mat.id,
      pythonQuiz: quiz.id, pythonExercise: ex.id, pythonSection: sec.id,
    }
  })
})

after(async () => { await closeDb() })

const asStudent = <T>(id: string, fn: (c: Conn) => Promise<T>) => withActor(id, 'STUDENT', fn)
const asTeacher = <T>(id: string, fn: (c: Conn) => Promise<T>) => withActor(id, 'TEACHER', fn)
const asAdmin = <T>(id: string, fn: (c: Conn) => Promise<T>) => withActor(id, 'BROLLY_ADMIN', fn)
const count = async (c: Conn, sql: string, p: any[] = []) =>
  Number((await c.query<{ n: string }>(sql, p))[0].n)

// ---------------------------------------------------------------------------

describe('Structure is public — people must be able to shop', () => {
  test('a stranger can read published courses', async () => {
    const n = await withAnon(c => count(c, `SELECT count(*)::text AS n FROM course WHERE status='published'`))
    assert.ok(n >= 2, 'the catalogue should be readable with no account')
  })

  test('a stranger can read module and lesson titles', async () => {
    const modules = await withAnon(c => count(c, 'SELECT count(*)::text AS n FROM module'))
    const lessons = await withAnon(c => count(c, 'SELECT count(*)::text AS n FROM lesson'))
    assert.ok(modules > 0 && lessons > 0, 'the curriculum outline is part of the sales page')
  })

  test('a stranger can read who teaches a course', async () => {
    const n = await withAnon(c => count(c, 'SELECT count(*)::text AS n FROM course_teacher'))
    assert.ok(n > 0)
  })
})

describe('Substance is entitled — a course id is not a key', () => {
  test('a stranger cannot read a single lesson body', async () => {
    const n = await withAnon(c => count(c, `SELECT count(*)::text AS n FROM content_version`))
    assert.equal(n, 0, 'anonymous visitors could read published lesson bodies')
  })

  // Each entry brings its own parameters: Postgres rejects a bind with more
  // parameters than the statement declares.
  const protectedReads = () => [
    ['lesson bodies', `SELECT count(*)::text AS n FROM content_version cv
       JOIN content_item ci ON ci.id = cv.content_item_id WHERE ci.course_id = $1`, [ctx.pythonId] as any[]],
    ['textbooks', 'SELECT count(*)::text AS n FROM textbook WHERE course_id = $1', [ctx.pythonId]],
    ['textbook sections', 'SELECT count(*)::text AS n FROM section WHERE id = $1', [ctx.pythonSection]],
    ['recordings', 'SELECT count(*)::text AS n FROM recording WHERE course_id = $1', [ctx.pythonId]],
    ['learning materials', 'SELECT count(*)::text AS n FROM learning_material WHERE course_id = $1', [ctx.pythonId]],
    ['exercises', 'SELECT count(*)::text AS n FROM exercise WHERE id = $1', [ctx.pythonExercise]],
    ['quizzes', 'SELECT count(*)::text AS n FROM quiz WHERE course_id = $1', [ctx.pythonId]],
    ['quiz questions', 'SELECT count(*)::text AS n FROM question q JOIN quiz z ON z.id = q.quiz_id WHERE z.course_id = $1', [ctx.pythonId]],
  ] as Array<[string, string, any[]]>

  test('a student without the course sees none of the protected content', async () => {
    for (const [label, sql, params] of protectedReads()) {
      const real = await withAdmin(c => count(c, sql, params))
      assert.ok(real > 0, `no seed rows for ${label}, so this test proves nothing`)
      const seen = await asStudent(ctx.aiOnly, c => count(c, sql, params))
      assert.equal(seen, 0, `an unenrolled student could read ${label}`)
    }
  })

  test('a teacher of a different course sees none of it either', async () => {
    for (const [label, sql, params] of protectedReads()) {
      const seen = await asTeacher(ctx.aiTeacher, c => count(c, sql, params))
      assert.equal(seen, 0, `a teacher who does not teach this course could read ${label}`)
    }
  })

  test('the enrolled student CAN read all of it', async () => {
    const seen = await asStudent(ctx.bothCourses, async c => ({
      recordings: await count(c, 'SELECT count(*)::text AS n FROM recording WHERE course_id = $1', [ctx.pythonId]),
      materials: await count(c, 'SELECT count(*)::text AS n FROM learning_material WHERE course_id = $1', [ctx.pythonId]),
      sections: await count(c, 'SELECT count(*)::text AS n FROM section WHERE id = $1', [ctx.pythonSection]),
      bodies: await count(c, `SELECT count(*)::text AS n FROM content_version cv
        JOIN content_item ci ON ci.id = cv.content_item_id WHERE ci.course_id = $1`, [ctx.pythonId]),
    }))
    assert.ok(seen.recordings > 0 && seen.materials > 0 && seen.sections > 0 && seen.bodies > 0,
      'an enrolled student must be able to read what they paid for')
  })

  test('a cancelled enrolment stops access immediately', async () => {
    const [courseId, userId] = [ctx.aiId, ctx.aiOnly]
    const before = await asStudent(userId, c =>
      count(c, 'SELECT count(*)::text AS n FROM recording WHERE course_id = $1', [courseId]))
    assert.ok(before > 0)
    await withAdmin(c => c.query(
      `UPDATE enrollment SET status='cancelled' WHERE user_id=$1 AND course_id=$2`, [userId, courseId]))
    try {
      const after = await asStudent(userId, c =>
        count(c, 'SELECT count(*)::text AS n FROM recording WHERE course_id = $1', [courseId]))
      assert.equal(after, 0, 'a cancelled enrolment still granted access')
    } finally {
      await withAdmin(c => c.query(
        `UPDATE enrollment SET status='active' WHERE user_id=$1 AND course_id=$2`, [userId, courseId]))
    }
  })

  test('an expired enrolment stops access', async () => {
    const [courseId, userId] = [ctx.aiId, ctx.aiOnly]
    await withAdmin(c => c.query(
      `UPDATE enrollment SET expires_on = current_date - 1 WHERE user_id=$1 AND course_id=$2`,
      [userId, courseId]))
    try {
      const after = await asStudent(userId, c =>
        count(c, 'SELECT count(*)::text AS n FROM recording WHERE course_id = $1', [courseId]))
      assert.equal(after, 0, 'an expired enrolment still granted access')
    } finally {
      await withAdmin(c => c.query(
        `UPDATE enrollment SET expires_on = NULL WHERE user_id=$1 AND course_id=$2`, [userId, courseId]))
    }
  })
})

describe('A student’s work is their own', () => {
  test('one student cannot read another’s progress', async () => {
    const mine = await asStudent(ctx.bothCourses, c =>
      c.query('SELECT user_id FROM progress LIMIT 50'))
    assert.ok(mine.length > 0)
    assert.ok(mine.every((r: any) => r.user_id === ctx.bothCourses),
      'a student saw progress belonging to someone else')
  })

  for (const table of ['submission', 'quiz_attempt', 'exercise_attempt', 'course_order', 'certificate', 'notification']) {
    test(`one student cannot read another’s ${table}`, async () => {
      const rows = await asStudent(ctx.bothCourses, c =>
        c.query(`SELECT user_id FROM ${table} LIMIT 50`))
      assert.ok(rows.every((r: any) => r.user_id === ctx.bothCourses),
        `a student saw a ${table} row belonging to someone else`)
    })
  }

  test('a student cannot write a row for somebody else', async () => {
    await assert.rejects(
      () => asStudent(ctx.bothCourses, c => c.query(
        `INSERT INTO progress (id, user_id, course_id, node_type, node_id, status)
         VALUES ($1,$2,$3,'lesson',$4,'completed')`,
        [randomUUID(), ctx.aiOnly, ctx.pythonId, ctx.pythonLesson])),
      /row-level security/i,
      'a student was able to write progress onto another student’s account')
  })

  test('nothing can insert a notification directly — notify() is the only door', async () => {
    await assert.rejects(
      () => asTeacher(ctx.pythonTeacher, c => c.query(
        `INSERT INTO notification (user_id, kind, title) VALUES ($1,'spam','Buy my thing')`,
        [ctx.bothCourses])),
      /row-level security|policy/i,
      'a teacher could plant a notification directly in a student’s feed')
  })

  test('notify() works for a legitimate cross-user message', async () => {
    const id = await asTeacher(ctx.pythonTeacher, async c => {
      const r = await c.query<{ notify: string }>(
        `SELECT notify($1,'grade','Test message','body','assignments','') AS notify`, [ctx.bothCourses])
      return r[0].notify
    })
    assert.ok(id, 'notify() should return the new notification id')
    await withAdmin(c => c.query('DELETE FROM notification WHERE id = $1', [id]))
  })
})

describe('Teachers reach students only through a course', () => {
  test('a teacher sees the students on their own course', async () => {
    const n = await asTeacher(ctx.pythonTeacher, c =>
      count(c, `SELECT count(*)::text AS n FROM enrollment WHERE course_id = $1`, [ctx.pythonId]))
    assert.ok(n > 0, 'a teacher must see who is on their course')
  })

  test('a teacher sees nothing on a course they do not teach', async () => {
    const n = await asTeacher(ctx.pythonTeacher, c =>
      count(c, `SELECT count(*)::text AS n FROM enrollment WHERE course_id = $1`, [ctx.aiId]))
    assert.equal(n, 0, 'a teacher saw enrolments for a course they do not teach')
  })

  test('a teacher cannot read a student’s personal record', async () => {
    // student_profile holds date of birth and guardian contact. There is no
    // policy admitting a teacher, so this is empty rather than filtered.
    const n = await asTeacher(ctx.pythonTeacher, c =>
      count(c, 'SELECT count(*)::text AS n FROM student_profile'))
    const real = await withAdmin(c => count(c, 'SELECT count(*)::text AS n FROM student_profile'))
    assert.ok(real > 0)
    assert.equal(n, 0, 'a teacher could read student profiles')
  })

  test('a teacher cannot read a student’s practice attempts', async () => {
    const n = await asTeacher(ctx.pythonTeacher, c =>
      count(c, 'SELECT count(*)::text AS n FROM exercise_attempt'))
    assert.equal(n, 0, 'practice is not anybody else’s business, including the teacher’s')
  })

  test('a teacher cannot read orders or revenue', async () => {
    const n = await asTeacher(ctx.pythonTeacher, c =>
      count(c, 'SELECT count(*)::text AS n FROM course_order'))
    assert.equal(n, 0)
  })

  test('a teacher cannot edit the catalogue', async () => {
    const changed = await asTeacher(ctx.pythonTeacher, async c => {
      await c.query(`UPDATE course SET price_minor = 1 WHERE id = $1`, [ctx.pythonId])
      return count(c, 'SELECT count(*)::text AS n FROM course WHERE price_minor = 1')
    })
    assert.equal(changed, 0, 'a teacher was able to change course pricing')
  })
})

describe('Drafts belong to the Content Hub alone', () => {
  test('an unpublished version is invisible to students and teachers', async () => {
    const itemId = await withAdmin(async c => {
      const item = (await c.query<any>(
        `SELECT id FROM content_item WHERE course_id = $1 LIMIT 1`, [ctx.pythonId]))[0]
      await c.query(
        `INSERT INTO content_version (id, content_item_id, version_no, locale, status, body)
         VALUES ($1,$2,99,'en','draft','[{"type":"paragraph","text":"secret draft"}]'::jsonb)`,
        [randomUUID(), item.id])
      return item.id
    })
    try {
      const student = await asStudent(ctx.bothCourses, c =>
        count(c, `SELECT count(*)::text AS n FROM content_version WHERE status <> 'published'`))
      const teacher = await asTeacher(ctx.pythonTeacher, c =>
        count(c, `SELECT count(*)::text AS n FROM content_version WHERE status <> 'published'`))
      const admin = await asAdmin(ctx.admin, c =>
        count(c, `SELECT count(*)::text AS n FROM content_version WHERE status = 'draft'`))
      assert.equal(student, 0, 'a student could read an unpublished draft')
      assert.equal(teacher, 0, 'a teacher could read an unpublished draft')
      assert.ok(admin > 0, 'Brolly Admin must be able to see their own drafts')
    } finally {
      await withAdmin(c => c.query(
        `DELETE FROM content_version WHERE content_item_id = $1 AND version_no = 99`, [itemId]))
    }
  })

  test('only one version of an item can be published at a time', async () => {
    // The partial unique index is what makes "the current version" a database
    // fact rather than an application promise.
    await assert.rejects(
      () => withAdmin(async c => {
        const published = (await c.query<any>(
          `SELECT content_item_id FROM content_version WHERE status='published' LIMIT 1`))[0]
        await c.query(
          `INSERT INTO content_version (id, content_item_id, version_no, locale, status, body)
           VALUES ($1,$2,98,'en','published','[]'::jsonb)`,
          [randomUUID(), published.content_item_id])
      }),
      /duplicate key|unique/i,
      'two published versions of the same item were allowed')
  })
})

describe('Meta — the schema itself', () => {
  test('every table has row-level security enabled and forced', async () => {
    const offenders = await withAdmin(c => c.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND c.relname <> 'schema_migration'
         AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)`))
    assert.deepEqual(offenders.map(o => o.relname), [],
      'these tables are missing ENABLE / FORCE ROW LEVEL SECURITY')
  })

  test('every table has at least one policy', async () => {
    const offenders = await withAdmin(c => c.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND c.relname <> 'schema_migration'
         AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`))
    assert.deepEqual(offenders.map(o => o.relname), [], 'these tables have RLS on but no policy')
  })

  test('the application role is not a superuser and cannot bypass RLS', async () => {
    const role = await withAdmin(c => c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'brolly_app'`))
    assert.equal(role.length, 1, 'the brolly_app role is missing')
    assert.equal(role[0].rolsuper, false)
    assert.equal(role[0].rolbypassrls, false)
  })

  test('only the four intended functions bypass row-level security', async () => {
    // SECURITY DEFINER is the one way round RLS, so the list of functions that
    // use it is a list worth keeping short and reviewing.
    const definers = await withAdmin(c => c.query<{ proname: string }>(`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef = true ORDER BY p.proname`))
    assert.deepEqual(definers.map(d => d.proname).sort(),
      ['notify', 'public_completion_count', 'public_course_contents', 'public_learner_count',
        'public_verify_certificate'],
      'a new SECURITY DEFINER function appeared — it bypasses RLS, so review it deliberately')
  })

  test('nobody is signed in by default', async () => {
    // Deny by default: with no app.user_id set, ownership comparisons are NULL,
    // and NULL is not true.
    const n = await withAnon(c => count(c, 'SELECT count(*)::text AS n FROM progress'))
    assert.equal(n, 0)
  })
})
