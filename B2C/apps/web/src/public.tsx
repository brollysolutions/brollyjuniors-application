/**
 * The shop.
 *
 * Everything here is readable with no account, because a B2C product has to
 * sell before it can teach. The curriculum outline is public; the lesson bodies
 * behind it are not — that line is drawn by the RLS policies, so this file just
 * renders whatever the API is willing to hand a stranger.
 */

import React, { useEffect, useState } from 'react'
import { BROLLY_JUNIORS, formatPrice } from '@brolly/b2c-shared'
import * as client from './api.ts'
import { Action, Field, Loading, Note, Pill, useLoad, Page } from './ui.tsx'

type Nav = (name: string, param?: string | null) => void

export default function PublicSite({ screen, navigate, onSignedIn, toast }: {
  screen: { name: string; param: string | null }
  navigate: Nav
  onSignedIn: () => Promise<unknown>
  toast: (m: string, bad?: boolean) => void
}) {
  const brand = BROLLY_JUNIORS
  return (
    <div className="site">
      <header className="sitebar">
        <div className="sitebar-in">
          <button className="brand" style={{ padding: 0, background: 'none', border: 0, cursor: 'pointer' }}
            onClick={() => navigate('home')}>
            <div className="mark">{brand.logoText}</div>
            <div className="nm"><span>{brand.name}</span><small>Python &amp; AI</small></div>
          </button>
          <button className="link" onClick={() => navigate('courses')}>Courses</button>
          <button className="link" onClick={() => navigate('verify')}>Verify a certificate</button>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => navigate('signin')}>Sign in</button>
          <button className="btn gold sm" onClick={() => navigate('signup')}>Create an account</button>
        </div>
      </header>

      {screen.name === 'courses' ? <Catalogue navigate={navigate} />
        : screen.name === 'course' ? <CoursePage slug={screen.param!} navigate={navigate} />
        : screen.name === 'signin' ? <SignIn navigate={navigate} onSignedIn={onSignedIn} />
        : screen.name === 'signup' ? <SignUp navigate={navigate} onSignedIn={onSignedIn} />
        : screen.name === 'checkout' ? <Checkout slug={screen.param!} navigate={navigate} onSignedIn={onSignedIn} toast={toast} />
        : screen.name === 'verify' ? <VerifyCertificate />
        : <Home navigate={navigate} />}

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
            ? <span className="meta" style={{ fontWeight: 400, marginLeft: 8 }}>{course.learners} learners</span>
            : null}
        </div>
      </div>
    </button>
  )
}

