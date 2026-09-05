/**
 * Screen coverage.
 *
 * Every screen in the four portals is listed here with the endpoint it loads
 * and the fields it renders. If a screen would throw on real data — a missing
 * field, a null it does not guard, a 500 — this fails before a person finds it.
 */

const BASE = process.env.API ?? 'http://127.0.0.1:4000/api/v1'

let pass = 0, fail = 0
const results: string[] = []

function check(screen: string, ok: boolean, detail: string) {
  if (ok) { pass++; results.push(`  \x1b[32m✓\x1b[0m ${screen.padEnd(34)} ${detail}`) }
  else { fail++; results.push(`  \x1b[31m✗\x1b[0m ${screen.padEnd(34)} ${detail}`) }
}

async function login(body: Record<string, string>) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json() as any
  if (!r.ok) throw new Error(`login failed for ${JSON.stringify(body)}: ${j.detail}`)
  return j.accessToken as string
}

async function get(token: string, path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })
  const body = await r.json().catch(() => null) as any
  return { status: r.status, body }
}

/** Assert a screen loads and the fields it actually renders are present. */
async function screen(token: string, name: string, path: string, expect: (b: any) => string | true) {
  try {
    const r = await get(token, path)
    if (r.status !== 200) { check(name, false, `${r.status} ${r.body?.detail ?? ''}`); return null }
    const verdict = expect(r.body)
    check(name, verdict === true, verdict === true ? path : `${path} — ${verdict}`)
    return r.body
  } catch (e: any) {
    check(name, false, `${path} — threw: ${e.message}`)
    return null
  }
}

const has = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] === undefined) return `missing "${k}"`
  return true
}
const nonEmpty = (a: any, label: string) => (Array.isArray(a) && a.length > 0) ? true : `${label} came back empty`

