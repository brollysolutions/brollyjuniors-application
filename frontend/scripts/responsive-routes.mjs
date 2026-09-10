/**
 * Every screen the responsive audit walks.
 *
 * Adding a screen to the product means adding a stop here. That is the whole
 * maintenance burden: the audit then measures it at all seven widths on the
 * next run, and a layout regression on it fails the build rather than reaching
 * a phone.
 *
 * `run` is a snippet evaluated in the page. The helpers it may call are
 * installed on `window.__h` by the runner:
 *
 *   __h.click(text, nth?, settle?)   click the nth button containing `text`
 *   __h.sel(css, nth?, settle?)      click the nth element matching `css`
 *   __h.ensureLogin(demoLabel)       sign in unless already signed in
 *   __h.wait(ms)
 *
 * Buttons are matched on their visible text, so a stop breaks loudly when a
 * label changes rather than silently measuring the wrong screen.
 *
 * The runner clears cookies before each route, so every route starts signed
 * out and its first stop signs in as whichever demo account it names.
 */

const H = 'await window.__h.'

/** Demo accounts, as labelled on the sign-in screen. */
export const ACCOUNTS = {
  student: 'Student — enrolled in both courses',
  studentNew: 'Student — AI only',
  teacher: 'Teacher — Python',
  admin: 'Brolly admin',
}

const login = who => `${H}ensureLogin(${JSON.stringify(ACCOUNTS[who])})`

const S = login('student')
const T = login('teacher')
const A = login('admin')

