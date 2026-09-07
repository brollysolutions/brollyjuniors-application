/**
 * Seed: the Brolly Juniors catalogue, four teachers, 180 students, and enough
 * real activity that every dashboard number is computed rather than written down.
 *
 * Demo passwords are uniform so the seed runs in seconds rather than minutes.
 * In production every password gets its own salt — that is what hashPassword()
 * does on each call.
 */

import { randomUUID, createHash } from 'node:crypto'
import { withAdmin, closeDb, driverName, type Conn } from './client.ts'
import { hashPassword } from './password.ts'
import { COURSES, type CourseSpec } from './seed-courses.ts'
import { PERMISSIONS, ROLES } from '@brolly/b2c-shared'

const DEMO_PW = 'brolly'
const STUDENT_PW = 'learn'

let _s = 20260906
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
const chance = (pct: number) => rnd() * 100 < pct

const FIRST = ['Aarav', 'Divya', 'Karthik', 'Sana', 'Rahul', 'Meghana', 'Ishaan', 'Ananya', 'Vikram', 'Priya',
  'Rohan', 'Nisha', 'Arjun', 'Aditya', 'Kavya', 'Manish', 'Pooja', 'Siddharth', 'Lakshmi', 'Tanvi',
  'Harsha', 'Neha', 'Varun', 'Shreya', 'Nikhil', 'Deepa', 'Sanjay', 'Ritu', 'Akhil', 'Bhavya',
  'Farhan', 'Gayatri', 'Imran', 'Jyoti', 'Kiran', 'Madhu', 'Naveen', 'Ojas', 'Riya', 'Zoya']
const LAST = ['Reddy', 'Rao', 'Sharma', 'Fatima', 'Verma', 'Prasad', 'Kumar', 'Nair', 'Iyer', 'Gupta',
  'Menon', 'Chowdary', 'Naidu', 'Joshi', 'Patel', 'Das', 'Bose', 'Shetty', 'Pillai', 'Varma']

const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString()
const daysAhead = (d: number) => new Date(Date.now() + d * 864e5).toISOString()
const hash = (s: string) => createHash('sha256').update(s).digest('hex')

async function insertMany(c: Conn, table: string, cols: string[], rows: any[][], chunk = 140) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const params: any[] = []
    const tuples = slice.map(r => `(${r.map(v => { params.push(v); return `$${params.length}` }).join(',')})`)
    await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, params)
  }
}

