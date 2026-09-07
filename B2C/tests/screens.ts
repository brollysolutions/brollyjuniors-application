/**
 * Every screen, loaded the way its component loads it.
 *
 *   npm run dev:api        (one terminal)
 *   npm run test:screens   (another)
 *
 * journey.ts follows one story through the API and checks that the rules hold.
 * This walks the other axis: every screen the web app can render, fetched from
 * the same endpoint the component fetches, asserting that the fields it paints
 * are actually there. A 200 with nothing in it is still a blank page, so these
 * checks look at the rows, not the status code.
 *
 * The screen list is read out of the portal sources rather than typed here, so
 * a screen added to a switch without a check fails the run instead of quietly
 * going unverified.
 */

import { readFileSync } from 'node:fs'

const BASE = process.env.API ?? 'http://127.0.0.1:4100/api/v1'

let pass = 0, fail = 0
const visited = new Set<string>()

/** A screen with nothing to draw. Thrown by need(), caught by screen(). */
class Blank extends Error {}
const need: (cond: unknown, msg: string) => asserts cond = (cond, msg) => {
  if (!cond) throw new Blank(msg)
}

const head = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)
const money = (m: number) => '₹' + (m / 100).toLocaleString('en-IN')

const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${extra ? '  ' + extra : ''}`) }
}

/** Visit one screen. The callback returns what the screen would have to show. */
async function screen(portal: string, name: string, fn: () => Promise<string>) {
  visited.add(`${portal}:${name}`)
  const label = name.padEnd(14)
  try {
    const extra = await fn()
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${label}\x1b[2m${extra}\x1b[0m`)
  } catch (e) {
    fail++
    console.log(`  \x1b[31m✗\x1b[0m ${label}\x1b[31m${(e as Error).message}\x1b[0m`)
  }
}

// ---------------------------------------------------------------------------
// The API, as the browser sees it
// ---------------------------------------------------------------------------

async function api(token: string | null, path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  let body: any = null
  try { body = await r.json() } catch { /* empty body */ }
  return { status: r.status, body }
}

/** Load what a screen loads. A non-200 is a broken screen, not a test error. */
async function load(token: string | null, path: string): Promise<any> {
  const r = await api(token, path)
  need(r.status === 200, `GET ${path} → ${r.status}${r.body?.detail ? ' — ' + r.body.detail : ''}`)
  return r.body
}

const post = (t: string | null, p: string, b?: unknown) =>
  api(t, p, { method: 'POST', ...(b !== undefined ? { body: JSON.stringify(b) } : {}) })