function Catalogue({ navigate }: { navigate: Nav }) {
  const q = useLoad(() => client.get('/public/courses'))
  return (
    <div className="wrap" style={{ paddingTop: 34 }}>
      <div className="kicker">Courses</div>
      <h1 style={{ fontSize: 32, letterSpacing: '-.03em' }}>Everything we teach</h1>
      <p className="muted" style={{ maxWidth: '58ch', marginTop: 10, marginBottom: 26 }}>
        Two courses today. Both include live classes, recordings, a textbook, exercises and a
        certificate when you finish.
      </p>
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
    <div className="wrap" style={{ paddingTop: 30 }}>
      <Page q={q} what="Loading the course">
        {(d: any) => (
          <>
            <button className="link" style={{ marginBottom: 14 }} onClick={() => navigate('courses')}>
              ← All courses
            </button>
            <div className="split2">
              <div>
                <span className="tchip mat">{d.course.subject}</span>
                <h1 style={{ fontSize: 34, letterSpacing: '-.03em', marginTop: 10 }}>{d.course.title}</h1>
                <p className="lead muted" style={{ fontSize: 16, marginTop: 10 }}>{d.course.subtitle}</p>
                <div className="row tight" style={{ marginTop: 14 }}>
                  <span className="chip">{d.course.level}</span>
                  <span className="chip">Ages {d.course.age_range}</span>
                  <span className="chip">{d.course.duration_hours} hours</span>
                  <span className="chip">{d.stats.learners} learners</span>
                  {d.stats.recordings > 0 ? <span className="chip">{d.stats.recordings} recordings</span> : null}
                </div>

                <h2 style={{ marginTop: 30 }}>What you will be able to do</h2>
                <ul className="small" style={{ lineHeight: 2, marginTop: 10, color: 'var(--slate)' }}>
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
                        <button className="modhead" onClick={() => setOpenModule(open ? null : m.id)}>
                          <span className="n">{String(m.position).padStart(2, '0')}</span>
                          <span>{m.title}</span>
                          <span className="spacer" />
                          <span className="count">{m.lessons.length} lessons {open ? '▾' : '▸'}</span>
                        </button>
                        {open ? m.lessons.map((l: any) => (
                          <div className="lessonrow locked" key={l.id}>
                            <span>🔒</span>
                            <span>{l.title}</span>
                            <span className="spacer" />
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
                      <div className="av">{t.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}</div>
                      <div>
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

  return (
    <div className="wrap" style={{ paddingTop: 30, maxWidth: 900 }}>
      <Page q={q}>
        {(d: any) => (
          <>
            <button className="link" style={{ marginBottom: 14 }} onClick={() => navigate('course', slug)}>
              ← Back to the course
            </button>
            <h1 style={{ fontSize: 28, letterSpacing: '-.03em' }}>Enrol in {d.course.title}</h1>

            <div className="row" style={{ margin: '20px 0 24px', gap: 24 }}>
              {(['account', 'pay', 'done'] as const).map((s, i) => (
                <div key={s} className={'checkoutstep' + (step === s ? ' on' : ['account', 'pay', 'done'].indexOf(step) > i ? ' done' : '')}>
                  <span className="dot">{['account', 'pay', 'done'].indexOf(step) > i ? '✓' : i + 1}</span>
                  {s === 'account' ? 'Your account' : s === 'pay' ? 'Payment' : 'Start learning'}
                </div>
              ))}
            </div>

            <div className="split2">
              <div>
                {step === 'account' && (
                  <div className="card">
                    <div className="row tight" style={{ marginBottom: 16 }}>
                      <button className={'btn sm ' + (mode === 'signup' ? 'gold' : 'ghost')} onClick={() => setMode('signup')}>
                        I am new here
                      </button>
                      <button className={'btn sm ' + (mode === 'signin' ? 'gold' : 'ghost')} onClick={() => setMode('signin')}>
                        I already have an account
                      </button>
                    </div>

                    {mode === 'signup' ? (
                      <>
                        <Field label="Your full name"><input value={form.fullName} onChange={set('fullName')} /></Field>
                        <Field label="Email"><input value={form.email} onChange={set('email')} placeholder="you@example.com" /></Field>
                        <Field label="Password" help="At least 8 characters. A phrase you will remember is fine.">
                          <input type="password" value={form.password} onChange={set('password')} />
                        </Field>
                        <div className="grid g2" style={{ gap: 10 }}>
                          <Field label="School year (optional)"><input value={form.gradeLevel} onChange={set('gradeLevel')} placeholder="Class 9" /></Field>
                          <Field label="Parent or guardian email" help="Required if you are under 18.">
                            <input value={form.guardianEmail} onChange={set('guardianEmail')} />
                          </Field>
                        </div>
                        {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
                        <Action label="Create my account" onClick={async () => {
                          setErr('')
                          try {
                            await client.register(form)
                            setStep('pay')
                          } catch (e: any) { setErr(e.message) }
                        }} />
                      </>
                    ) : (
                      <>
                        <Field label="Email"><input value={form.email} onChange={set('email')} /></Field>
                        <Field label="Password" error={err}>
                          <input type="password" value={form.password} onChange={set('password')} />
                        </Field>
                        <Action label="Sign in" onClick={async () => {
                          setErr('')
                          try {
                            await client.login({ email: form.email, password: form.password })
                            setStep('pay')
                          } catch (e: any) { setErr(e.message) }
                        }} />
                      </>
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
                      it. Swapping in Razorpay or Stripe is a class in <span className="mono">payments.ts</span>.
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
                  <div className="card" style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{ fontSize: 40 }}>★</div>
                    <h2 style={{ marginTop: 10 }}>You are in.</h2>
                    <p className="muted" style={{ maxWidth: '44ch', margin: '10px auto 20px' }}>
                      Everything is unlocked — lessons, the textbook, recordings, live classes and the
                      exercises.
                    </p>
                    <Action label="Start learning" onClick={async () => { await onSignedIn() }} />
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
    <div className="wrap" style={{ paddingTop: 40, maxWidth: 880 }}>
      <div className="split2">
        <div className="card">
          <h2>Sign in</h2>
          <div className="sub" style={{ marginBottom: 16 }}>Students, teachers and Brolly staff all sign in here.</div>
          <Field label="Email">
            <input value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }} />
          </Field>
          <Field label="Password" error={err}>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }} />
          </Field>
          <Action label="Sign in" onClick={() => submit()} />
          <p className="tiny muted" style={{ marginTop: 14 }}>
            New here? <button className="link" onClick={() => navigate('signup')}>Create an account</button>
          </p>
        </div>

        <div className="card">
          <h3>Demo logins</h3>
          <div className="sub" style={{ marginBottom: 12 }}>One click each. The seed data is the same every time.</div>
          {DEMO.map(d => (
            <button key={d.email} className="unit" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => submit({ email: d.email, password: d.password })}>
              <div className="num">→</div>
              <div className="body">
                <div className="t" style={{ fontSize: 14 }}>{d.label}</div>
                <div className="m mono" style={{ fontSize: 12 }}>{d.email}</div>
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

  return (
    <div className="wrap" style={{ paddingTop: 40, maxWidth: 560 }}>
      <div className="card">
        <h2>Create your account</h2>
        <div className="sub" style={{ marginBottom: 16 }}>
          Free to create. You only pay when you enrol in a course.
        </div>
        <Field label="Full name"><input value={f.fullName} onChange={set('fullName')} /></Field>
        <Field label="Email"><input value={f.email} onChange={set('email')} placeholder="you@example.com" /></Field>
        <Field label="Password" help="At least 8 characters. A phrase you will remember beats symbols you will forget.">
          <input type="password" value={f.password} onChange={set('password')} />
        </Field>
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label="School year (optional)"><input value={f.gradeLevel} onChange={set('gradeLevel')} placeholder="Class 9" /></Field>
          <Field label="Parent name (optional)"><input value={f.guardianName} onChange={set('guardianName')} /></Field>
        </div>
        <Field label="Parent or guardian email" error={err}
          help="Required if you are under 18. We use it for consent and for anything a parent needs to know.">
          <input value={f.guardianEmail} onChange={set('guardianEmail')} />
        </Field>
        <Action label="Create account" onClick={async () => {
          setErr('')
          try { await client.register(f); await onSignedIn() }
          catch (e: any) { setErr(e.message) }
        }} />
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

  return (
    <div className="wrap" style={{ paddingTop: 40, maxWidth: 560 }}>
      <div className="card">
        <h2>Verify a certificate</h2>
        <div className="sub" style={{ marginBottom: 16 }}>
          Enter the code printed on a Brolly Juniors certificate. No account needed.
        </div>
        <Field label="Verification code">
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3D4E5F6"
            style={{ fontFamily: 'var(--mono)' }} />
        </Field>
        <Action label={checking ? 'Checking' : 'Check it'} onClick={async () => {
          setChecking(true); setResult(null)
          try { setResult(await client.get(`/public/certificates/${encodeURIComponent(code.trim())}`)) }
          finally { setChecking(false) }
        }} />

        {result ? (result.valid ? (
          <div className="cert" style={{ marginTop: 20 }}>
            <div className="tiny" style={{ letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--slate)' }}>
              Genuine certificate
            </div>
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