const run = async () => {
  const brolly = await login({ identifier: 'admin@brollysoftware.com', password: 'brolly' })
  const admin = await login({ identifier: 'principal@vidyavihar.edu.in', password: 'brolly' })
  const teacher = await login({ identifier: 'sneha.r@vidyavihar.edu.in', password: 'brolly' })
  const student = await login({ schoolCode: 'VVHS-KUK', identifier: '9A-04', password: 'student' })

  // ---- Brolly admin ------------------------------------------------------
  results.push('\n\x1b[1mBrolly admin portal\x1b[0m')
  await screen(brolly, 'bootstrap / shell', '/me/bootstrap', b => has(b, 'user', 'tenant', 'branding', 'nav', 'boundary'))
  const ov = await screen(brolly, 'Overview', '/platform/overview',
    b => has(b.totals, 'schools', 'students', 'teachers', 'admins') === true
      ? (nonEmpty(b.schools, 'schools') === true ? has(b.sync, 'cursor', 'itemsHeld') : nonEmpty(b.schools, 'schools'))
      : has(b.totals, 'schools', 'students'))
  const schools = await screen(brolly, 'Schools', '/platform/schools', b => nonEmpty(b.schools, 'schools'))
  const schoolId = schools?.schools?.[0]?.id
  await screen(brolly, 'School detail', `/platform/schools/${schoolId}`, b => has(b, 'school', 'classes'))
  const content = await screen(brolly, 'Content (from Hub)', '/platform/content',
    b => nonEmpty(b.units, 'units') === true && nonEmpty(b.videos, 'videos') === true
      && nonEmpty(b.materials, 'materials') === true && nonEmpty(b.gradedLabs, 'graded labs') === true
      ? true : 'a content list came back empty')
  const matId = content?.materials?.[0]?.id
  await screen(brolly, 'Material editor', `/platform/materials/${matId}`,
    b => has(b, 'material', 'history') === true ? (b.material.body ? true : 'material has no body') : has(b, 'material'))
  await screen(brolly, 'Licences & seats', '/platform/licences', b => nonEmpty(b.schools, 'schools'))
  await screen(brolly, 'Reports', '/platform/reports', b => has(b, 'schools', 'byUnit', 'examAverages'))
  await screen(brolly, 'Activity log', '/platform/audit', b => nonEmpty(b.entries, 'audit entries'))

  // ---- School admin ------------------------------------------------------
  results.push('\n\x1b[1mSchool admin portal\x1b[0m')
  await screen(admin, 'bootstrap / shell', '/me/bootstrap', b => has(b, 'user', 'tenant', 'nav'))
  await screen(admin, 'Overview', '/school/overview',
    b => has(b, 'counts', 'classes', 'seats') === true ? nonEmpty(b.classes, 'classes') : has(b, 'counts'))
  await screen(admin, 'Teachers', '/school/teachers',
    b => nonEmpty(b.teachers, 'teachers') === true ? has(b.teachers[0], 'full_name', 'classes', 'students', 'assigned', 'pending') : nonEmpty(b.teachers, 'teachers'))
  const students = await screen(admin, 'Students', '/school/students',
    b => nonEmpty(b.students, 'students') === true ? has(b.seats, 'seats', 'used', 'left') : nonEmpty(b.students, 'students'))
  const classes = await screen(admin, 'Classes', '/school/classes',
    b => nonEmpty(b.classes, 'classes') === true && Array.isArray(b.teachers) && Array.isArray(b.courses) && Array.isArray(b.unassigned)
      ? true : 'classes screen missing a list it renders')
  await screen(admin, 'Class detail', `/school/classes/${classes?.classes?.[0]?.id}`,
    b => has(b, 'class', 'students'))
  await screen(admin, 'Exams', '/school/exams', b => Array.isArray(b.exams) ? true : 'exams not an array')
  await screen(admin, 'Reports', '/school/reports',
    b => has(b, 'teacherActivity', 'examAverages', 'pending', 'seats', 'inactive'))
  await screen(admin, 'School profile', '/school/profile', b => has(b, 'school', 'licence', 'counts'))
  await screen(admin, 'Profile → activity', '/school/audit', b => Array.isArray(b.entries) ? true : 'entries not an array')

  // ---- Teacher -----------------------------------------------------------
  results.push('\n\x1b[1mTeacher portal\x1b[0m')
  await screen(teacher, 'bootstrap / shell', '/me/bootstrap', b => has(b, 'nav', 'boundary'))
  const tclasses = await screen(teacher, 'My classes', '/teacher/classes', b => nonEmpty(b.classes, 'classes'))
  const classId = tclasses?.classes?.[0]?.id
  const cls = await screen(teacher, 'Class detail', `/teacher/classes/${classId}`,
    b => has(b, 'class', 'students', 'announcements'))
  const studentId = cls?.students?.[0]?.id
  await screen(teacher, 'Student detail', `/teacher/students/${studentId}`,
    b => has(b, 'student', 'lessons', 'labs', 'exams', 'totalNodes'))
  await screen(teacher, 'Library', '/teacher/library',
    b => has(b, 'units', 'videos', 'materials', 'practice', 'gradedLabs', 'mine'))
  await screen(teacher, 'Assign (library side)', '/teacher/library', b => nonEmpty(b.videos, 'videos'))
  await screen(teacher, 'Assignments', '/teacher/assignments', b => Array.isArray(b.assignments) ? true : 'not an array')
  const labs = await screen(teacher, 'Lab submissions', '/teacher/labs', b => nonEmpty(b.submissions, 'submissions'))
  const subId = labs?.submissions?.find((s: any) => s.status === 'submitted')?.id ?? labs?.submissions?.[0]?.id
  await screen(teacher, 'Grade a lab', `/teacher/labs/${subId}`,
    b => has(b.submission, 'rubric', 'max_score', 'student', 'auto_detail'))
  const exams = await screen(teacher, 'Exams', '/teacher/exams',
    b => has(b, 'exams', 'blueprints', 'classes') === true ? nonEmpty(b.blueprints, 'blueprints') : has(b, 'exams'))
  const marking = exams?.exams?.find((e: any) => e.to_mark > 0) ?? exams?.exams?.find((e: any) => e.sat > 0)
  if (marking) {
    await screen(teacher, 'Mark papers', `/teacher/exams/${marking.id}/marking`,
      b => has(b, 'exam', 'stats', 'questions', 'answers'))
  } else check('Mark papers', false, 'no exam with papers to mark')
  await screen(teacher, 'Exam reports', '/teacher/reports',
    b => has(b, 'summary', 'exams', 'questionAnalysis', 'students'))
  await screen(teacher, 'Announcements', '/teacher/announcements', b => Array.isArray(b.announcements) ? true : 'not an array')
  await screen(teacher, 'Curriculum plan', '/teacher/curriculum', b => has(b, 'plans', 'items'))

  // ---- Student -----------------------------------------------------------
  results.push('\n\x1b[1mStudent portal\x1b[0m')
  await screen(student, 'bootstrap / shell', '/me/bootstrap', b => has(b, 'nav', 'boundary'))
  await screen(student, 'Home', '/student/home',
    b => has(b, 'counts', 'continueItems', 'announcements'))
  const videos = await screen(student, 'Videos', '/student/videos',
    b => nonEmpty(b.videos, 'videos') === true ? nonEmpty(b.units, 'units') : nonEmpty(b.videos, 'videos'))
  await screen(student, 'Video player', `/student/videos/${videos?.videos?.[0]?.id}`,
    b => has(b, 'video', 'nextInUnit') === true ? (Array.isArray(b.video.summary) ? true : 'video has no summary bullets') : has(b, 'video'))
  const mats = await screen(student, 'Materials', '/student/materials',
    b => nonEmpty(b.materials, 'materials') === true ? Array.isArray(b.fromTeacher) ? true : 'fromTeacher missing' : nonEmpty(b.materials, 'materials'))
  await screen(student, 'Material reader', `/student/materials/${mats?.materials?.[0]?.id}`,
    b => Array.isArray(b.material?.body) ? true : 'material body is not a block list')
  if (mats?.fromTeacher?.length) {
    await screen(student, 'Teacher material reader', `/student/teacher-materials/${mats.fromTeacher[0].id}`,
      b => Array.isArray(b.material?.body) ? true : 'body is not a block list')
  }
  const practice = await screen(student, 'Practice labs', '/student/practice',
    b => nonEmpty(b.labs, 'labs') === true ? has(b.stats, 'solved', 'total', 'attempts') : nonEmpty(b.labs, 'labs'))
  await screen(student, 'Practice lab editor', `/student/practice/${practice?.labs?.[0]?.id}`,
    b => has(b.lab, 'brief', 'starterCode', 'hints', 'solution', 'tests'))
  const glabs = await screen(student, 'Graded labs', '/student/labs', b => nonEmpty(b.labs, 'labs'))
  await screen(student, 'Graded lab editor', `/student/labs/${glabs?.labs?.[0]?.id}`,
    b => has(b.lab, 'rubric', 'maxScore', 'brief', 'tests', 'programNo'))
  const sexams = await screen(student, 'Exams', '/student/exams', b => Array.isArray(b.exams) ? true : 'not an array')
  if (sexams?.exams?.length) {
    const locked = sexams.exams.find((e: any) => new Date(e.starts_at) > new Date())
    if (locked) {
      await screen(student, 'Exam room (locked)', `/student/exams/${locked.id}`,
        b => b.state === 'locked' && !b.questions ? true : `state=${b.state}, questions leaked=${!!b.questions}`)
    }
    const done = sexams.exams.find((e: any) => e.attempt_status)
    if (done) {
      await screen(student, 'Exam room (sat)', `/student/exams/${done.id}`,
        b => ['submitted', 'released', 'in_progress'].includes(b.state) ? true : `unexpected state ${b.state}`)
    }
  }
  await screen(student, 'Results', '/student/results', b => has(b, 'results', 'topics'))
  await screen(student, 'Practical file', '/student/practical-file',
    b => has(b, 'programs', 'approved', 'total', 'canDownload'))
  await screen(student, 'My profile', '/student/profile', b => has(b, 'profile', 'stats', 'badges'))
  await screen(student, 'My sessions', '/auth/sessions', b => Array.isArray(b.sessions) ? true : 'not an array')

  console.log(results.join('\n'))
  console.log(`\n\x1b[1m${pass} screens loaded, ${fail} failed\x1b[0m\n`)
  process.exit(fail ? 1 : 0)
}

run().catch(err => { console.error('\nScreen test crashed:\n', err); process.exit(1) })

// These files have no imports, so mark them as modules — otherwise their
// top-level names collide in a shared global scope at typecheck time.
export {}
