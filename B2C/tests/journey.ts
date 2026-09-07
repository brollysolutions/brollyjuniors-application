/**
 * The B2C journey, end to end, through the real API.
 *
 *   npm run dev:api        (one terminal)
 *   npm run test:e2e       (another)
 */

const BASE = process.env.API ?? 'http://127.0.0.1:4100/api/v1'

let pass = 0, fail = 0
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${extra ? '  ' + extra : ''}`) }
}
const head = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)
const money = (m: number) => '₹' + (m / 100).toLocaleString('en-IN')

async function login(email: string, password: string) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json() as any
  if (!r.ok) throw new Error(`login failed for ${email}: ${j.detail}`)
  return j.accessToken as string
}

async function api(token: string | null, path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  let body: any = null
  try { body = await r.json() } catch { /* empty */ }
  return { status: r.status, body }
}
const post = (t: string | null, p: string, b?: unknown) =>
  api(t, p, { method: 'POST', ...(b !== undefined ? { body: JSON.stringify(b) } : {}) })

const run = async () => {
  head('A stranger browsing the shop')
  const cat = await api(null, '/public/courses')
  ok('The catalogue is readable with no account', cat.status === 200,
    (cat.body.courses ?? []).map((c: any) => `${c.title} ${money(c.price_minor)}`).join(' · '))
  ok('Learner counts show as social proof', cat.body.courses.every((c: any) => c.learners > 0),
    cat.body.courses.map((c: any) => `${c.learners}`).join(' / '))

  const pythonSlug = cat.body.courses.find((c: any) => c.slug === 'python-foundations')
  const detail = await api(null, `/public/courses/${pythonSlug.slug}`)
  ok('The curriculum is visible before buying', detail.body.modules.length > 0,
    `${detail.body.modules.length} modules, ${detail.body.modules.flatMap((m: any) => m.lessons).length} lesson titles`)
  ok('Teachers are named on the course page', detail.body.teachers.length > 0,
    detail.body.teachers.map((t: any) => t.full_name).join(', '))
  const firstLesson = detail.body.modules[0].lessons[0]
  ok('Lesson titles are public, lesson bodies are not',
    !!firstLesson.title && firstLesson.body === undefined, firstLesson.title)

  head('Entitlement — the rule that a course id is not a key')
  const sana = await login('sana@example.com', 'learn')       // enrolled in AI only
  const aarav = await login('aarav@example.com', 'learn')     // enrolled in both
  const pythonId = pythonSlug.id

  const peek = await api(sana, `/student/courses/${pythonId}`)
  ok('A student who has not bought Python cannot open it', peek.status === 404,
    `got ${peek.status} — ${peek.body?.detail ?? ''}`)

  const aaravPython = await api(aarav, `/student/courses/${pythonId}`)
  ok('A student who has bought it can', aaravPython.status === 200,
    `${aaravPython.body?.completion?.percent}% complete`)

  const lessonId = aaravPython.body.modules[0].lessons[0].id
  const lessonForOwner = await api(aarav, `/student/lessons/${lessonId}`)
  ok('The lesson body loads for the enrolled student',
    Array.isArray(lessonForOwner.body?.lesson?.body), `v${lessonForOwner.body?.lesson?.version_no}`)
  const lessonForOther = await api(sana, `/student/lessons/${lessonId}`)
  ok('The same lesson id returns nothing for the unenrolled student',
    lessonForOther.status === 404, `got ${lessonForOther.status}`)

  const recs = await api(aarav, '/student/recordings')
  const rec = recs.body.recordings.find((r: any) => r.course_id === pythonId)
  const recForOther = await api(sana, `/student/recordings/${rec.id}`)
  ok('A recording is unreachable without the course', recForOther.status === 404, `got ${recForOther.status}`)

  head('Buying a course')
  const before = await api(sana, '/student/home')
  const aiOnly = before.body.courses.length
  const order = await post(sana, '/checkout/orders', { courseId: pythonId })
  ok('Checkout creates a pending order', order.status === 200,
    `${money(order.body.amountMinor)} · ref ${order.body.providerRef}`)

  const stillBlocked = await api(sana, `/student/courses/${pythonId}`)
  ok('A pending order does NOT grant access', stillBlocked.status === 404, `got ${stillBlocked.status}`)

  const failed = await post(sana, `/checkout/orders/${order.body.orderId}/confirm`, { token: 'fail' })
  ok('A declined payment is refused and grants nothing', failed.status === 409, failed.body?.detail ?? '')

  const order2 = await post(sana, '/checkout/orders', { courseId: pythonId })
  const paid = await post(sana, `/checkout/orders/${order2.body.orderId}/confirm`, {})
  ok('A confirmed payment enrols the student', paid.status === 200 && paid.body.enrolled === true)

  const after = await api(sana, '/student/home')
  ok('The course appears on their home page', after.body.courses.length === aiOnly + 1,
    after.body.courses.map((c: any) => c.title).join(' · '))
  const nowOpens = await api(sana, `/student/lessons/${lessonId}`)
  ok('And the lesson body now loads', nowOpens.status === 200 && Array.isArray(nowOpens.body.lesson.body))

  const dup = await post(sana, '/checkout/orders', { courseId: pythonId })
  ok('Buying the same course twice is refused', dup.status === 409, dup.body?.detail ?? '')

  head('Learning — exercises run real Python rules server-side')
  const lesson = await api(aarav, `/student/lessons/${lessonId}`)
  const courseView = await api(aarav, `/student/courses/${pythonId}`)
  const loopLesson = courseView.body.modules
    .flatMap((m: any) => m.lessons).find((l: any) => l.exercises > 0 && l.title.includes('for and while'))
  const withEx = await api(aarav, `/student/lessons/${loopLesson.id}`)
  const exId = withEx.body.exercises[0].id
  const ex = await api(aarav, `/student/exercises/${exId}`)
  ok('An exercise opens with a brief, hints and tests', ex.status === 200,
    `${ex.body.exercise.title} · ${ex.body.exercise.tests.length} tests`)
  ok('Expected outputs are never sent to the browser',
    ex.body.exercise.tests.every((t: any) => t.expect === undefined))

  const wrong = await post(aarav, `/student/exercises/${exId}/run`, {
    code: 'print(5)\nprint(10)', outputs: { 'starts at 5': '5', 'reaches 50': '5' },
  })
  ok('Ten print lines fail the "use a loop" rule', wrong.body.results.some((r: any) => !r.passed),
    wrong.body.results.map((r: any) => `${r.passed ? '✓' : '✗'} ${r.name}`).join('  '))

  const right = await post(aarav, `/student/exercises/${exId}/run`, {
    code: 'for i in range(1, 11):\n    print(5, "x", i, "=", 5 * i)',
    outputs: { 'starts at 5': '5 x 1 = 5', 'reaches 50': '5 x 10 = 50' },
  })
  ok('A real loop passes and marks the node solved', right.body.solved === true,
    `${right.body.passed}/${right.body.total}`)

  head('Quizzes mark themselves')
  const quiz = courseView.body.quizzes[0]
  const quizView = await api(aarav, `/student/quizzes/${quiz.id}`)
  ok('Questions arrive without the answer key',
    quizView.body.questions.every((q: any) => q.answer_index === undefined),
    `${quizView.body.questions.length} questions`)

  const started = await post(aarav, `/student/quizzes/${quiz.id}/start`)
  ok('An attempt starts', started.status === 200, started.body.resumed ? 'resumed' : 'new attempt')
  for (const q of quizView.body.questions) {
    await post(aarav, `/student/quiz-attempts/${started.body.attemptId}/answer`,
      { questionId: q.id, choiceIndex: 1 })
  }
  const submitted = await post(aarav, `/student/quiz-attempts/${started.body.attemptId}/submit`)
  ok('Submitting returns a score computed on the server', submitted.status === 200,
    `${submitted.body.score}/${submitted.body.maxScore} · ${submitted.body.percent}% · ${submitted.body.passed ? 'passed' : 'not passed'}`)
  ok('And the review shows the right answers afterwards',
    submitted.body.review.every((r: any) => r.answer_index !== undefined))

  head('Assignments — student submits, teacher grades')
  const assignments = await api(aarav, '/student/assignments')
  // Pin to the Python course, so Sneha is the teacher who owns it and Anita is
  // provably the wrong one. Picking any assignment would make both assertions
  // depend on which course happened to come back first.
  const pythonAssignments = assignments.body.assignments.filter((a: any) => a.course_id === pythonId)
  const target = pythonAssignments.find((a: any) => !a.submission_id) ?? pythonAssignments[0]
  const sub = await post(aarav, `/student/assignments/${target.id}/submit`, {
    body: 'I used a loop to total the marks and rounded the average.',
    code: 'total = 0\nfor m in marks:\n    total += m\nprint(round(total / len(marks), 2))',
  })
  ok('The student submits', sub.status === 200)

  const sneha = await login('sneha.reddy@brollyjuniors.com', 'brolly')
  const anita = await login('anita.menon@brollyjuniors.com', 'brolly')
  const queue = await api(sneha, '/teacher/grading')
  const mine = queue.body.submissions.find((s: any) => s.id === sub.body.submissionId)
  ok('It reaches the teacher of that course', !!mine, mine ? `${mine.student} · ${mine.assignment}` : '')

  const notMine = await api(anita, `/teacher/submissions/${sub.body.submissionId}`)
  ok('A teacher of a different course cannot open it', notMine.status !== 200, `got ${notMine.status}`)

  const graded = await post(sneha, `/teacher/submissions/${sub.body.submissionId}/grade`, {
    scores: { correct: 4, approach: 3, readable: 1, ontime: 1 }, feedback: 'Add a comment above the loop.',
  })
  ok('The teacher grades against the rubric', graded.body?.score === 9, `${graded.body?.score}/10`)

  const overMax = await post(sneha, `/teacher/submissions/${sub.body.submissionId}/grade`, {
    scores: { correct: 9, approach: 3, readable: 2, ontime: 1 },
  })
  ok('Marks above the rubric maximum are rejected', overMax.status === 400, overMax.body?.detail ?? '')

  const studentSees = await api(aarav, `/student/assignments/${target.id}`)
  ok('The student sees the grade and the feedback',
    studentSees.body.submission?.status === 'graded',
    `${studentSees.body.submission?.score}/10 — "${studentSees.body.submission?.feedback}"`)

  head('Teachers reach students only through a course')
  const students = await api(sneha, '/teacher/students')
  ok('A teacher sees the students on their courses', students.body.students.length > 0,
    `${students.body.students.length} students`)
  const anitaStudents = await api(anita, '/teacher/students')
  const snehaIds = new Set(students.body.students.map((s: any) => s.id))
  const overlap = anitaStudents.body.students.filter((s: any) => snehaIds.has(s.id))
  ok('Two teachers on different courses see different students',
    overlap.length < anitaStudents.body.students.length,
    `${students.body.students.length} vs ${anitaStudents.body.students.length}, ${overlap.length} shared (both courses)`)

  const anyStudent = students.body.students[0]
  const profile = await api(sneha, `/teacher/students/${anyStudent.id}`)
  ok('A teacher sees a student’s work but not their personal record',
    profile.status === 200 && profile.body.student.date_of_birth === undefined &&
    profile.body.student.guardian_phone === undefined,
    'no guardian contact, no date of birth')

  head('Live classes')
  const live = await api(aarav, '/student/live')
  const upcoming = live.body.sessions.find((s: any) => new Date(s.starts_at) > new Date())
  ok('A student sees sessions for their courses', live.body.sessions.length > 0,
    `${live.body.sessions.length} sessions`)
  ok('The meeting link is NOT in the list response',
    live.body.sessions.every((s: any) => s.meeting_url === undefined))
  if (upcoming) {
    const early = await post(aarav, `/student/live/${upcoming.id}/join`)
    ok('Joining days early is refused', early.status === 409, early.body?.detail ?? '')
  }
  const ended = live.body.sessions.find((s: any) => s.status === 'ended')
  if (ended) {
    const late = await post(aarav, `/student/live/${ended.id}/join`)
    ok('Joining a finished session is refused', late.status === 409, late.body?.detail ?? '')
  }

  head('Content Hub — publish without a deploy')
  const admin = await login('admin@brollyjuniors.com', 'brolly')
  const hub = await api(admin, '/admin/content')
  const item = hub.body.items.find((i: any) => i.content_type === 'lesson' && i.course_id === pythonId)
  const beforeRead = await api(aarav, `/student/lessons/${lessonId}`)
  const v1 = beforeRead.body.lesson.version_no

  const lessonItem = hub.body.items.find((i: any) => i.title === beforeRead.body.lesson.title)
  const draft = await post(admin, `/admin/content/${lessonItem.id}/draft`, {
    changelog: 'Added a fourth common mistake',
    body: [
      { type: 'heading', level: 3, text: 'A program is a list of instructions' },
      { type: 'paragraph', text: 'The computer does exactly what you write, in the order you write it.' },
      { type: 'paragraph', text: 'NEW IN VERSION 2 — and it never guesses what you meant.' },
    ],
  })
  ok('A draft is created as version n+1', draft.status === 200, `v${draft.body.versionNo} ${draft.body.status}`)

  const duringDraft = await api(aarav, `/student/lessons/${lessonId}`)
  ok('Students still read the OLD version while it is a draft',
    duringDraft.body.lesson.version_no === v1 &&
    !JSON.stringify(duringDraft.body.lesson.body).includes('NEW IN VERSION 2'), `still v${v1}`)

  await post(admin, `/admin/content/versions/${draft.body.versionId}/review`)
  const published = await post(admin, `/admin/content/versions/${draft.body.versionId}/publish`)
  ok('Publishing moves the pointer', published.status === 200,
    `v${published.body.versionNo}, release ${published.body.releaseNo}`)

  const afterRead = await api(aarav, `/student/lessons/${lessonId}`)
  ok('The student reads the new version immediately, with no deploy',
    afterRead.body.lesson.version_no === v1 + 1 &&
    JSON.stringify(afterRead.body.lesson.body).includes('NEW IN VERSION 2'),
    `v${v1} → v${afterRead.body.lesson.version_no}`)

  const rolled = await post(admin, `/admin/content/${lessonItem.id}/rollback`)
  ok('Rollback is the same move in reverse', rolled.status === 200, `back to v${rolled.body.versionNo}`)
  const afterRollback = await api(aarav, `/student/lessons/${lessonId}`)
  ok('And the student sees the old text again',
    !JSON.stringify(afterRollback.body.lesson.body).includes('NEW IN VERSION 2'))

  head('Protected media')
  const material = courseView.body.materials[0]
  const link = await api(aarav, `/student/materials/${material.id}/link`)
  ok('An entitled student gets a signed, expiring link', link.status === 200 && !!link.body.url,
    `expires ${new Date(link.body.expiresAt).toLocaleTimeString('en-GB')}`)
  ok('The link is a signature, not a raw path',
    link.body.url.includes('sig=') && link.body.url.includes('expires='))

  head('Admin sees the business')
  const overview = await api(admin, '/admin/overview')
  ok('Platform overview computes from rows', overview.status === 200,
    `${overview.body.totals.students} students · ${overview.body.totals.enrolments} enrolments · ` +
    `${money(Number(overview.body.totals.revenue_minor))} revenue`)
  const teacherPeek = await api(sneha, '/admin/overview')
  ok('A teacher cannot reach the admin console', teacherPeek.status === 403, `got ${teacherPeek.status}`)
  const studentPeek = await api(aarav, '/admin/students')
  ok('A student cannot list every student', studentPeek.status === 403, `got ${studentPeek.status}`)

  const audit = await api(admin, '/admin/audit')
  ok('Publishing and payment were audited',
    audit.body.entries.some((e: any) => e.action === 'content.published') &&
    audit.body.entries.some((e: any) => e.action === 'order.paid'))
  ok('Denied attempts are recorded',
    audit.body.entries.some((e: any) => e.action === 'authz.denied'))

  head('Certificates')
  const certs = await api(aarav, '/student/certificates')
  const anyCert = certs.body.certificates[0]
  if (anyCert) {
    const verify = await api(null, `/public/certificates/${anyCert.verification_code}`)
    ok('A certificate verifies without signing in', verify.body.valid === true,
      `${verify.body.holder} — ${verify.body.course}`)
  } else {
    const someone = await api(admin, '/admin/overview')
    ok('Certificates exist on the platform', someone.body.totals.certificates > 0,
      `${someone.body.totals.certificates} issued`)
  }
  const bogus = await api(null, '/public/certificates/NOTAREALCODE')
  ok('A made-up code does not verify', bogus.body.valid === false)

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`)
  process.exit(fail ? 1 : 0)
}

run().catch(err => { console.error('\nJourney test crashed:\n', err); process.exit(1) })

export {}