async function seed(c: Conn) {
  const staffHash = await hashPassword(DEMO_PW)
  const studentHash = await hashPassword(STUDENT_PW)

  // ===========================================================================
  // 1. Roles and permissions
  // ===========================================================================
  await insertMany(c, 'permission', ['key', 'description', 'feature_key'],
    PERMISSIONS.map(p => [p.key, p.description, p.feature ?? null]))

  const roleIds: Record<string, string> = {}
  for (const [key, def] of Object.entries(ROLES)) {
    const id = randomUUID(); roleIds[key] = id
    await c.query('INSERT INTO role (id, key, name, level) VALUES ($1,$2,$3,$4)', [id, key, def.name, def.level])
    await insertMany(c, 'role_permission', ['role_id', 'permission_key'], def.permissions.map(p => [id, p]))
  }
  console.log(`  roles ${Object.keys(roleIds).length} · permissions ${PERMISSIONS.length}`)

  // ===========================================================================
  // 2. People — three roles, no school anywhere
  // ===========================================================================
  const mkUser = async (email: string, name: string, role: string, pw: string, opts: any = {}) => {
    const id = randomUUID()
    await c.query(
      `INSERT INTO app_user (id, email, password_hash, full_name, phone, status, email_verified, last_login_at)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`,
      [id, email, pw, name, opts.phone ?? '+91 98••• •••••', true, opts.lastLogin ?? daysAgo(int(0, 3))])
    await c.query('INSERT INTO user_role (user_id, role_id) VALUES ($1,$2)', [id, roleIds[role]])
    return id
  }

  const adminId = await mkUser('admin@brollyjuniors.com', 'Brolly Admin', 'BROLLY_ADMIN', staffHash, { lastLogin: daysAgo(0) })

  const TEACHERS = [
    { email: 'sneha.reddy@brollyjuniors.com', name: 'Sneha Reddy', headline: 'Python & AI educator',
      bio: 'Ten years teaching programming to teenagers. Believes nobody learns to code by watching someone else code.',
      expertise: ['Python', 'Data literacy'], years: 10 },
    { email: 'ramesh.kumar@brollyjuniors.com', name: 'Ramesh Kumar', headline: 'Software engineer turned teacher',
      bio: 'Built payment systems for eight years, then discovered he preferred explaining them.',
      expertise: ['Python', 'Web basics'], years: 8 },
    { email: 'anita.menon@brollyjuniors.com', name: 'Anita Menon', headline: 'AI and data science',
      bio: 'Research background in machine learning; teaches AI without the arm-waving.',
      expertise: ['Artificial Intelligence', 'Statistics'], years: 6 },
    { email: 'vikram.joshi@brollyjuniors.com', name: 'Vikram Joshi', headline: 'Live class specialist',
      bio: 'Runs the evening live sessions. Known for answering the question a student was too shy to ask.',
      expertise: ['Python', 'Artificial Intelligence'], years: 5 },
  ]
  const teacherIds: Record<string, string> = {}
  for (const t of TEACHERS) {
    const id = await mkUser(t.email, t.name, 'TEACHER', staffHash)
    teacherIds[t.name] = id
    await c.query(
      `INSERT INTO teacher_profile (user_id, headline, bio, expertise, years_exp) VALUES ($1,$2,$3,$4,$5)`,
      [id, t.headline, t.bio, t.expertise, t.years])
  }
  console.log(`  1 admin · ${TEACHERS.length} teachers`)

  // ===========================================================================
  // 3. Catalogue
  // ===========================================================================
  const subjectIds: Record<string, string> = {}
  for (const [key, name, blurb] of [
    ['python', 'Python', 'The language most people should learn first.'],
    ['ai', 'Artificial Intelligence', 'How machines learn from data, and where that goes wrong.'],
  ]) {
    const id = randomUUID(); subjectIds[key] = id
    await c.query('INSERT INTO subject (id, key, name, blurb) VALUES ($1,$2,$3,$4)', [id, key, name, blurb])
  }

  type Built = {
    spec: CourseSpec; courseId: string
    moduleIds: string[]; lessonIds: string[]; exerciseIds: string[]
    quizIds: string[]; recordingIds: string[]; materialIds: string[]
  }
  const built: Built[] = []

  for (const spec of COURSES) {
    const courseId = randomUUID()
    await c.query(
      `INSERT INTO course (id, subject_id, slug, title, subtitle, description, outcomes, requirements,
                           level, age_range, duration_hours, price_minor, status, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'published',$13)`,
      [courseId, subjectIds[spec.subject], spec.slug, spec.title, spec.subtitle, spec.description,
        JSON.stringify(spec.outcomes), JSON.stringify(spec.requirements), spec.level, spec.ageRange,
        spec.durationHours, spec.priceMinor, daysAgo(90)])

    // A course has one or more teachers. This join is the whole of the
    // student/teacher relationship, one hop removed.
    const teachers = spec.subject === 'python'
      ? ['Sneha Reddy', 'Ramesh Kumar', 'Vikram Joshi']
      : ['Anita Menon', 'Vikram Joshi']
    await insertMany(c, 'course_teacher', ['course_id', 'user_id', 'role'],
      teachers.map((n, i) => [courseId, teacherIds[n], i === 0 ? 'lead' : 'assistant']))

    const moduleIds: string[] = [], lessonIds: string[] = [], exerciseIds: string[] = []
    const contentItems: any[][] = [], contentVersions: any[][] = []

    for (const [mi, m] of spec.modules.entries()) {
      const moduleId = randomUUID(); moduleIds.push(moduleId)
      await c.query('INSERT INTO module (id, course_id, position, title, summary) VALUES ($1,$2,$3,$4,$5)',
        [moduleId, courseId, mi + 1, m.title, m.summary])

      for (const [li, l] of m.lessons.entries()) {
        const itemId = randomUUID()
        const body = JSON.stringify(l.body)
        contentItems.push([itemId, `lesson:${spec.slug}:${mi}:${li}`, 'lesson', l.title, courseId])
        contentVersions.push([randomUUID(), itemId, 1, 'en', 'published', body, hash(body),
          'First published edition', adminId, daysAgo(90)])

        const lessonId = randomUUID(); lessonIds.push(lessonId)
        await c.query(
          'INSERT INTO lesson (id, module_id, position, title, est_minutes, content_item_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [lessonId, moduleId, li + 1, l.title, l.minutes, itemId])

        for (const [ei, ex] of (l.exercises ?? []).entries()) {
          const exId = randomUUID(); exerciseIds.push(exId)
          await c.query(
            `INSERT INTO exercise (id, lesson_id, position, title, level, brief, starter_code, hints, solution, test_cases)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [exId, lessonId, ei, ex.title, ex.level, ex.brief, ex.starter,
              JSON.stringify(ex.hints), ex.solution, JSON.stringify(ex.tests)])
        }
      }
    }

    // Lesson bodies land before anything references them.
    await insertMany(c, 'content_item', ['id', 'key', 'content_type', 'title', 'course_id'], contentItems)
    await insertMany(c, 'content_version',
      ['id', 'content_item_id', 'version_no', 'locale', 'status', 'body', 'body_hash', 'changelog', 'created_by', 'published_at'],
      contentVersions)
    contentItems.length = 0
    contentVersions.length = 0

    // --- textbook ----------------------------------------------------------
    const textbookId = randomUUID()
    await c.query('INSERT INTO textbook (id, course_id, slug, title, edition) VALUES ($1,$2,$3,$4,$5)',
      [textbookId, courseId, spec.textbook.slug, spec.textbook.title, spec.textbook.edition])
    for (const [ci, ch] of spec.textbook.chapters.entries()) {
      const chapterId = randomUUID()
      await c.query('INSERT INTO chapter (id, textbook_id, position, title) VALUES ($1,$2,$3,$4)',
        [chapterId, textbookId, ci + 1, ch.title])
      for (const [si, sec] of ch.sections.entries()) {
        const itemId = randomUUID()
        const body = JSON.stringify(sec.body)
        await c.query(
          'INSERT INTO content_item (id, key, content_type, title, course_id) VALUES ($1,$2,$3,$4,$5)',
          [itemId, `section:${spec.textbook.slug}:${ci}:${si}`, 'section', sec.title, courseId])
        await c.query(
          `INSERT INTO content_version (id, content_item_id, version_no, locale, status, body, body_hash,
                                        changelog, created_by, published_at)
           VALUES ($1,$2,1,'en','published',$3,$4,'First published edition',$5,$6)`,
          [randomUUID(), itemId, body, hash(body), adminId, daysAgo(90)])
        await c.query('INSERT INTO section (id, chapter_id, position, title, content_item_id) VALUES ($1,$2,$3,$4,$5)',
          [randomUUID(), chapterId, si + 1, sec.title, itemId])
      }
    }

    // The pointer. Publishing later flips this in one transaction.
    await c.query(
      `INSERT INTO content_release (id, scope, scope_id, release_no, status, manifest, published_by, published_at)
       VALUES ($1,'course',$2,1,'published',$3,$4,$5)`,
      [randomUUID(), courseId, JSON.stringify({
        course: spec.slug, modules: spec.modules.length,
        lessons: lessonIds.length, sections: spec.textbook.chapters.flatMap(x => x.sections).length,
      }), adminId, daysAgo(90)])

    // --- quizzes -----------------------------------------------------------
    const quizIds: string[] = []
    for (const q of spec.quizzes) {
      const quizId = randomUUID(); quizIds.push(quizId)
      await c.query(
        `INSERT INTO quiz (id, course_id, module_id, title, description, pass_mark_pct, time_limit_min, max_attempts)
         VALUES ($1,$2,$3,$4,$5,$6,15,3)`,
        [quizId, courseId, moduleIds[q.moduleIndex], q.title, q.description, q.passMark])
      await insertMany(c, 'question',
        ['id', 'quiz_id', 'position', 'kind', 'text', 'options', 'answer_index', 'explanation', 'marks', 'topic'],
        q.questions.map((qq, i) => [randomUUID(), quizId, i + 1, 'mcq', qq.text,
          JSON.stringify(qq.options), qq.answer, qq.explanation, 1, qq.topic]))
    }

    // --- media, materials, recordings --------------------------------------
    const materialIds: string[] = []
    for (const [i, m] of spec.materials.entries()) {
      const sha = hash(`${spec.slug}:material:${i}`)
      const mediaId = randomUUID()
      await c.query(
        `INSERT INTO media_asset (id, sha256, storage_key, file_name, kind, mime_type, bytes, visibility, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'protected',$8)`,
        [mediaId, sha, `media/${sha.slice(0, 2)}/${sha}/${m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
          `${m.title}.pdf`, m.kind === 'code' ? 'code' : 'pdf',
          m.kind === 'code' ? 'text/x-python' : 'application/pdf', int(80_000, 2_400_000), adminId])
      const matId = randomUUID(); materialIds.push(matId)
      await c.query(
        `INSERT INTO learning_material (id, course_id, module_id, position, title, description, kind, media_asset_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [matId, courseId, m.moduleIndex != null ? moduleIds[m.moduleIndex] : null, i,
          m.title, m.description, m.kind, mediaId])
    }

    const recordingIds: string[] = []
    for (const [i, r] of spec.recordings.entries()) {
      const sha = hash(`${spec.slug}:recording:${i}`)
      const mediaId = randomUUID()
      await c.query(
        `INSERT INTO media_asset (id, sha256, storage_key, file_name, kind, mime_type, bytes, duration_ms, visibility, uploaded_by)
         VALUES ($1,$2,$3,$4,'video','video/mp4',$5,$6,'protected',$7)`,
        [mediaId, sha, `media/${sha.slice(0, 2)}/${sha}/recording-${i + 1}.mp4`,
          `${r.title}.mp4`, r.minutes * 8_000_000, r.minutes * 60_000, adminId])
      const recId = randomUUID(); recordingIds.push(recId)
      await c.query(
        `INSERT INTO recording (id, course_id, module_id, position, title, description, duration_seconds,
                                media_asset_id, status, recorded_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',$9)`,
        [recId, courseId, moduleIds[r.moduleIndex], i, r.title, r.description, r.minutes * 60,
          mediaId, daysAgo(60 - i * 7).slice(0, 10)])
    }

    built.push({ spec, courseId, moduleIds, lessonIds, exerciseIds, quizIds, recordingIds, materialIds })
    console.log(`  ${spec.title}: ${moduleIds.length} modules · ${lessonIds.length} lessons · ` +
      `${exerciseIds.length} exercises · ${quizIds.length} quizzes · ${recordingIds.length} recordings`)
  }

  // ===========================================================================
  // 4. Live sessions — past and upcoming
  // ===========================================================================
  const liveIds: string[] = []
  for (const b of built) {
    const hosts = b.spec.subject === 'python'
      ? [teacherIds['Sneha Reddy'], teacherIds['Vikram Joshi']]
      : [teacherIds['Anita Menon'], teacherIds['Vikram Joshi']]
    const titles = b.spec.subject === 'python'
      ? ['Week 4 live class — lists in practice', 'Week 5 live class — building a small project',
         'Doubt-clearing session', 'Week 3 live class — loops']
      : ['Week 3 live class — describing a dataset', 'Week 5 live class — evaluating a model',
         'Ethics discussion', 'Week 2 live class — cleaning data']
    const offsets = [2, 6, 9, -5]   // negative = already happened
    for (const [i, title] of titles.entries()) {
      const id = randomUUID(); liveIds.push(id)
      const start = offsets[i] > 0 ? daysAhead(offsets[i]) : daysAgo(-offsets[i])
      const end = new Date(new Date(start).getTime() + 60 * 60_000).toISOString()
      await c.query(
        `INSERT INTO live_session (id, course_id, module_id, teacher_id, title, description,
                                   starts_at, ends_at, provider, meeting_url, capacity, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,60,$10,$11)`,
        [id, b.courseId, b.moduleIds[Math.min(i, b.moduleIds.length - 1)], hosts[i % hosts.length],
          title, 'Bring your questions. The recording appears here afterwards.',
          start, end, `https://meet.brollyjuniors.com/${id.slice(0, 8)}`,
          offsets[i] > 0 ? 'scheduled' : 'ended', adminId])
    }
  }

  // ===========================================================================
  // 5. Assignments
  // ===========================================================================
  const RUBRIC = JSON.stringify([
    { key: 'correct', label: 'Does what was asked', max: 4 },
    { key: 'approach', label: 'Sensible approach', max: 3 },
    { key: 'readable', label: 'Readable and commented', max: 2 },
    { key: 'ontime', label: 'Submitted on time', max: 1 },
  ])
  const assignmentIds: Record<string, string[]> = {}
  for (const b of built) {
    const ids: string[] = []
    const specs = b.spec.subject === 'python'
      ? [['Build a marks calculator', 'Write a program that asks for five marks, then prints the total, the average rounded to two decimal places, and the highest.', 0],
         ['Number guessing game', 'The computer picks a number from 1 to 50. The player guesses; you tell them higher or lower until they get it. Use a while loop.', 2]]
      : [['Clean the travel survey', 'Take the sample dataset, remove impossible and missing values, and report how many rows you dropped and why.', 1],
         ['Find the bias', 'Pick one AI system you use. Describe what data it likely learned from, and name one group it might work worse for.', 3]]
    for (const [title, instructions, mi] of specs as [string, string, number][]) {
      const id = randomUUID(); ids.push(id)
      await c.query(
        `INSERT INTO assignment (id, course_id, module_id, created_by, title, instructions, rubric,
                                 max_score, due_at, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,10,$8,'published',$9)`,
        [id, b.courseId, b.moduleIds[mi],
          b.spec.subject === 'python' ? teacherIds['Sneha Reddy'] : teacherIds['Anita Menon'],
          title, JSON.stringify([{ type: 'paragraph', text: instructions }]), RUBRIC,
          daysAhead(int(3, 12)), daysAgo(int(5, 20))])
    }
    assignmentIds[b.courseId] = ids
  }

  // ===========================================================================
  // 6. Students, orders, enrolments and activity
  // ===========================================================================
  const NAMED = [
    { name: 'Aarav Reddy', email: 'aarav@example.com', courses: ['python-foundations', 'ai-for-beginners'], pace: 0.62, active: 0 },
    { name: 'Divya Rao', email: 'divya@example.com', courses: ['python-foundations'], pace: 0.95, active: 0 },
    { name: 'Karthik M', email: 'karthik@example.com', courses: ['python-foundations'], pace: 0.14, active: 11 },
    { name: 'Sana Fatima', email: 'sana@example.com', courses: ['ai-for-beginners'], pace: 0.71, active: 1 },
  ]

  const userRows: any[][] = [], roleRows: any[][] = [], profRows: any[][] = []
  const orderRows: any[][] = [], enrolRows: any[][] = [], progRows: any[][] = []
  const students: Array<{ id: string; name: string; courses: string[]; pace: number; active: number }> = []

  const bySlug = Object.fromEntries(built.map(b => [b.spec.slug, b]))

  const addStudent = (name: string, email: string, courseSlugs: string[], pace: number, activeDays: number) => {
    const id = randomUUID()
    userRows.push([id, email, studentHash, name, 'active', true, activeDays > 40 ? null : daysAgo(activeDays)])
    roleRows.push([id, roleIds.STUDENT])
    profRows.push([id, pick(['Class 8', 'Class 9', 'Class 10', 'Class 11']),
      `${pick(LAST)} (parent)`, `parent.${email}`, '+91 98••• •••••',
      chance(70) ? 'guardian_given' : 'adult'])
    students.push({ id, name, courses: courseSlugs, pace, active: activeDays })
    return id
  }

  for (const n of NAMED) addStudent(n.name, n.email, n.courses, n.pace, n.active)

  // 176 more, so the dashboards have a real distribution to report on
  for (let i = 0; i < 176; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`
    const email = `student${i + 1}@example.com`
    const courses = chance(22) ? ['python-foundations', 'ai-for-beginners']
      : chance(65) ? ['python-foundations'] : ['ai-for-beginners']
    addStudent(name, email, courses, Math.max(0.02, Math.min(1, rnd() * 1.15)), chance(64) ? int(0, 6) : int(8, 60))
  }

  await insertMany(c, 'app_user',
    ['id', 'email', 'password_hash', 'full_name', 'status', 'email_verified', 'last_login_at'], userRows)
  await insertMany(c, 'user_role', ['user_id', 'role_id'], roleRows)
  await insertMany(c, 'student_profile',
    ['user_id', 'grade_level', 'guardian_name', 'guardian_email', 'guardian_phone', 'consent_status'], profRows)

  // Orders then enrolments — an enrolment always has a paid order behind it.
  const enrolments: Array<{ userId: string; courseId: string; slug: string; pace: number; active: number }> = []
  for (const s of students) {
    for (const slug of s.courses) {
      const b = bySlug[slug]
      const orderId = randomUUID()
      const boughtAgo = int(20, 85)
      orderRows.push([orderId, s.id, b.courseId, b.spec.priceMinor, 'INR', 'paid', 'mock',
        `mock_${orderId.slice(0, 12)}`, daysAgo(boughtAgo), daysAgo(boughtAgo)])
      enrolRows.push([randomUUID(), s.id, b.courseId, 'active', 'purchase', orderId, daysAgo(boughtAgo)])
      enrolments.push({ userId: s.id, courseId: b.courseId, slug, pace: s.pace, active: s.active })
    }
  }
  await insertMany(c, 'course_order',
    ['id', 'user_id', 'course_id', 'amount_minor', 'currency', 'status', 'provider', 'provider_ref', 'created_at', 'paid_at'],
    orderRows)
  await insertMany(c, 'enrollment',
    ['id', 'user_id', 'course_id', 'status', 'source', 'order_id', 'enrolled_at'], enrolRows)

  // Progress, interleaved across lessons / exercises / recordings so a student
  // part-way through the course looks part-way through it, not "all videos, no
  // reading".
  for (const e of enrolments) {
    const b = bySlug[e.slug]
    const nodes = [
      ...b.lessonIds.map(id => ({ id, type: 'lesson' })),
      ...b.exerciseIds.map(id => ({ id, type: 'exercise' })),
      ...b.recordingIds.map(id => ({ id, type: 'recording' })),
    ]
    const lanes = [
      b.lessonIds.map(id => ({ id, type: 'lesson' })),
      b.exerciseIds.map(id => ({ id, type: 'exercise' })),
      b.recordingIds.map(id => ({ id, type: 'recording' })),
    ]
    const ordered: Array<{ id: string; type: string }> = []
    for (let i = 0; ordered.length < nodes.length; i++) for (const lane of lanes) if (lane[i]) ordered.push(lane[i])

    const done = Math.round(ordered.length * Math.min(1, e.pace))
    for (let i = 0; i < done; i++) {
      progRows.push([randomUUID(), e.userId, b.courseId, ordered[i].type, ordered[i].id,
        'completed', 100, int(180, 1400), 1, daysAgo(e.active + int(0, 25))])
    }
    if (done < ordered.length) {
      progRows.push([randomUUID(), e.userId, b.courseId, ordered[done].type, ordered[done].id,
        'in_progress', int(15, 85), int(60, 400), 1, daysAgo(e.active)])
    }
  }
  await insertMany(c, 'progress',
    ['id', 'user_id', 'course_id', 'node_type', 'node_id', 'status', 'percent', 'seconds_spent', 'attempts', 'last_activity_at'],
    progRows, 120)

  // ===========================================================================
  // 7. Quiz attempts, submissions, attendance, certificates
  // ===========================================================================
  const attemptRows: any[][] = [], answerRows: any[][] = []
  for (const e of enrolments.filter(x => x.pace > 0.25)) {
    const b = bySlug[e.slug]
    const quizzes = await c.query<{ id: string }>('SELECT id FROM quiz WHERE course_id = $1 ORDER BY title', [b.courseId])
    const take = Math.max(1, Math.round(quizzes.length * Math.min(1, e.pace)))
    for (const quiz of quizzes.slice(0, take)) {
      const qs = await c.query<any>('SELECT id, answer_index, marks FROM question WHERE quiz_id = $1 ORDER BY position', [quiz.id])
      const attemptId = randomUUID()
      const target = Math.max(0.25, Math.min(1, e.pace + (rnd() - 0.45) * 0.4))
      let score = 0
      for (const q of qs) {
        const right = rnd() < target
        if (right) score += q.marks
        answerRows.push([randomUUID(), attemptId, q.id, right ? q.answer_index : (q.answer_index + 1) % 4,
          '', right, right ? q.marks : 0, daysAgo(int(2, 30))])
      }
      const max = qs.reduce((a: number, q: any) => a + q.marks, 0)
      attemptRows.push([attemptId, quiz.id, e.userId, 1, 'submitted', score, max,
        max > 0 && score / max >= 0.6, daysAgo(int(2, 30)), daysAgo(int(2, 30))])
    }
  }
  await insertMany(c, 'quiz_attempt',
    ['id', 'quiz_id', 'user_id', 'attempt_no', 'status', 'score', 'max_score', 'passed', 'started_at', 'submitted_at'],
    attemptRows, 120)
  await insertMany(c, 'quiz_answer',
    ['id', 'attempt_id', 'question_id', 'choice_index', 'text_answer', 'is_correct', 'marks_awarded', 'saved_at'],
    answerRows, 120)

  const subRows: any[][] = [], gradedRows: any[][] = []
  for (const e of enrolments.filter(x => x.pace > 0.35)) {
    const b = bySlug[e.slug]
    for (const aid of assignmentIds[b.courseId]) {
      if (!chance(e.pace * 90)) continue
      const graded = chance(55)
      const row = [randomUUID(), aid, e.userId, 1,
        'My answer is attached. I used a loop for the totals and rounded with round(x, 2).',
        'total = 0\nfor m in marks:\n    total = total + m\nprint(round(total / len(marks), 2))',
        graded ? 'graded' : 'submitted']
      if (graded) {
        const s = int(6, 10)
        gradedRows.push([...row, JSON.stringify({ correct: Math.min(4, s - 3), approach: 3, readable: 2, ontime: 1 }), s,
          pick(['Neat and readable. Watch the rounding next time.', 'Good approach. Add a comment above the loop.',
                'Correct. Try doing it without the extra variable.']),
          b.spec.subject === 'python' ? teacherIds['Sneha Reddy'] : teacherIds['Anita Menon'],
          daysAgo(int(4, 18)), daysAgo(int(1, 3))])
      } else {
        subRows.push([...row, daysAgo(int(0, 5))])
      }
    }
  }
  await insertMany(c, 'submission',
    ['id', 'assignment_id', 'user_id', 'attempt_no', 'body', 'code', 'status', 'submitted_at'], subRows)
  await insertMany(c, 'submission',
    ['id', 'assignment_id', 'user_id', 'attempt_no', 'body', 'code', 'status', 'rubric_scores', 'score',
     'feedback', 'graded_by', 'submitted_at', 'graded_at'], gradedRows, 120)

  const attRows: any[][] = []
  const sessions = await c.query<any>('SELECT id, course_id, status FROM live_session')
  for (const s of sessions) {
    for (const e of enrolments.filter(x => bySlug[x.slug].courseId === s.course_id)) {
      if (s.status === 'ended') {
        if (chance(72)) attRows.push([s.id, e.userId, 'attended', daysAgo(5), daysAgo(5)])
        else attRows.push([s.id, e.userId, 'absent', null, null])
      } else if (chance(58)) {
        attRows.push([s.id, e.userId, 'registered', null, null])
      }
    }
  }
  await insertMany(c, 'session_attendance',
    ['live_session_id', 'user_id', 'status', 'joined_at', 'left_at'], attRows, 120)

  // Certificates for the students who finished
  const certRows: any[][] = [], achRows: any[][] = []
  for (const e of enrolments.filter(x => x.pace >= 0.95)) {
    const b = bySlug[e.slug]
    const serial = `BJ-${b.spec.subject.toUpperCase()}-${String(int(10000, 99999))}`
    certRows.push([randomUUID(), e.userId, b.courseId, serial,
      randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(), int(72, 98), daysAgo(int(1, 20))])
    await c.query(`UPDATE enrollment SET status='completed', completed_at=$1 WHERE user_id=$2 AND course_id=$3`,
      [daysAgo(int(1, 20)), e.userId, b.courseId])
  }
  await insertMany(c, 'certificate',
    ['id', 'user_id', 'course_id', 'serial', 'verification_code', 'final_score', 'issued_at'], certRows)

  for (const s of students.slice(0, 60)) {
    achRows.push([randomUUID(), s.id, null, 'first_lesson', daysAgo(int(20, 60))])
    if (s.pace > 0.3) achRows.push([randomUUID(), s.id, null, 'first_exercise', daysAgo(int(10, 40))])
    if (s.pace > 0.6) achRows.push([randomUUID(), s.id, null, 'quiz_passed', daysAgo(int(4, 25))])
    if (s.pace > 0.9) achRows.push([randomUUID(), s.id, null, 'course_complete', daysAgo(int(1, 10))])
  }
  await insertMany(c, 'achievement', ['id', 'user_id', 'course_id', 'badge_key', 'earned_at'], achRows)

  // ===========================================================================
  // 8. Notifications and audit
  // ===========================================================================
  const notifRows: any[][] = []
  for (const s of students.slice(0, 40)) {
    notifRows.push([randomUUID(), s.id, 'live', 'A live class is coming up',
      'Your next live class is this week. The link appears on the session page an hour before.',
      'live', '', null, daysAgo(1)])
    if (s.pace > 0.4) {
      notifRows.push([randomUUID(), s.id, 'grade', 'An assignment was graded',
        'Your teacher has left feedback on one of your assignments.', 'assignments', '', null, daysAgo(2)])
    }
  }
  await insertMany(c, 'notification',
    ['id', 'user_id', 'kind', 'title', 'body', 'link_screen', 'link_param', 'read_at', 'created_at'], notifRows)

  await insertMany(c, 'audit_log',
    ['id', 'actor_user_id', 'actor_role', 'action', 'entity_type', 'summary', 'occurred_at'], [
      [randomUUID(), adminId, 'BROLLY_ADMIN', 'content.release.published', 'course', 'Published Python Foundations release 1', daysAgo(90)],
      [randomUUID(), adminId, 'BROLLY_ADMIN', 'content.release.published', 'course', 'Published AI for Beginners release 1', daysAgo(90)],
      [randomUUID(), adminId, 'BROLLY_ADMIN', 'user.created', 'app_user', 'Created teacher account for Anita Menon', daysAgo(70)],
      [randomUUID(), adminId, 'BROLLY_ADMIN', 'course.published', 'course', 'Published AI for Beginners to the catalogue', daysAgo(88)],
      [randomUUID(), teacherIds['Sneha Reddy'], 'TEACHER', 'assignment.created', 'assignment', 'Created "Build a marks calculator"', daysAgo(20)],
      [randomUUID(), teacherIds['Anita Menon'], 'TEACHER', 'submission.graded', 'submission', 'Graded a submission for Clean the travel survey', daysAgo(2)],
    ])

  const totals = await c.query<any>(`
    SELECT (SELECT count(*)::int FROM app_user)   AS users,
           (SELECT count(*)::int FROM enrollment) AS enrolments,
           (SELECT count(*)::int FROM progress)   AS progress,
           (SELECT count(*)::int FROM course_order WHERE status='paid') AS orders`)
  const t = totals[0]
  console.log(`\n  ${students.length} students · ${t.enrolments} enrolments · ${t.orders} paid orders · ${t.progress} progress rows`)
}

async function main() {
  console.log(`Seeding Brolly Juniors B2C (driver=${driverName}) ...\n`)
  const t0 = Date.now()
  await withAdmin(seed)
  console.log(`\nSeed complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`\n  Brolly admin   admin@brollyjuniors.com / ${DEMO_PW}`)
  console.log(`  Teacher        sneha.reddy@brollyjuniors.com / ${DEMO_PW}`)
  console.log(`  Student        aarav@example.com / ${STUDENT_PW}   (both courses)`)
  console.log(`  Student        sana@example.com / ${STUDENT_PW}    (AI only — try opening Python)\n`)
  await closeDb()
}

main().catch(err => { console.error('\nSeed failed:\n', err); process.exit(1) })
