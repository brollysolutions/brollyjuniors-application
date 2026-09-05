/**
 * End-to-end smoke test: walks the whole 15-step chain through the real API,
 * as four different logins, and prints what each one can and cannot see.
 *
 *   npm run dev:api          (in one terminal)
 *   npx tsx tests/smoke.ts   (in another)
 */

const BASE = process.env.API ?? 'http://127.0.0.1:4000/api/v1'

let pass = 0, fail = 0
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${extra ? '  ' + extra : ''}`) }
}
const head = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)

type Session = { token: string; cookie: string }

async function login(body: Record<string, string>): Promise<Session> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json() as any
  if (!r.ok) throw new Error(`login failed: ${j.detail ?? JSON.stringify(j)}`)
  return { token: j.accessToken, cookie: r.headers.get('set-cookie') ?? '' }
}

async function api(s: Session | null, path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // Only declare a JSON body when there actually is one.
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(s ? { authorization: `Bearer ${s.token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  let body: any = null
  try { body = await r.json() } catch { /* empty */ }
  return { status: r.status, body }
}

const run = async () => {
  head('Authentication — four logins, one application')
  const brolly = await login({ identifier: 'admin@brollysoftware.com', password: 'brolly' })
  const admin = await login({ identifier: 'principal@vidyavihar.edu.in', password: 'brolly' })
  const teacher = await login({ identifier: 'sneha.r@vidyavihar.edu.in', password: 'brolly' })
  const student = await login({ schoolCode: 'VVHS-KUK', identifier: '9A-04', password: 'student' })
  const other = await login({ schoolCode: 'SPS-MYP', identifier: '9A-01', password: 'student' })
  ok('Brolly admin, school admin, teacher and student all sign in', true)
  ok('Student signs in with school code + roll number, no email', true)

  for (const [label, s] of [['Brolly', brolly], ['School admin', admin], ['Teacher', teacher], ['Student', student]] as const) {
    const b = await api(s, '/me/bootstrap')
    ok(`${label} bootstrap`, b.status === 200,
      b.status === 200
        ? `${b.body.user.fullName} · ${b.body.roles.join(',')} · "${b.body.boundary}"`
        : `${b.status} ${b.body?.detail ?? ''}`)
    if (b.status === 200) {
      ok(`  nav built from permissions`, b.body.nav.length > 0,
        b.body.nav.map((n: any) => n.label + (n.badge ? `(${n.badge})` : '')).join(' · '))
    }
  }

  head('Cross-tenant isolation')
  const vvClasses = await api(admin, '/school/classes')
  const vvClassId = vvClasses.body?.classes?.[0]?.id
  const spsAdmin = await login({ identifier: 'principal@sunrisepublic.edu.in', password: 'brolly' })
  const crossClass = await api(spsAdmin, `/school/classes/${vvClassId}`)
  ok('Sunrise admin asking for a Vidya Vihar class id → 404, not 403',
    crossClass.status === 404, `got ${crossClass.status}`)

  const vvStudents = await api(admin, '/school/students')
  const spsStudents = await api(spsAdmin, '/school/students')
  const vvNames = new Set((vvStudents.body?.students ?? []).map((s: any) => s.id))
  const overlap = (spsStudents.body?.students ?? []).filter((s: any) => vvNames.has(s.id))
  ok('No student row appears in both schools', overlap.length === 0, `${vvStudents.body?.students?.length} vs ${spsStudents.body?.students?.length}`)

  const platformOnSchool = await api(brolly, '/school/overview')
  ok('Brolly admin token refused on school screens', platformOnSchool.status === 403, `got ${platformOnSchool.status}`)
  const schoolOnPlatform = await api(admin, '/platform/overview')
  ok('School admin refused on platform screens', schoolOnPlatform.status === 403, `got ${schoolOnPlatform.status}`)

  head('Role boundaries within one school')
  const studentPeeking = await api(student, '/school/students')
  ok('Student cannot list the school roll', studentPeeking.status === 403, `got ${studentPeeking.status}`)
  const teacherPublishing = await api(teacher, '/platform/content')
  ok('Teacher cannot reach the Content Hub', teacherPublishing.status === 403, `got ${teacherPublishing.status}`)

  const roster = await api(teacher, `/teacher/classes`)
  const myClass = roster.body?.classes?.[0]
  ok('Teacher sees only their own classes', (roster.body?.classes ?? []).length === 2,
    (roster.body?.classes ?? []).map((c: any) => c.name).join(', '))
  const notMine = (await api(admin, '/school/classes')).body.classes.find((c: any) => c.name.startsWith('9-C'))
  const peek = await api(teacher, `/teacher/classes/${notMine.id}`)
  ok('Teacher refused a class they do not teach (9-C)', peek.status === 403, `got ${peek.status}`)

  const otherStudentId = (await api(admin, '/school/students')).body.students
    .find((s: any) => s.roll_no === '9A-07')?.id
  const peekStudent = await api(other, `/teacher/students/${otherStudentId}`)
  ok('Student from another school cannot read a Vidya Vihar student', peekStudent.status !== 200, `got ${peekStudent.status}`)

  head('Brolly admin sees rates, never a student’s work')
  const overview = await api(brolly, '/platform/overview')
  ok('Platform overview computes from rows', overview.status === 200,
    `${overview.body.totals.students} students · ${overview.body.totals.schools} schools`)
  for (const s of overview.body.schools) {
    console.log(`      ${s.name.padEnd(26)} ${String(s.students).padStart(4)} students   usage ${String(s.usage_pct).padStart(3)}%   completion ${String(s.completion).padStart(3)}%`)
  }
  const workPeek = await api(brolly, '/teacher/labs')
  ok('Brolly cannot open lab submissions', workPeek.status === 403, `got ${workPeek.status}`)

  head('Student learning')
  const home = await api(student, '/student/home')
  ok('Student home', home.status === 200,
    `${home.body?.counts?.videos_done}/${home.body?.counts?.videos_total} videos · next: ${home.body?.continueItems?.[0]?.title ?? '—'}`)

  const practice = await api(student, '/student/practice')
  const timesTable = practice.body.labs.find((l: any) => l.title.includes('Times table'))
  const openLab = await api(student, `/student/practice/${timesTable.id}`)
  ok('Practice lab opens with brief, hints and tests', openLab.status === 200,
    `${openLab.body.lab.tests.length} tests`)

  const wrong = await api(student, `/student/practice/${timesTable.id}/attempt`, {
    method: 'POST',
    body: JSON.stringify({ code: 'print(5)\nprint(10)', outputs: { 'starts at 5': '5', 'reaches 50': '5' } }),
  })
  ok('Ten print lines fail the "use a loop" test', wrong.body.results.some((r: any) => !r.passed),
    wrong.body.results.map((r: any) => `${r.passed ? '✓' : '✗'} ${r.name}`).join('  '))

  const right = await api(student, `/student/practice/${timesTable.id}/attempt`, {
    method: 'POST',
    body: JSON.stringify({
      code: 'for i in range(1, 11):\n    print(5, "x", i, "=", 5 * i)',
      outputs: { 'starts at 5': '5 x 1 = 5', 'reaches 50': '5 x 10 = 50' },
    }),
  })
  ok('A real loop passes and marks the node solved', right.body.solved === true,
    `${right.body.passed}/${right.body.total}`)

  head('Graded lab → teacher grading')
  const labs = await api(student, '/student/labs')
  const prog7 = labs.body.labs.find((l: any) => l.program_no === 7)
  const submit = await api(student, `/student/labs/${prog7.id}/submit`, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'in_app',
      code: 'marks = [78, 65, 90, 55, 82]\ntotal = 0\nfor m in marks:\n    total = total + m\nprint("Average:", total / len(marks))',
      stdout: 'Average: 74.0',
      outputs: { 'rounded to 2 decimals': 'Average: 74.0' },
    }),
  })
  ok('Submission auto-checked on the server', submit.status === 200,
    `auto ${submit.body.autoScore}/10 — ${submit.body.results.filter((r: any) => !r.passed).map((r: any) => r.name).join(', ') || 'all passed'}`)

  const pending = await api(teacher, '/teacher/labs')
  const mine = pending.body.submissions.find((s: any) => s.id === submit.body.submissionId)
  ok('It appears in the teacher’s queue', !!mine, mine ? `${mine.student} · ${mine.title}` : '')
  const graded = await api(teacher, `/teacher/labs/${submit.body.submissionId}/grade`, {
    method: 'POST',
    body: JSON.stringify({ scores: { output: 3, construct: 3, readable: 2, ontime: 1 }, feedback: 'Round it to 2 decimals.' }),
  })
  ok('Teacher grades against the rubric the student already saw', graded.body.score === 9, `${graded.body.score}/10`)

  const overMax = await api(teacher, `/teacher/labs/${submit.body.submissionId}/grade`, {
    method: 'POST', body: JSON.stringify({ scores: { output: 9, construct: 3, readable: 2, ontime: 1 } }),
  })
  ok('Marks above the rubric maximum are rejected', overMax.status === 400, overMax.body?.detail ?? '')

  head('Exams — locked, autosaved, released deliberately')
  const exams = await api(student, '/student/exams')
  const scheduled = exams.body.exams.find((e: any) => e.status === 'scheduled')
  if (scheduled) {
    const locked = await api(student, `/student/exams/${scheduled.id}`)
    ok('A scheduled paper is locked, and no questions are sent',
      locked.body.state === 'locked' && !locked.body.questions, `state=${locked.body.state}`)
    const early = await api(student, `/student/exams/${scheduled.id}/start`, { method: 'POST' })
    ok('Starting early is refused by the server', early.status === 423, `got ${early.status}`)
  }

  const teacherExams = await api(teacher, '/teacher/exams')
  const marking = teacherExams.body.exams.find((e: any) => e.to_mark > 0)
  ok('Teacher sees only written answers left to mark', !!marking,
    marking ? `${marking.title}: ${marking.to_mark} to mark` : 'none pending')

  if (marking) {
    const early = await api(teacher, `/teacher/exams/${marking.id}/release`, { method: 'POST' })
    ok('Release refused while written answers are unmarked', early.status === 409, early.body?.detail ?? '')

    const sheet = await api(teacher, `/teacher/exams/${marking.id}/marking`)
    ok('Marking screen lists written answers only', sheet.body.answers.length > 0,
      `${sheet.body.answers.length} answers · ${sheet.body.stats.papers} papers`)
    const marks = sheet.body.answers.map((a: any) => ({ answerId: a.id, marks: Math.min(4, a.max_marks) }))
    await api(teacher, `/teacher/exams/${marking.id}/marks`, { method: 'POST', body: JSON.stringify({ marks }) })
    const release = await api(teacher, `/teacher/exams/${marking.id}/release`, { method: 'POST' })
    ok('Release succeeds once every paper is finished', release.status === 200, `${release.body.students} students`)

    const results = await api(student, '/student/results')
    const released = results.body.results.find((r: any) => r.status === 'released')
    ok('Student now sees a score and the class average', !!released?.score,
      released ? `${released.score}/${released.max_score} · class avg ${released.class_avg}%` : '')
  }

  head('Content Hub → every school, no deploy')
  const before = await api(student, '/student/materials')
  const inputMat = before.body.materials.find((m: any) => m.title.includes('input()'))
  const beforeBody = await api(student, `/student/materials/${inputMat.id}`)
  const v1 = beforeBody.body.material.version_no

  const publish = await api(brolly, `/platform/materials/${inputMat.id}/publish`, {
    method: 'POST',
    body: JSON.stringify({
      changelog: 'Added a fourth common mistake',
      body: [
        { type: 'heading', level: 3, text: 'Taking input from the user' },
        { type: 'paragraph', text: 'input() always gives you text. Even when the person types 25.' },
        { type: 'paragraph', text: 'NEW IN VERSION 2: and int("twenty five") will not work either.' },
      ],
    }),
  })
  ok('Brolly publishes a new version', publish.status === 200,
    `version ${publish.body.versionNo}, release ${publish.body.releaseNo}`)

  const afterBody = await api(student, `/student/materials/${inputMat.id}`)
  ok('The student reads the new version immediately',
    afterBody.body.material.version_no === v1 + 1 &&
    JSON.stringify(afterBody.body.material.body).includes('NEW IN VERSION 2'),
    `v${v1} → v${afterBody.body.material.version_no}`)

  const otherSchoolStudent = await api(other, '/student/materials')
  const sameMat = otherSchoolStudent.body.materials.find((m: any) => m.id === inputMat.id)
  ok('Sunrise students read the same single copy — not a duplicate', !!sameMat)

  head('Seats are the commercial control')
  const importPreview = await api(admin, '/school/students/import', {
    method: 'POST',
    body: JSON.stringify({
      rows: [
        { name: 'Test One', roll: 'ZZ-01', section: 'A' },
        { name: 'Test Two', roll: '', section: 'A' },
        { name: 'Test Three', roll: '9A-04', section: 'A' },
      ],
    }),
  })
  ok('Import previews before writing anything', importPreview.body.preview === true,
    `${importPreview.body.readyCount} ready, ${importPreview.body.problemCount} to fix, ${importPreview.body.seats.left} seats left`)
  ok('Missing roll number is caught', importPreview.body.rows.some((r: any) => r.problem === 'Missing roll number'))
  ok('Duplicate roll number is caught', importPreview.body.rows.some((r: any) => r.problem === 'Roll number already used'))

  const bigImport = await api(admin, '/school/students/import', {
    method: 'POST',
    body: JSON.stringify({
      commit: true,
      classId: vvClassId,
      rows: Array.from({ length: 50 }, (_, i) => ({ name: `Overflow ${i}`, roll: `OV-${i}`, section: 'A' })),
    }),
  })
  ok('Importing past the seat cap is blocked', bigImport.status === 409, bigImport.body?.detail ?? '')

  head('Audit')
  const audit = await api(brolly, '/platform/audit')
  ok('Publishing was audited', audit.body.entries.some((e: any) => e.action === 'content.release.published'))
  const denied = audit.body.entries.filter((e: any) => e.action === 'authz.denied')
  ok('Denied attempts are recorded', denied.length > 0, `${denied.length} in the log`)

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`)
  process.exit(fail ? 1 : 0)
}

run().catch(err => { console.error('\nSmoke test crashed:\n', err); process.exit(1) })

// These files have no imports, so mark them as modules — otherwise their
// top-level names collide in a shared global scope at typecheck time.
export {}