export const ROUTES = [
  {
    // The shop, readable with no account.
    name: 'public',
    stops: [
      { name: 'home', run: '' },
      { name: 'catalogue', run: `${H}click('See the courses')` },
      { name: 'course', run: `${H}click('See the courses'); ${H}sel('.coursecard', 0, 1400)` },
      {
        name: 'checkout',
        run: `${H}click('See the courses'); ${H}sel('.coursecard', 0, 1400); ${H}click('Enrol now', 0, 1400)`,
      },
      { name: 'signin', run: `${H}click('Sign in')` },
      { name: 'signup', run: `${H}click('Create an account')` },
      { name: 'verify', run: `${H}click('Verify a certificate')` },
    ],
  },

  {
    name: 'student',
    stops: [
      { name: 'home', run: S },
      { name: 'mycourses', run: `${S}; ${H}click('My courses', 0, 1600)` },
      { name: 'browse', run: `${S}; ${H}click('Browse courses', 0, 1600)` },
      { name: 'course-lessons', run: `${S}; ${H}click('My courses', 0, 1600); ${H}click('Open', 0, 1800)` },
      {
        name: 'course-materials',
        run: `${S}; ${H}click('My courses', 0, 1600); ${H}click('Open', 0, 1800); ${H}click('Materials', 0, 700)`,
      },
      {
        name: 'course-quizzes',
        run: `${S}; ${H}click('My courses', 0, 1600); ${H}click('Open', 0, 1800); ${H}click('Quizzes', 0, 700)`,
      },
      {
        name: 'course-assignments',
        run: `${S}; ${H}click('My courses', 0, 1600); ${H}click('Open', 0, 1800); ${H}click('Assignments', 1, 700)`,
      },
      {
        name: 'lesson',
        run: `${S}; ${H}click('My courses', 0, 1600); ${H}click('Open', 0, 1800); ${H}sel('.lessonrow', 0, 1800)`,
      },
      {
        // The hardest surface on a phone: a monospace box that must scroll
        // sideways, a console, and a Run button.
        name: 'exercise',
        run: `${S}; ${H}click('My courses', 0, 1800); ${H}click('Open', 0, 2200); `
          + `${H}sel('.lessonrow', 0, 2200); ${H}sel('.unit .btn', 0, 2400)`,
      },
      {
        name: 'textbook',
        run: `${S}; ${H}click('My courses', 0, 1800); ${H}click('Open', 0, 2200); `
          + `${H}click('Textbook', 0, 900); ${H}click('Open the textbook', 0, 2000)`,
      },
      { name: 'live', run: `${S}; ${H}click('Live classes', 0, 1600)` },
      { name: 'resources', run: `${S}; ${H}click('Library', 0, 1800)` },
      { name: 'recordings', run: `${S}; ${H}click('Recordings', 0, 1600)` },
      { name: 'recording', run: `${S}; ${H}click('Recordings', 0, 1600); ${H}sel('.libcard', 0, 1800)` },
      { name: 'assignments', run: `${S}; ${H}click('Assignments', 0, 1600)` },
      { name: 'assignment', run: `${S}; ${H}click('Assignments', 0, 1600); ${H}click('Open', 0, 1800)` },
      { name: 'progress', run: `${S}; ${H}click('My progress', 0, 1600)` },
      { name: 'certificates', run: `${S}; ${H}click('Certificates', 0, 1600)` },
      { name: 'profile', run: `${S}; ${H}click('My profile', 0, 1800)` },
      { name: 'drawer-open', run: `${S}; ${H}sel('.iconbtn', 0, 700)` },
    ],
  },

  {
    // The seeded student above owns both courses and so never sees an Enrol
    // button; the purchase sheet needs the account that does not.
    name: 'student-buy',
    stops: [
      {
        name: 'enrol-sheet',
        run: `${login('studentNew')}; ${H}click('Browse courses', 0, 1800); ${H}click('Enrol', 0, 1200)`,
      },
    ],
  },

  {
    name: 'teacher',
    stops: [
      { name: 'overview', run: T },
      { name: 'courses', run: `${T}; ${H}click('My courses', 0, 1800)` },
      { name: 'course', run: `${T}; ${H}click('My courses', 0, 1800); ${H}click('Open', 0, 2200)` },
      { name: 'students', run: `${T}; ${H}click('My students', 0, 1800)` },
      { name: 'student', run: `${T}; ${H}click('My students', 0, 1800); ${H}sel('tr.clickable', 0, 2200)` },
      { name: 'live', run: `${T}; ${H}click('Live classes', 0, 1800)` },
      { name: 'session', run: `${T}; ${H}click('Live classes', 0, 1800); ${H}click('Open', 0, 2200)` },
      { name: 'grading', run: `${T}; ${H}click('Grading', 0, 1800)` },
      { name: 'submission', run: `${T}; ${H}click('Grading', 0, 1800); ${H}click('Open', 0, 2200)` },
      { name: 'recordings', run: `${T}; ${H}click('Recordings', 0, 1800)` },
      { name: 'resources', run: `${T}; ${H}click('Library', 0, 1800)` },
      { name: 'profile', run: `${T}; ${H}click('My profile', 0, 2000)` },
    ],
  },

  {
    name: 'admin',
    stops: [
      { name: 'overview', run: A },
      { name: 'courses', run: `${A}; ${H}click('Courses', 0, 1800)` },
      { name: 'course-form', run: `${A}; ${H}click('Courses', 0, 1800); ${H}click('New course', 0, 1100)` },
      { name: 'content', run: `${A}; ${H}click('Content Hub', 0, 1800)` },
      { name: 'resources', run: `${A}; ${H}click('Shared library', 0, 1800)` },
      {
        name: 'resource-form',
        run: `${A}; ${H}click('Shared library', 0, 1800); ${H}click('Add a resource', 0, 1200)`,
      },
      {
        name: 'resource-course-form',
        run: `${A}; ${H}click('Shared library', 0, 1800); ${H}click('Add a resource', 0, 1200); `
          + `const course = document.querySelectorAll('[role="dialog"] select')[1]; `
          + `if (!course?.options[1]) throw new Error('No course available'); `
          + `course.value = course.options[1].value; course.dispatchEvent(new Event('change', { bubbles: true })); `
          + `${H}wait(400); if (document.querySelector('.resource-recipients')) throw new Error('Course sharing did not activate');`,
      },
      // Not covered: the resource Edit sheet and its delete confirmation. Both
      // need a row on the shelf, and nothing seeds one, so a stop for them
      // would fail on a fresh database rather than report a real break. Seed a
      // resource and they can be added here — they were checked by hand at
      // 320, 390, 768 and 1440 and were clean.
      { name: 'teachers', run: `${A}; ${H}click('Teachers', 0, 1800)` },
      { name: 'students', run: `${A}; ${H}click('Students', 0, 1800)` },
      { name: 'live', run: `${A}; ${H}click('Live classes', 0, 1800)` },
      { name: 'orders', run: `${A}; ${H}click('Orders', 0, 1800)` },
      { name: 'audit', run: `${A}; ${H}click('Activity log', 0, 1800)` },
      { name: 'profile', run: `${A}; ${H}click('My profile', 0, 1800)` },
    ],
  },
]

/**
 * The widths driven in the browser.
 *
 * Four phones because that is where the product broke, then one width inside
 * each of the tablet, laptop and large bands.
 */
export const WIDTHS = [320, 375, 390, 414, 768, 1024, 1440]
