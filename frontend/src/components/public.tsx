'use client'

/**
 * The shop.
 *
 * Everything here is readable with no account, because a B2C product has to
 * sell before it can teach. The curriculum outline is public; the lesson bodies
 * behind it are not — that line is drawn by the RLS policies, so this file just
 * renders whatever the API is willing to hand a stranger.
 */

import React, { useState } from 'react'
import { FALLBACK_BRAND as BROLLY_JUNIORS, formatPrice } from '@/lib/types'
import * as client from '@/lib/api'
import { Action, Field, Glyph, Note, useLoad, Page } from '@/components/ui'

type Nav = (name: string, param?: string | null) => void

export default function PublicSite({ screen, navigate, onSignedIn, toast }: {
  screen: { name: string; param: string | null }
  navigate: Nav
  onSignedIn: () => Promise<unknown>
  toast: (m: string, bad?: boolean) => void
}) {
  const brand = BROLLY_JUNIORS
  const [menu, setMenu] = useState(false)

  // One handler for both the bar and the phone menu, so a tap always closes
  // the menu behind it and the next screen starts at the top.
  const goto: Nav = (name, param = null) => { setMenu(false); navigate(name, param) }

  return (
    <div className="site">
      <a className="skip" href="#main">Skip to content</a>

      <header className="sitebar">
        <div className="sitebar-in">
          <button className="brand" onClick={() => goto('home')} aria-label={`${brand.name} home`}>
            <div className="mark">{brand.logoText}</div>
            <div className="nm"><span>{brand.name}</span><small>Python &amp; AI</small></div>
          </button>

          <div className="sitelinks">
            <button className="link" onClick={() => goto('courses')}>Courses</button>
            <button className="link" onClick={() => goto('verify')}>Verify a certificate</button>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => goto('signin')}>Sign in</button>
            <button className="btn gold sm" onClick={() => goto('signup')}>Create an account</button>
          </div>

          <button
            className="iconbtn"
            aria-label={menu ? 'Close the menu' : 'Open the menu'}
            aria-expanded={menu}
            aria-controls="site-menu"
            onClick={() => setMenu(m => !m)}
          >
            <Glyph>{menu ? '✕' : '☰'}</Glyph>
          </button>
        </div>

        {menu ? (
          <nav className="sitemenu" id="site-menu" aria-label="Site">
            <button className="link" onClick={() => goto('courses')}>Courses</button>
            <button className="link" onClick={() => goto('verify')}>Verify a certificate</button>
            <button className="btn gold" onClick={() => goto('signup')}>Create an account</button>
            <button className="btn ghost" onClick={() => goto('signin')}>Sign in</button>
          </nav>
        ) : null}
      </header>

      <main id="main">
        {screen.name === 'courses' ? <Catalogue navigate={goto} />
          : screen.name === 'course' ? <CoursePage slug={screen.param!} navigate={goto} />
          : screen.name === 'signin' ? <SignIn navigate={goto} onSignedIn={onSignedIn} />
          : screen.name === 'signup' ? <SignUp navigate={goto} onSignedIn={onSignedIn} />
          : screen.name === 'checkout' ? <Checkout slug={screen.param!} navigate={goto} onSignedIn={onSignedIn} toast={toast} />
          : screen.name === 'verify' ? <VerifyCertificate />
          : <Home navigate={goto} />}
      </main>

      <footer className="sitefoot">
        <div className="sitefoot-in">
          <div><strong>{brand.legalName}</strong> · {brand.city}</div>
          <div>{brand.supportEmail}</div>
          <div>{brand.supportPhone}</div>
          <span style={{ flex: 1 }} />
          <div>Students under 18 need a parent or guardian to sign up with them.</div>
        </div>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Home({ navigate }: { navigate: Nav }) {
  const q = useLoad(() => client.get('/public/courses'))
  const brand = BROLLY_JUNIORS
  return (
    <>
      <section className="hero">
        <div className="kicker">{brand.legalName} · {brand.city}</div>
        <h1>{brand.tagline}</h1>
        <p className="lead">
          Live classes with a real teacher, recordings you can rewatch, a textbook that stays
          up to date, and exercises that run Python in your browser. Built for students aged 11 to 17.
        </p>
        <div className="row">
          <button className="btn gold" onClick={() => navigate('courses')}>See the courses</button>
          <button className="btn ghost" onClick={() => navigate('signup')}>Create a free account</button>
        </div>
      </section>

      <div className="wrap">
        <Page q={q} what="Loading the courses">
          {(d: any) => (
            <>
              <div className="grid g3">
                {d.courses.map((c: any) => (
                  <CourseCard key={c.id} course={c} onOpen={() => navigate('course', c.slug)} />
                ))}
              </div>

              <div className="grid g3" style={{ marginTop: 34 }}>
                {[
                  ['Live teaching, not just video', 'Every course has weekly live classes with a Brolly teacher. Miss one and the recording appears the same week.'],
                  ['Practice that actually runs', 'Exercises run real Python in your browser. The hidden tests are checked on our servers, so there is no fooling them.'],
                  ['A textbook that stays current', 'When we improve a chapter, you have the new version on your next visit. Nothing to download, nothing to update.'],
                ].map(([title, body]) => (
                  <div className="card" key={title}>
                    <h3>{title}</h3>
                    <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>{body}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Page>
      </div>
    </>
  )
}

function CourseCard({ course, onOpen }: { course: any; onOpen: () => void }) {
  return (
    <button className="coursecard" onClick={onOpen}>
      <div className={'band' + (course.subject_key === 'ai' ? ' ai' : '')} />
      <div className="pad">
        <span className="tchip mat">{course.subject}</span>
        <h3>{course.title}</h3>
        <div className="meta">{course.subtitle}</div>
        <div className="meta">
          {course.level} · ages {course.age_range} · {course.duration_hours} hours ·{' '}
          {course.modules} modules, {course.lessons} lessons
        </div>
        <div className="meta">Taught by {course.teachers.join(', ')}</div>
        <div className="price">
          {formatPrice(course.price_minor)}
          {course.learners > 0
            ? <span className="meta" style={{ fontWeight: 400 }}>{course.learners} learners</span>
            : null}
        </div>
      </div>
    </button>
  )
}

function Catalogue({ navigate }: { navigate: Nav }) {
  const q = useLoad(() => client.get('/public/courses'))
  return (
    <div className="wrap pad">
      <div className="pagehead">
        <div className="kicker">Courses</div>
        <h1>Everything we teach</h1>
        <p>
          Two courses today. Both include live classes, recordings, a textbook, exercises and a
          certificate when you finish.
        </p>
      </div>
      <Page q={q}>
        {(d: any) => (
          <div className="grid g2">
            {d.courses.map((c: any) => (
              <CourseCard key={c.id} course={c} onOpen={() => navigate('course', c.slug)} />
            ))}
          </div>
        )}
      </Page>
    </div>
  )
}

function CoursePage({ slug, navigate }: { slug: string; navigate: Nav }) {
  const q = useLoad(() => client.get(`/public/courses/${slug}`), [slug])
  const [openModule, setOpenModule] = useState<string | null>(null)

  return (
    <div className="wrap pad">
      <Page q={q} what="Loading the course">
        {(d: any) => (
          <>
            <button className="backlink" onClick={() => navigate('courses')}>
              <Glyph>←</Glyph> All courses
            </button>

            {/* The title sits above the split so that on a phone the price panel
                can follow it directly (`buyfirst`) instead of arriving after
                four screens of curriculum. */}
            <div className="pagehead">
              <span className="tchip mat">{d.course.subject}</span>
              <h1 style={{ marginTop: 10 }}>{d.course.title}</h1>
              <p className="lead" style={{ margin: '10px 0 0' }}>{d.course.subtitle}</p>
              <div className="row tight" style={{ marginTop: 14, marginBottom: 24 }}>
                <span className="chip">{d.course.level}</span>
                <span className="chip">Ages {d.course.age_range}</span>
                <span className="chip">{d.course.duration_hours} hours</span>
                <span className="chip">{d.stats.learners} learners</span>
                {d.stats.recordings > 0 ? <span className="chip">{d.stats.recordings} recordings</span> : null}
              </div>
            </div>

            <div className="split2 buyfirst">
              <div>
                <h2>What you will be able to do</h2>
                <ul className="small muted" style={{ lineHeight: 2, marginTop: 10 }}>
                  {(d.course.outcomes ?? []).map((o: string, i: number) => <li key={i}>{o}</li>)}
                </ul>

                <h2 style={{ marginTop: 26 }}>About the course</h2>
                <p className="muted" style={{ marginTop: 8 }}>{d.course.description}</p>

                <h2 style={{ marginTop: 30 }}>The curriculum</h2>
                <p className="tiny muted" style={{ marginTop: 4, marginBottom: 12 }}>
                  Every lesson is listed. The lesson content unlocks when you enrol.
                </p>
                <div className="outline">
                  {d.modules.map((m: any) => {
                    const open = openModule === m.id
                    return (
                      <div className="mod" key={m.id}>
                        <button
                          className="modhead"
                          aria-expanded={open}
                          onClick={() => setOpenModule(open ? null : m.id)}
                        >
                          <span className="n">{String(m.position).padStart(2, '0')}</span>
                          <span className="ttl">{m.title}</span>
                          <span className="count">
                            {m.lessons.length} lessons <Glyph>{open ? '▾' : '▸'}</Glyph>
                          </span>
                        </button>
                        {open ? m.lessons.map((l: any) => (
                          <div className="lessonrow locked" key={l.id}>
                            <Glyph>🔒</Glyph>
                            <span className="ttl">{l.title}</span>
                            <span className="mins">{l.minutes} min</span>
                          </div>
                        )) : null}
                      </div>
                    )
                  })}
                </div>

                <h2 style={{ marginTop: 30 }}>Who teaches it</h2>
                <div className="grid g2" style={{ marginTop: 12 }}>
                  {d.teachers.map((t: any) => (
                    <div className="card teachercard" key={t.full_name}>
                      <div className="av" aria-hidden="true">
                        {t.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                      </div>
                      <div className="tx">
                        <h3>{t.full_name}</h3>
                        <div className="sub">{t.headline}{t.years_exp ? ` · ${t.years_exp} years` : ''}</div>
                        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>{t.bio}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {(d.course.requirements ?? []).length ? (
                  <>
                    <h2 style={{ marginTop: 30 }}>Before you start</h2>
                    <ul className="small muted" style={{ lineHeight: 2, marginTop: 10 }}>
                      {d.course.requirements.map((r: string, i: number) => <li key={i}>{r}</li>)}
                    </ul>
                  </>
                ) : null}
              </div>

              <div className="pricebox">
                <div className="amount">{formatPrice(d.course.price_minor)}</div>
                <div className="tiny muted" style={{ marginTop: 4 }}>One payment. Lifetime access to this course.</div>
                <button className="btn gold" onClick={() => navigate('checkout', slug)}>Enrol now</button>
                <ul>
                  <li>{d.modules.reduce((a: number, m: any) => a + m.lessons.length, 0)} lessons</li>
                  <li>Weekly live classes with a teacher</li>
                  <li>{d.stats.recordings} recorded tutorials</li>
                  <li>Textbook and {d.stats.materials} downloadable materials</li>
                  <li>{d.stats.quizzes} quizzes and graded assignments</li>
                  <li>Certificate when you finish</li>
                </ul>
              </div>
            </div>
          </>
        )}
      </Page>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Checkout.
 *
 * Sign in or create an account, then pay, then get access — in that order and
 * enforced in that order on the server. Nothing here grants a course; only a
 * confirmed order does.
 */
function Checkout({ slug, navigate, onSignedIn, toast }: {
  slug: string; navigate: Nav; onSignedIn: () => Promise<unknown>
  toast: (m: string, bad?: boolean) => void
}) {
  const q = useLoad(() => client.get(`/public/courses/${slug}`), [slug])
  const [step, setStep] = useState<'account' | 'pay' | 'done'>(client.hasToken() ? 'pay' : 'account')
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [form, setForm] = useState({ fullName: '', email: '', password: '', guardianEmail: '', gradeLevel: '' })
  const [err, setErr] = useState('')
  const [order, setOrder] = useState<any>(null)

  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value })

  const createAccount = async () => {
    setErr('')
    try {
      await client.register(form)
      setStep('pay')
    } catch (e: any) { setErr(e.message) }
  }

  const signIn = async () => {
    setErr('')
    try {
      await client.login({ email: form.email, password: form.password })
      setStep('pay')
    } catch (e: any) { setErr(e.message) }
  }

  return (
    <div className="wrap mid pad">
      <Page q={q}>
        {(d: any) => (
          <>
            <button className="backlink" onClick={() => navigate('course', slug)}>
              <Glyph>←</Glyph> Back to the course
            </button>
            <h1>Enrol in {d.course.title}</h1>

            <ol className="checkoutsteps">
              {(['account', 'pay', 'done'] as const).map((s, i) => {
                const at = ['account', 'pay', 'done'].indexOf(step)
                return (
                  <li key={s} className={'checkoutstep' + (step === s ? ' on' : at > i ? ' done' : '')}>
                    <span className="dot" aria-hidden="true">{at > i ? '✓' : i + 1}</span>
                    {s === 'account' ? 'Your account' : s === 'pay' ? 'Payment' : 'Start learning'}
                  </li>
                )
              })}
            </ol>

            <div className="split2">
              <div>
                {step === 'account' && (
                  <div className="card">
                    <div className="row tight" style={{ marginBottom: 16 }}>
                      <button className={'btn sm ' + (mode === 'signup' ? 'gold' : 'ghost')}
                        aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>
                        I am new here
                      </button>
                      <button className={'btn sm ' + (mode === 'signin' ? 'gold' : 'ghost')}
                        aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>
                        I already have an account
                      </button>
                    </div>

                    {mode === 'signup' ? (
                      <form onSubmit={e => { e.preventDefault(); void createAccount() }}>
                        <Field label="Your full name">
                          <input value={form.fullName} onChange={set('fullName')} autoComplete="name" />
                        </Field>
                        <Field label="Email">
                          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
                            value={form.email} onChange={set('email')} placeholder="you@example.com" />
                        </Field>
                        <Field label="Password" help="At least 8 characters. A phrase you will remember is fine.">
                          <input type="password" autoComplete="new-password"
                            value={form.password} onChange={set('password')} />
                        </Field>
                        <div className="fieldpair">
                          <Field label="School year (optional)">
                            <input value={form.gradeLevel} onChange={set('gradeLevel')} placeholder="Class 9" />
                          </Field>
                          <Field label="Parent or guardian email" help="Required if you are under 18.">
                            <input type="email" inputMode="email" autoCapitalize="none"
                              value={form.guardianEmail} onChange={set('guardianEmail')} />
                          </Field>
                        </div>
                        {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
                        <div style={{ marginTop: 16 }}>
                          <Action label="Create my account" wide onClick={createAccount} />
                        </div>
                      </form>
                    ) : (
                      <form onSubmit={e => { e.preventDefault(); void signIn() }}>
                        <Field label="Email">
                          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
                            value={form.email} onChange={set('email')} />
                        </Field>
                        <Field label="Password" error={err}>
                          <input type="password" autoComplete="current-password"
                            value={form.password} onChange={set('password')} />
                        </Field>
                        <Action label="Sign in" wide onClick={signIn} />
                      </form>
                    )}
                  </div>
                )}

                {step === 'pay' && (
                  <div className="card">
                    <h3>Payment</h3>
                    <div className="sub" style={{ marginBottom: 14 }}>
                      {formatPrice(d.course.price_minor)} for {d.course.title}
                    </div>
                    <Note tone="teal">
                      <strong>This build uses a development payment provider.</strong> No card details are
                      collected, sent or stored — the provider hands back a reference and the server verifies
                      it. Swapping in Razorpay or Stripe is a class in <span className="mono">payments.py</span>.
                    </Note>
                    {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
                    <div className="row" style={{ marginTop: 16 }}>
                      <Action label={`Pay ${formatPrice(d.course.price_minor)}`} onClick={async () => {
                        setErr('')
                        try {
                          const o = order ?? await client.post('/checkout/orders', { courseId: d.course.id })
                          setOrder(o)
                          await client.post(`/checkout/orders/${o.orderId}/confirm`, {})
                          toast('You are enrolled')
                          setStep('done')
                        } catch (e: any) { setErr(e.message) }
                      }} />
                      <Action kind="ghost" label="Simulate a declined card" onClick={async () => {
                        setErr('')
                        try {
                          const o = await client.post('/checkout/orders', { courseId: d.course.id })
                          await client.post(`/checkout/orders/${o.orderId}/confirm`, { token: 'fail' })
                        } catch (e: any) { setErr(e.message) }
                      }} />
                    </div>
                  </div>
                )}

                {step === 'done' && (
                  <div className="card" style={{ textAlign: 'center' }}>
                    <div className="lockbox" style={{ border: 0, boxShadow: 'none', padding: 0 }}>
                      <Glyph className="big">★</Glyph>
                      <h2 style={{ marginTop: 10 }}>You are in.</h2>
                      <p className="muted" style={{ maxWidth: '44ch', margin: '10px auto 20px' }}>
                        Everything is unlocked — lessons, the textbook, recordings, live classes and the
                        exercises.
                      </p>
                      <Action label="Start learning" wide onClick={async () => { await onSignedIn() }} />
                    </div>
                  </div>
                )}
              </div>

              <div className="pricebox">
                <div className="tiny muted" style={{ letterSpacing: '.1em', textTransform: 'uppercase' }}>You are buying</div>
                <h3 style={{ marginTop: 8 }}>{d.course.title}</h3>
                <div className="sub">{d.course.subtitle}</div>
                <div className="amount" style={{ marginTop: 16 }}>{formatPrice(d.course.price_minor)}</div>
                <ul>
                  <li>{d.modules.reduce((a: number, m: any) => a + m.lessons.length, 0)} lessons</li>
                  <li>Live classes and {d.stats.recordings} recordings</li>
                  <li>Textbook and materials</li>
                  <li>Certificate on completion</li>
                </ul>
              </div>
            </div>
          </>
        )}
      </Page>
    </div>
  )
}

// ---------------------------------------------------------------------------

const DEMO = [
  { label: 'Student — enrolled in both courses', email: 'aarav@example.com', password: 'learn' },
  { label: 'Student — AI only (try opening Python)', email: 'sana@example.com', password: 'learn' },
  { label: 'Teacher — Python', email: 'sneha.reddy@brollyjuniors.com', password: 'brolly' },
  { label: 'Teacher — AI', email: 'anita.menon@brollyjuniors.com', password: 'brolly' },
  { label: 'Brolly admin', email: 'admin@brollyjuniors.com', password: 'brolly' },
]

function SignIn({ navigate, onSignedIn }: { navigate: Nav; onSignedIn: () => Promise<unknown> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  const submit = async (creds?: { email: string; password: string }) => {
    setErr('')
    try {
      await client.login(creds ?? { email, password })
      await onSignedIn()
    } catch (e: any) { setErr(e.message) }
  }

  return (
    <div className="wrap mid pad">
      <div className="split2">
        <div className="card">
          <h2>Sign in</h2>
          <div className="sub" style={{ marginBottom: 16 }}>Students, teachers and Brolly staff all sign in here.</div>
          <form onSubmit={e => { e.preventDefault(); void submit() }}>
            <Field label="Email">
              <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
                value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" error={err}>
              <input type="password" autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
            <Action label="Sign in" wide onClick={() => submit()} />
          </form>
          <p className="tiny muted" style={{ marginTop: 14 }}>
            New here? <button className="link" onClick={() => navigate('signup')}>Create an account</button>
          </p>
        </div>

        <div className="card">
          <h3>Demo logins</h3>
          <div className="sub" style={{ marginBottom: 12 }}>One click each. The seed data is the same every time.</div>
          {DEMO.map(d => (
            <button key={d.email} className="unit" onClick={() => submit({ email: d.email, password: d.password })}>
              <Glyph className="num">→</Glyph>
              <div className="body">
                <div className="t small">{d.label}</div>
                <div className="m mono tiny">{d.email}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SignUp({ navigate, onSignedIn }: { navigate: Nav; onSignedIn: () => Promise<unknown> }) {
  const [f, setF] = useState({ fullName: '', email: '', password: '', gradeLevel: '', guardianName: '', guardianEmail: '' })
  const [err, setErr] = useState('')
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })

  const submit = async () => {
    setErr('')
    try { await client.register(f); await onSignedIn() }
    catch (e: any) { setErr(e.message) }
  }

  return (
    <div className="wrap narrow pad">
      <div className="card">
        <h2>Create your account</h2>
        <div className="sub" style={{ marginBottom: 16 }}>
          Free to create. You only pay when you enrol in a course.
        </div>
        <form onSubmit={e => { e.preventDefault(); void submit() }}>
          <Field label="Full name">
            <input value={f.fullName} onChange={set('fullName')} autoComplete="name" />
          </Field>
          <Field label="Email">
            <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
              value={f.email} onChange={set('email')} placeholder="you@example.com" />
          </Field>
          <Field label="Password" help="At least 8 characters. A phrase you will remember beats symbols you will forget.">
            <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
          </Field>
          <div className="fieldpair">
            <Field label="School year (optional)">
              <input value={f.gradeLevel} onChange={set('gradeLevel')} placeholder="Class 9" />
            </Field>
            <Field label="Parent name (optional)">
              <input value={f.guardianName} onChange={set('guardianName')} autoComplete="off" />
            </Field>
          </div>
          <Field label="Parent or guardian email" error={err}
            help="Required if you are under 18. We use it for consent and for anything a parent needs to know.">
            <input type="email" inputMode="email" autoCapitalize="none"
              value={f.guardianEmail} onChange={set('guardianEmail')} />
          </Field>
          <Action label="Create account" wide onClick={submit} />
        </form>
        <p className="tiny muted" style={{ marginTop: 14 }}>
          Already have one? <button className="link" onClick={() => navigate('signin')}>Sign in</button>
        </p>
      </div>
    </div>
  )
}

function VerifyCertificate() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<any>(null)
  const [checking, setChecking] = useState(false)

  const check = async () => {
    setChecking(true); setResult(null)
    try { setResult(await client.get(`/public/certificates/${encodeURIComponent(code.trim())}`)) }
    finally { setChecking(false) }
  }

  return (
    <div className="wrap narrow pad">
      <div className="card">
        <h2>Verify a certificate</h2>
        <div className="sub" style={{ marginBottom: 16 }}>
          Enter the code printed on a Brolly Juniors certificate. No account needed.
        </div>
        <form onSubmit={e => { e.preventDefault(); void check() }}>
          <Field label="Verification code">
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3D4E5F6"
              autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              style={{ fontFamily: 'var(--mono)' }} />
          </Field>
          <Action label={checking ? 'Checking' : 'Check it'} wide onClick={check} />
        </form>

        {result ? (result.valid ? (
          <div className="cert" style={{ marginTop: 20 }}>
            <div className="lbl">Genuine certificate</div>
            <h3>{result.holder}</h3>
            <div className="muted">completed <strong>{result.course}</strong></div>
            <div className="serial">{result.serial}</div>
          </div>
        ) : (
          <Note tone="rose"><strong>That code does not match any certificate we have issued.</strong></Note>
        )) : null}
      </div>
    </div>
  )
}