async function login(email: string, password: string) {
  const r = await post(null, '/auth/login', { email, password })
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.body?.detail}`)
  return r.body.accessToken as string
}

// ---------------------------------------------------------------------------
// The screen inventory, read out of the app itself
// ---------------------------------------------------------------------------

const src = (p: string) => readFileSync(new URL(`../apps/web/src/${p}`, import.meta.url), 'utf8')

/** Portals route on a switch; the default arm is the screen shown first. */
function portalScreens(file: string, fallback: string): string[] {
  const names = [...src(file).matchAll(/case '([A-Za-z]+)':/g)].map(m => m[1])
  return [...new Set([fallback, ...names])]
}

/** The public site routes on a chain of comparisons instead. */
function publicScreens(): string[] {
  const names = [...src('public.tsx').matchAll(/screen\.name === '([A-Za-z]+)'/g)].map(m => m[1])
  return [...new Set(['home', ...names])]
}

const INVENTORY: Record<string, string[]> = {
  public: publicScreens(),
  student: portalScreens('portals/student.tsx', 'home'),
  teacher: portalScreens('portals/teacher.tsx', 'overview'),
  admin: portalScreens('portals/admin.tsx', 'overview'),
}

// ---------------------------------------------------------------------------

const run = async () => {
  const student = await login('aarav@example.com', 'learn')       // both courses
  const finisher = await login('divya@example.com', 'learn')      // finished Python
  const teacher = await login('sneha.reddy@brollyjuniors.com', 'brolly')
  const admin = await login('admin@brollyjuniors.com', 'brolly')

  const finished = (await load(finisher, '/student/certificates')).certificates ?? []

  // =========================================================================
  head('The public site — no account')
  // =========================================================================

  const shopFields = (c: any) =>
    c.title && c.subtitle && c.subject && c.level && c.age_range &&
    c.duration_hours > 0 && c.price_minor > 0 && c.modules > 0 && c.lessons > 0 &&
    Array.isArray(c.teachers) && c.teachers.length > 0

  await screen('public', 'home', async () => {
    const d = await load(null, '/public/courses')
    need(d.courses?.length, 'the front page has no courses to show')
    need(d.courses.every(shopFields), 'a course card is missing a field it prints')
    need(d.courses.every((c: any) => c.learners > 0), 'no learner counts, so no social proof')
    return d.courses.map((c: any) => `${c.title} ${money(c.price_minor)}`).join(' · ')
  })

  await screen('public', 'courses', async () => {
    const d = await load(null, '/public/courses')
    need(d.courses?.length, 'the catalogue is empty')
    need(d.subjects?.length, 'no subjects to group by')
    return `${d.courses.length} courses · ${d.subjects.length} subjects`
  })

  const slugs: string[] = (await load(null, '/public/courses')).courses.map((c: any) => c.slug)

  await screen('public', 'course', async () => {
    const seen: string[] = []
    for (const slug of slugs) {
      const d = await load(null, `/public/courses/${slug}`)
      need(d.course?.description, `${slug} has no description`)
      need(d.course.outcomes?.length, `${slug} lists no outcomes`)
      need(d.modules?.length, `${slug} shows no curriculum`)
      need(d.modules.every((m: any) => m.lessons.length > 0), `${slug} has an empty module`)
      need(d.modules.every((m: any) => m.lessons.every((l: any) => l.title && l.body === undefined)),
        `${slug} leaks a lesson body to a stranger`)
      need(d.teachers?.length, `${slug} names no teacher`)
      need(d.teachers.every((t: any) => t.full_name && t.headline), `${slug} has a teacher card with no headline`)
      need(d.stats?.learners > 0 && d.stats.recordings > 0 && d.stats.quizzes > 0,
        `${slug} has nothing for the price box to list`)
      seen.push(`${slug} ${d.modules.reduce((a: number, m: any) => a + m.lessons.length, 0)} lessons`)
    }
    return seen.join(' · ')
  })

  await screen('public', 'checkout', async () => {
    const d = await load(null, `/public/courses/${slugs[0]}`)
    need(d.course.price_minor > 0 && d.course.currency, 'nothing to charge for')
    // Paying is what journey.ts does; here it is enough that the screen has a
    // price to show and that the order endpoint refuses an anonymous buyer.
    const anon = await post(null, '/checkout/orders', { courseId: d.course.id })
    need(anon.status === 401, `an anonymous checkout got ${anon.status}, not 401`)
    return `${d.course.title} ${money(d.course.price_minor)} ${d.course.currency}`
  })

  await screen('public', 'signin', async () => {
    const r = await post(null, '/auth/login',
      { email: `screens.${Date.now()}@example.com`, password: 'wrong-on-purpose' })
    need(r.status === 401, `a bad sign-in got ${r.status}, not 401`)
    need(r.body?.detail, 'the form would have no message to show')
    return `refused: "${r.body.detail}"`
  })

  await screen('public', 'signup', async () => {
    const r = await post(null, '/auth/register',
      { fullName: 'Screen Check', email: `screens.${Date.now()}@example.com`, password: 'short' })
    need(r.status === 400, `a weak password got ${r.status}, not 400`)
    need(r.body?.detail, 'the form would have no message to show')
    return `refused: "${r.body.detail}"`
  })

  await screen('public', 'verify', async () => {
    need(finished.length, 'no certificate exists to verify')
    const real = await load(null, `/public/certificates/${finished[0].verification_code}`)
    need(real.valid && real.holder && real.course && real.serial, 'a real code did not verify')
    const fake = await load(null, '/public/certificates/NOTACODE1234')
    need(fake.valid === false, 'a made-up code verified')
    return `${real.serial} · ${real.course}`
  })

  // =========================================================================
  head('The student portal — Aarav Reddy')
  // =========================================================================

  const me = await load(student, '/me/bootstrap')
  ok('The shell has a brand, a nav and a boundary line',
    !!me.brand?.name && me.nav?.length > 0 && !!me.boundary,
    `${me.nav.length} nav items · ${me.permissions.length} permissions`)
  ok('The notification bell loads', Array.isArray((await load(student, '/me/notifications')).notifications))

  const home = await load(student, '/student/home')

  await screen('student', 'home', async () => {
    need(home.courses?.length, 'no enrolled courses on the home page')
    need(home.stats && typeof home.stats.minutes === 'number', 'the stat tiles have no numbers')
    need(home.courses.every((c: any) => c.title && c.subject && typeof c.completion === 'number'),
      'a course card is missing its title, subject or progress bar')
    need(home.next?.length, 'nothing to carry on with')
    return `${home.courses.length} courses · ${home.stats.minutes} min · next: ${home.next[0].title}`
  })

  await screen('student', 'mycourses', async () => {
    const d = await load(student, '/student/home')
    need(d.courses.every((c: any) => c.total > 0), 'a course has no nodes to complete')
    return d.courses.map((c: any) => `${c.title} ${c.completion}%`).join(' · ')
  })

  await screen('student', 'browse', async () => {
    const shop = await load(null, '/public/courses')
    const mine = new Set(home.courses.map((c: any) => c.id))
    need(shop.courses.length, 'nothing to browse')
    need(shop.courses.some((c: any) => mine.has(c.id)), 'the screen cannot tell which are already bought')
    return `${shop.courses.length} on sale · ${shop.courses.filter((c: any) => mine.has(c.id)).length} already owned`
  })

  const courseId = home.courses[0].id
  const course = await load(student, `/student/courses/${courseId}`)

  await screen('student', 'course', async () => {
    need(course.course?.title && course.course.description, 'the course header is empty')
    need(course.completion && typeof course.completion.percent === 'number', 'no progress to show')
    need(course.modules?.length, 'the course has no modules')
    need(course.modules.every((m: any) => m.lessons.length > 0), 'a module has no lessons')
    need(course.quizzes?.length, 'no quizzes listed')
    need(course.recordings?.length, 'no recordings listed')
    need(course.materials?.length, 'no materials to download')
    need(course.assignments?.length, 'no assignments listed')
    need(course.textbook?.id, 'no textbook')
    return `${course.modules.length} modules · ${course.quizzes.length} quizzes · ` +
      `${course.recordings.length} recordings · ${course.materials.length} materials`
  })

  const lessonId = course.modules[0].lessons[0].id
  const lesson = await load(student, `/student/lessons/${lessonId}`)

  await screen('student', 'lesson', async () => {
    need(lesson.lesson?.title && lesson.lesson.module, 'the lesson has no heading')
    need(Array.isArray(lesson.lesson.body) && lesson.lesson.body.length,
      'the published version has no blocks to render')
    need(lesson.lesson.version_no > 0, 'the lesson is not pointing at a published version')
    return `"${lesson.lesson.title}" v${lesson.lesson.version_no} · ` +
      `${lesson.lesson.body.length} blocks · ${lesson.exercises.length} exercises`
  })

  const book = await load(student, `/student/textbooks/${course.textbook.id}`)

  await screen('student', 'textbook', async () => {
    need(book.textbook?.title, 'the textbook has no title')
    need(book.chapters?.length, 'the textbook has no chapters')
    need(book.chapters.every((ch: any) => ch.sections.length > 0), 'a chapter has no sections')
    return `${book.textbook.title} · ${book.chapters.length} chapters · ` +
      `${book.chapters.reduce((a: number, c: any) => a + c.sections.length, 0)} sections`
  })

  await screen('student', 'section', async () => {
    const s = (await load(student, `/student/sections/${book.chapters[0].sections[0].id}`)).section
    need(s?.title && s.chapter && s.textbook, 'the section has no breadcrumb')
    need(Array.isArray(s.body) && s.body.length, 'the section has no text to read')
    return `"${s.title}" v${s.version_no} · ${s.body.length} blocks`
  })

  await screen('student', 'exercise', async () => {
    const lessonWithEx = course.modules
      .flatMap((m: any) => m.lessons).find((l: any) => l.exercises > 0)
    need(lessonWithEx, 'no lesson has an exercise')
    const exercises = (await load(student, `/student/lessons/${lessonWithEx.id}`)).exercises
    need(exercises.length, 'the lesson claims exercises it does not have')
    const ex = (await load(student, `/student/exercises/${exercises[0].id}`)).exercise
    need(ex.brief && ex.starterCode, 'the editor would open empty')
    need(ex.tests?.length, 'nothing to run the code against')
    need(ex.tests.every((t: any) => t.name && t.expect === undefined && t.expected === undefined),
      'the expected output is being sent to the browser')
    need(ex.hints?.length, 'no hints')
    return `"${ex.title}" · ${ex.tests.length} tests · ${ex.hints.length} hints`
  })

  await screen('student', 'quiz', async () => {
    const q = await load(student, `/student/quizzes/${course.quizzes[0].id}`)
    need(q.quiz?.title, 'the quiz has no title')
    need(q.questions?.length, 'the quiz has no questions')
    need(q.questions.every((x: any) => x.text && Array.isArray(x.options) && x.options.length > 1),
      'a question has no options to pick from')
    need(q.questions.every((x: any) => x.correct_index === undefined && x.answer === undefined),
      'the answer key is being sent to the browser')
    need(typeof q.attemptsLeft === 'number', 'the screen cannot say how many attempts are left')
    return `"${q.quiz.title}" · ${q.questions.length} questions · ${q.attemptsLeft} attempts left`
  })

  const live = await load(student, '/student/live')

  await screen('student', 'live', async () => {
    need(live.sessions?.length, 'no live classes to list')
    need(live.sessions.every((s: any) => s.title && s.course && s.teacher && s.starts_at),
      'a session row is missing its course, teacher or time')
    need(live.sessions.every((s: any) => s.meeting_url === undefined),
      'the meeting link is in the list response')
    return `${live.sessions.length} sessions · ${new Set(live.sessions.map((s: any) => s.course)).size} courses`
  })

  const recordings = await load(student, '/student/recordings')

  await screen('student', 'recordings', async () => {
    need(recordings.recordings?.length, 'no recordings to list')
    need(recordings.recordings.every((r: any) => r.title && r.course && r.duration_seconds > 0),
      'a recording row has no title, course or length')
    return `${recordings.recordings.length} recordings`
  })

  await screen('student', 'recording', async () => {
    const d = await load(student, `/student/recordings/${recordings.recordings[0].id}`)
    need(d.recording?.title && d.recording.course, 'the player has no heading')
    need(d.media?.url && d.media.expiresAt, 'the player has no source to play')
    need(d.media.url.includes('sig=') && d.media.url.includes('expires='),
      'the player source is a raw path, not a signed link')
    return `"${d.recording.title}" · signed until ${new Date(d.media.expiresAt).toLocaleTimeString('en-GB')}`
  })

  const assignments = await load(student, '/student/assignments')

  await screen('student', 'assignments', async () => {
    need(assignments.assignments?.length, 'no assignments to list')
    need(assignments.assignments.every((a: any) => a.title && a.course && a.max_score > 0),
      'an assignment row has no title, course or maximum')
    return `${assignments.assignments.length} assignments · ` +
      `${assignments.assignments.filter((a: any) => a.submission_id).length} submitted`
  })

  await screen('student', 'assignment', async () => {
    const d = await load(student, `/student/assignments/${assignments.assignments[0].id}`)
    need(d.assignment?.instructions, 'the brief is empty')
    need(d.assignment.rubric?.length, 'no rubric to work to')
    need(d.assignment.rubric.every((r: any) => r.key && r.label && r.max > 0), 'a rubric row is malformed')
    return `"${d.assignment.title}" · ${d.assignment.rubric.length} rubric rows · out of ${d.assignment.max_score}`
  })

  await screen('student', 'progress', async () => {
    const d = await load(student, '/student/progress')
    need(d.courses?.length, 'no courses to report on')
    need(d.stats && typeof d.stats.minutes === 'number', 'no headline numbers')
    need(d.recent?.length, 'no recent activity')
    need(d.courses.every((c: any) => c.quiz), 'a course has no quiz summary')
    return `${d.courses.length} courses · ${d.stats.exercise_attempts} exercise runs · ${d.badges.length} badges`
  })

  await screen('student', 'certificates', async () => {
    const mine = (await load(student, '/student/certificates')).certificates
    need(Array.isArray(mine), 'the screen cannot render an empty state')
    need(finished.length, 'a student who finished a course has no certificate')
    need(finished.every((c: any) => c.serial && c.verification_code && c.course && c.final_score),
      'a certificate is missing its serial, code or score')
    return `${mine.length} for Aarav (not finished) · ${finished.length} for Divya (finished)`
  })

  await screen('student', 'profile', async () => {
    const p = (await load(student, '/student/profile')).profile
    need(p?.full_name && p.email, 'the profile form has nothing to fill in')
    need(p.grade_level && p.guardian_name && p.guardian_email, 'the guardian section is empty')
    const orders = (await load(student, '/student/orders')).orders
    need(orders?.length, 'the order history is empty')
    need(orders.every((o: any) => o.course && o.status && o.amount_minor > 0), 'an order row is incomplete')
    return `${p.grade_level} · ${orders.length} orders · ${money(orders.reduce((a: number, o: any) =>
      a + (o.status === 'paid' ? o.amount_minor : 0), 0))} paid`
  })

  // =========================================================================
  head('The teacher portal — Sneha Reddy')
  // =========================================================================

  const tme = await load(teacher, '/me/bootstrap')
  ok('The nav is the teacher nav, not the admin one',
    tme.nav.some((n: any) => n.key === 'grading') && !tme.nav.some((n: any) => n.key === 'orders'),
    tme.nav.map((n: any) => n.key).join(', '))

  const tov = await load(teacher, '/teacher/overview')

  await screen('teacher', 'overview', async () => {
    need(tov.courses?.length, 'this teacher has no courses')
    need(tov.stats && typeof tov.stats.students === 'number', 'no headline numbers')
    need(tov.upcoming?.length, 'no upcoming classes')
    return `${tov.stats.students} students · ${tov.stats.to_grade} to grade · ` +
      `${tov.upcoming.length} upcoming · ${tov.recentGrading.length} waiting`
  })

  await screen('teacher', 'courses', async () => {
    need(tov.courses.every((c: any) => c.title && c.subject && c.students > 0 && c.lessons > 0),
      'a course card has no students or lessons')
    return tov.courses.map((c: any) => `${c.title} (${c.students})`).join(' · ')
  })

  await screen('teacher', 'course', async () => {
    const d = await load(teacher, `/teacher/courses/${tov.courses[0].id}`)
    need(d.course?.title, 'the course header is empty')
    need(d.modules?.length, 'no modules')
    need(d.students?.length, 'no students on the roll')
    need(d.students.every((s: any) => s.full_name && s.total_nodes > 0), 'a student row has no progress denominator')
    need(d.assignments?.length, 'no assignments')
    need(d.quizzes?.length, 'no quizzes')
    return `${d.modules.length} modules · ${d.students.length} students · ` +
      `${d.assignments.length} assignments · ${d.quizzes.length} quizzes`
  })

  const tstudents = await load(teacher, '/teacher/students')

  await screen('teacher', 'students', async () => {
    need(tstudents.students?.length, 'no students to list')
    need(tstudents.students.every((s: any) => s.full_name && s.email && s.courses),
      'a student row has no name, email or course')
    return `${tstudents.students.length} students · ` +
      `${tstudents.students.filter((s: any) => s.awaiting_grade > 0).length} with work waiting`
  })

  await screen('teacher', 'student', async () => {
    const withWork = tstudents.students.find((s: any) => s.awaiting_grade > 0) ?? tstudents.students[0]
    const d = await load(teacher, `/teacher/students/${withWork.id}`)
    need(d.student?.full_name, 'the student page has no name')
    need(d.courses?.length, 'the student is on no course this teacher teaches')
    need(d.student.guardian_name === undefined && d.student.date_of_birth === undefined,
      'the personal record is reaching the teacher')
    return `${d.student.full_name} · ${d.courses.length} courses · ` +
      `${d.quizzes.length} quizzes · ${d.submissions.length} submissions`
  })

  const tlive = await load(teacher, '/teacher/live')

  await screen('teacher', 'live', async () => {
    need(tlive.sessions?.length, 'no sessions to run')
    need(tlive.sessions.every((s: any) => s.title && s.course && typeof s.enrolled === 'number'),
      'a session row has no course or class size')
    return `${tlive.sessions.length} sessions · ` +
      `${tlive.sessions.filter((s: any) => s.status === 'ended').length} delivered`
  })

  await screen('teacher', 'session', async () => {
    const d = await load(teacher, `/teacher/live/${tlive.sessions[0].id}`)
    need(d.session?.title, 'the session has no title')
    need(d.session.meeting_url, 'the host has no room to open')
    need(d.attendance?.length, 'no register to mark')
    need(d.attendance.every((a: any) => a.full_name && a.user_id), 'an attendance row has no student')
    return `"${d.session.title}" · ${d.attendance.length} on the register`
  })

  const grading = await load(teacher, '/teacher/grading')

  await screen('teacher', 'grading', async () => {
    need(grading.submissions?.length, 'nothing in the grading queue')
    need(grading.submissions.every((s: any) => s.student && s.assignment && s.course && s.max_score > 0),
      'a queue row is missing its student, assignment or maximum')
    return `${grading.submissions.length} in the queue · ` +
      `${grading.submissions.filter((s: any) => s.status === 'submitted').length} ungraded`
  })

  await screen('teacher', 'submission', async () => {
    const s = (await load(teacher, `/teacher/submissions/${grading.submissions[0].id}`)).submission
    need(s?.student && s.assignment, 'the marking screen has no heading')
    need(s.instructions, 'the brief is not shown next to the work')
    need(s.rubric?.length, 'no rubric to mark against')
    need(s.content || s.attachment_url || s.body, 'there is no work to read')
    return `${s.student} · "${s.assignment}" · ${s.rubric.length} criteria out of ${s.max_score}`
  })

  await screen('teacher', 'recordings', async () => {
    const d = await load(teacher, '/teacher/recordings')
    need(d.recordings?.length, 'no recordings on this teacher’s courses')
    need(d.recordings.every((r: any) => r.title && r.course && r.status), 'a recording row is incomplete')
    const one = await load(teacher, `/teacher/recordings/${d.recordings[0].id}`)
    need(one.recording?.title, 'the recording will not open')
    return `${d.recordings.length} recordings · "${one.recording.title}" opens`
  })

  await screen('teacher', 'profile', async () => {
    need(tme.user?.fullName && tme.user.email, 'the profile form has nothing to fill in')
    need(tov.courses.length, 'the profile shows no courses taught')
    return `${tme.user.fullName} · ${tov.courses.length} courses · ${tme.boundary}`
  })

  // =========================================================================
  head('The admin console — Brolly admin')
  // =========================================================================

  const ame = await load(admin, '/me/bootstrap')
  ok('The nav is the admin nav',
    ame.nav.some((n: any) => n.key === 'orders') && ame.nav.some((n: any) => n.key === 'audit'),
    ame.nav.map((n: any) => n.key).join(', '))

  await screen('admin', 'overview', async () => {
    const d = await load(admin, '/admin/overview')
    need(d.totals?.students > 0 && d.totals.teachers > 0, 'the platform looks empty')
    need(Number(d.totals.revenue_minor) > 0, 'no revenue to report')
    need(d.courses?.length, 'no courses in the table')
    need(d.courses.every((c: any) => c.nodes > 0), 'a course has no content to measure progress against')
    need(d.recentOrders?.length, 'no recent orders')
    need(d.signupsByWeek?.length, 'the enrolments chart has no bars')
    return `${d.totals.students} students · ${d.totals.enrolments} enrolments · ` +
      `${money(Number(d.totals.revenue_minor))} · ${d.signupsByWeek.length} weeks charted`
  })

  await screen('admin', 'courses', async () => {
    const d = await load(admin, '/admin/courses')
    need(d.courses?.length, 'no courses to manage')
    need(d.courses.every((c: any) => c.title && c.status && c.modules > 0), 'a course row is incomplete')
    need(d.subjects?.length, 'the course form has no subjects to choose')
    need(d.teachers?.length, 'the assign-teacher dialog has nobody to assign')
    return `${d.courses.length} courses · ${d.subjects.length} subjects · ${d.teachers.length} teachers`
  })

  const content = await load(admin, '/admin/content')

  await screen('admin', 'content', async () => {
    need(content.courses?.length, 'no courses in the Content Hub')
    need(content.items?.length, 'nothing authored')
    need(content.items.every((i: any) => i.title && i.content_type && i.versions > 0),
      'a content row has no title, type or version')
    need(content.courses.some((c: any) => c.release_no > 0), 'nothing has ever been released')
    return `${content.items.length} items · ${content.items.filter((i: any) => i.version_status === 'published').length} published · ` +
      `${content.pendingReview.length} in review`
  })

  await screen('admin', 'contentItem', async () => {
    const published = content.items.find((i: any) => i.version_no > 0) ?? content.items[0]
    const d = await load(admin, `/admin/content/${published.id}`)
    need(d.item?.title && d.item.content_type, 'the editor has no heading')
    need(d.versions?.length, 'the version history is empty')
    need(d.versions.some((v: any) => v.status === 'published'), 'nothing is published for students to read')
    need(d.versions.every((v: any) => Array.isArray(v.body)), 'a version has no blocks to edit')
    return `"${d.item.title}" · ${d.versions.length} versions · latest v${d.versions[0].version_no} (${d.versions[0].status})`
  })

  await screen('admin', 'teachers', async () => {
    const d = await load(admin, '/admin/teachers')
    need(d.teachers?.length, 'no teachers')
    need(d.teachers.every((t: any) => t.full_name && t.email && t.status), 'a teacher row is incomplete')
    need(d.teachers.some((t: any) => t.courses.length > 0), 'no teacher is on a course')
    return `${d.teachers.length} teachers · ${d.teachers.reduce((a: number, t: any) => a + t.students, 0)} student places`
  })

  await screen('admin', 'students', async () => {
    const d = await load(admin, '/admin/students')
    need(d.students?.length, 'no students')
    need(d.students.every((s: any) => s.full_name && s.email && s.status), 'a student row is incomplete')
    // The screen searches on every keystroke, so the query form has to work too.
    const found = await load(admin, '/admin/students?q=aarav')
    need(found.students.length && found.students.every((s: any) => /aarav/i.test(s.full_name + s.email)),
      'search does not narrow the list')
    return `${d.students.length} listed · search for "aarav" finds ${found.students.length}`
  })

  await screen('admin', 'live', async () => {
    const d = await load(admin, '/admin/live')
    need(d.sessions?.length, 'no sessions scheduled')
    need(d.sessions.every((s: any) => s.title && s.course && s.teacher), 'a session row has no course or teacher')
    need(d.courses?.length && d.teachers?.length, 'the schedule dialog cannot be filled in')
    return `${d.sessions.length} sessions · ${d.courses.length} courses · ${d.teachers.length} teachers to pick from`
  })

  await screen('admin', 'orders', async () => {
    const d = await load(admin, '/admin/orders')
    need(d.orders?.length, 'no orders')
    need(d.orders.every((o: any) => o.student && o.course && o.status), 'an order row is incomplete')
    need(d.summary && Number(d.summary.revenue_minor) > 0, 'no revenue summary')
    return `${d.orders.length} listed · ${d.summary.paid} paid · ${money(Number(d.summary.revenue_minor))}`
  })

  await screen('admin', 'audit', async () => {
    const d = await load(admin, '/admin/audit')
    need(d.entries?.length, 'the activity log is empty')
    need(d.entries.every((e: any) => e.action && e.summary && e.occurred_at), 'a log line is unreadable')
    need(d.entries.some((e: any) => e.actor_role), 'no entry records who did it')
    return `${d.entries.length} entries · ${new Set(d.entries.map((e: any) => e.action)).size} kinds of action`
  })

  await screen('admin', 'profile', async () => {
    need(ame.user?.fullName && ame.user.email, 'the profile form has nothing to fill in')
    need(ame.brand?.legalName && ame.brand.supportEmail && ame.brand.primaryColor,
      'the brand panel has nothing to show')
    return `${ame.user.fullName} · ${ame.brand.legalName} · ${ame.brand.primaryColor}`
  })

  // =========================================================================
  head('Screen coverage — the app against this test')
  // =========================================================================

  for (const [portal, names] of Object.entries(INVENTORY)) {
    const missed = names.filter(n => !visited.has(`${portal}:${n}`))
    ok(`Every screen the ${portal} router can reach was checked`, missed.length === 0,
      missed.length ? `not checked: ${missed.join(', ')}` : `${names.length} screens`)
  }

  const navKeys = [
    ...me.nav.map((n: any) => `student:${n.key}`),
    ...tme.nav.map((n: any) => `teacher:${n.key}`),
    ...ame.nav.map((n: any) => `admin:${n.key}`),
  ]
  const unreachable = navKeys.filter(k => !visited.has(k))
  ok('Every nav item the API offers has a screen behind it', unreachable.length === 0,
    unreachable.length ? `no screen for: ${unreachable.join(', ')}` : `${navKeys.length} nav items`)

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`)
  if (fail) process.exitCode = 1
}

run().catch(e => {
  console.error('\nScreen test crashed:\n', e)
  process.exitCode = 1
})
