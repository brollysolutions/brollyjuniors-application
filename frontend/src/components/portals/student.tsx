'use client'

import React, { useEffect, useState } from 'react'
import * as client from '@/lib/api'
import {
  Action, Bar, Crumb, Empty, Field, Head, Modal, Note, Page, Pill, Stat, Table,
  fmtAgo, fmtDate, fmtDateTime, duration, price, mmss, useLoad, useSession,
} from '@/components/ui'
import { Blocks } from '@/components/blocks'
import { runTests, loadPython } from '@/lib/python'

export default function StudentPortal() {
  const { screen } = useSession()
  switch (screen) {
    case 'mycourses': return <MyCourses />
    case 'course': return <CourseView />
    case 'lesson': return <LessonView />
    case 'textbook': return <TextbookView />
    case 'section': return <SectionView />
    case 'exercise': return <ExerciseView />
    case 'quiz': return <QuizView />
    case 'browse': return <Browse />
    case 'live': return <LiveClasses />
    case 'recordings': return <Recordings />
    case 'recording': return <RecordingView />
    case 'assignments': return <Assignments />
    case 'assignment': return <AssignmentView />
    case 'progress': return <Progress />
    case 'certificates': return <Certificates />
    case 'profile': return <Profile />
    default: return <Home />
  }
}

// ---------------------------------------------------------------------------

function Home() {
  const { me, go } = useSession()
  const q = useLoad(() => client.get('/student/home'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title={`Hello, ${me.user.fullName.split(' ')[0]}`}
            sub={d.courses.length ? 'Pick up where you stopped.' : 'You have not enrolled in a course yet.'} />
          <div className="grid g4">
            <Stat small k="Courses" v={d.stats.courses} d="Enrolled" />
            <Stat small k="Time learning" v={`${d.stats.minutes} min`} d="All courses" />
            <Stat small k="Badges" v={d.stats.badges} />
            <Stat small k="Certificates" v={d.stats.certificates} />
          </div>

          {d.courses.length === 0 ? (
            <Empty title="Nothing here yet"
              detail="Browse the courses and enrol in one. Everything unlocks the moment you do."
              action={<button className="btn gold" onClick={() => go('browse')}>Browse courses</button>} />
          ) : (
            <>
              <Head title="My courses" />
              <div className="grid g2">
                {d.courses.map((c: any) => (
                  <div className="card" key={c.id}>
                    <span className="tchip mat">{c.subject}</span>
                    <h3 style={{ marginTop: 7 }}>{c.title}</h3>
                    <div className="sub">{c.subtitle}</div>
                    <div style={{ margin: '12px 0' }}><Bar v={c.completion} /></div>
                    <div className="row tight">
                      <button className="btn gold sm" onClick={() => go('course', c.id)}>
                        {c.completion > 0 ? 'Carry on' : 'Start'}
                      </button>
                      {c.enrollment_status === 'completed' ? <Pill tone="ok">Completed</Pill> : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {d.next.length ? (
            <>
              <Head title="Carry on where you stopped" />
              <div className="lib">
                {d.next.map((l: any) => (
                  <button className="libcard" key={l.id} onClick={() => go('lesson', l.id)}>
                    <div className="thumb mat"><div style={{ fontSize: 26 }}>▤</div>
                      {l.percent > 0 ? <div className="prog"><i style={{ width: `${l.percent}%` }} /></div> : null}
                    </div>
                    <div className="pad">
                      <span className="tchip mat">Lesson</span><h4>{l.title}</h4>
                      <div className="meta">{l.course} · {l.module} · {l.est_minutes} min</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {d.upcoming.length ? (
            <>
              <Head title="Live classes coming up" />
              <div className="grid g2">
                {d.upcoming.map((s: any) => (
                  <div className="card" key={s.id}>
                    <span className="tchip lab">Live</span>
                    <h3 style={{ marginTop: 7 }}>{s.title}</h3>
                    <div className="sub">{s.course} · with {s.teacher}</div>
                    <div className="sub" style={{ marginTop: 6 }}>{fmtDateTime(s.starts_at)}</div>
                    <div style={{ marginTop: 12 }}>
                      <button className="btn ghost sm" onClick={() => go('live')}>See details</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {d.due.length ? (
            <>
              <Head title="Assignments" />
              <Table head={['Assignment', 'Course', 'Due', 'Status']}>
                {d.due.map((a: any) => (
                  <tr key={a.id} className="clickable" onClick={() => go('assignment', a.id)}>
                    <td><strong>{a.title}</strong></td>
                    <td className="small">{a.course}</td>
                    <td className="small">{fmtDate(a.due_at)}</td>
                    <td>{a.submission_status === 'graded' ? <Pill tone="ok">{a.score}/{a.max_score}</Pill>
                      : a.submission_status ? <Pill tone="wait">Submitted</Pill>
                      : <Pill tone="mute">Not started</Pill>}</td>
                  </tr>
                ))}
              </Table>
            </>
          ) : null}
        </>
      )}
    </Page>
  )
}

function MyCourses() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/student/home'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="My courses" sub="Everything you have enrolled in"
            right={<button className="btn ghost" onClick={() => go('browse')}>Browse more</button>} />
          {d.courses.length === 0
            ? <Empty title="No courses yet" action={<button className="btn gold" onClick={() => go('browse')}>Browse courses</button>} />
            : (
              <div className="grid g2">
                {d.courses.map((c: any) => (
                  <div className="card" key={c.id}>
                    <span className="tchip mat">{c.subject}</span>
                    <h3 style={{ marginTop: 7 }}>{c.title}</h3>
                    <div className="sub">{c.done} of {c.total} things finished</div>
                    <div style={{ margin: '12px 0' }}><Bar v={c.completion} /></div>
                    <div className="tiny muted">Enrolled {fmtDate(c.enrolled_at)}</div>
                    <div style={{ marginTop: 12 }}>
                      <button className="btn gold sm" onClick={() => go('course', c.id)}>Open</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </>
      )}
    </Page>
  )
}

/** The catalogue, seen from inside — so a student can buy a second course. */
function Browse() {
  const { go, toast } = useSession()
  const q = useLoad(() => client.get('/public/courses'))
  const mine = useLoad(() => client.get('/student/home'))
  const [buying, setBuying] = useState<any>(null)
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const enrolled = new Set(((mine.data as any)?.courses ?? []).map((c: any) => c.id))
        return (
          <>
            <Head title="Browse courses" sub="Everything Brolly Juniors teaches" />
            <div className="grid g2">
              {d.courses.map((c: any) => (
                <div className="card" key={c.id}>
                  <span className="tchip mat">{c.subject}</span>
                  <h3 style={{ marginTop: 7 }}>{c.title}</h3>
                  <div className="sub">{c.subtitle}</div>
                  <div className="sub" style={{ marginTop: 8 }}>
                    {c.level} · {c.duration_hours} hours · {c.lessons} lessons · {c.learners} learners
                  </div>
                  <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
                    <strong style={{ fontSize: 20 }}>{price(c.price_minor)}</strong>
                    <span style={{ flex: 1 }} />
                    {enrolled.has(c.id)
                      ? <button className="btn ghost sm" onClick={() => go('course', c.id)}>Open</button>
                      : <button className="btn gold sm" onClick={() => { setBuying(c); setErr('') }}>Enrol</button>}
                  </div>
                </div>
              ))}
            </div>

            {buying && (
              <Modal title={`Enrol in ${buying.title}`} onClose={() => setBuying(null)}>
                <p className="small muted" style={{ marginTop: 0 }}>
                  {price(buying.price_minor)} — one payment, lifetime access to this course.
                </p>
                <Note tone="teal">
                  <strong>Development payment provider.</strong> No card details are collected or stored.
                </Note>
                {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
                <div className="row" style={{ marginTop: 14 }}>
                  <Action label={`Pay ${price(buying.price_minor)}`} onClick={async () => {
                    setErr('')
                    try {
                      const o = await client.post('/checkout/orders', { courseId: buying.id })
                      await client.post(`/checkout/orders/${o.orderId}/confirm`, {})
                      toast('You are enrolled')
                      setBuying(null)
                      mine.reload()
                    } catch (e: any) { setErr(e.message) }
                  }} />
                  <button className="btn ghost" onClick={() => setBuying(null)}>Cancel</button>
                </div>
              </Modal>
            )}
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function CourseView() {
  const { param, go } = useSession()
  const q = useLoad(() => client.get(`/student/courses/${param}`), [param])
  const [tab, setTab] = useState<'lessons' | 'textbook' | 'recordings' | 'materials' | 'quizzes' | 'assignments'>('lessons')

  return (
    <Page q={q} what="Opening the course">
      {(d: any) => (
        <>
          <Crumb to="mycourses" label="My courses" here={d.course.title.toUpperCase()} />
          <Head title={d.course.title} sub={d.course.subtitle} />
          <div className="grid g4">
            <Stat small k="Progress" v={`${d.completion.percent}%`} d={`${d.completion.done} of ${d.completion.total}`} />
            <Stat small k="Recordings" v={d.recordings.length} />
            <Stat small k="Quizzes" v={d.quizzes.length} />
            <Stat small k="Assignments" v={d.assignments.length} />
          </div>

          <div className="filters" style={{ marginTop: 20 }}>
            {([['lessons', 'Lessons'], ['textbook', 'Textbook'], ['recordings', 'Recordings'],
               ['materials', 'Materials'], ['quizzes', 'Quizzes'], ['assignments', 'Assignments']] as const)
              .map(([k, label]) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>{label}</button>
              ))}
          </div>

          {tab === 'lessons' && (
            <div className="outline">
              {d.modules.map((m: any) => (
                <div className="mod" key={m.id}>
                  <div className="modhead" style={{ cursor: 'default' }}>
                    <span className="n">{String(m.position).padStart(2, '0')}</span>
                    <span>{m.title}</span>
                    <span className="spacer" />
                    <span className="count">{m.lessons.length} lessons</span>
                  </div>
                  {m.lessons.map((l: any) => (
                    <button className="lessonrow" key={l.id} onClick={() => go('lesson', l.id)}>
                      <span>{l.status === 'completed' ? '✓' : l.status === 'in_progress' ? '▸' : '·'}</span>
                      <span>{l.title}</span>
                      {l.exercises > 0 ? <span className="tchip lab" style={{ marginLeft: 8 }}>{l.exercises} exercise{l.exercises === 1 ? '' : 's'}</span> : null}
                      <span className="spacer" />
                      <span className="mins">{l.minutes} min</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === 'textbook' && (d.textbook
            ? <div className="card">
                <h3>{d.textbook.title}</h3>
                <div className="sub">{d.textbook.edition} · {d.textbook.chapters} chapters</div>
                <div style={{ marginTop: 14 }}>
                  <button className="btn gold sm" onClick={() => go('textbook', d.textbook.id)}>Open the textbook</button>
                </div>
              </div>
            : <Empty title="No textbook for this course" />)}

          {tab === 'recordings' && (
            <div className="lib">
              {d.recordings.map((r: any) => (
                <button className="libcard" key={r.id} onClick={() => go('recording', r.id)}>
                  <div className="thumb"><div className="play">▶</div>
                    <span className="dur">{duration(r.duration_seconds)}</span></div>
                  <div className="pad">
                    <span className="tchip vid">Recording</span><h4>{r.title}</h4>
                    <div className="meta">{fmtDate(r.recorded_on)} {r.status === 'completed' ? <Pill tone="ok">Watched</Pill> : null}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {tab === 'materials' && (
            <Table head={['Material', 'Kind', '']}>
              {d.materials.map((m: any) => (
                <tr key={m.id}>
                  <td><strong>{m.title}</strong><div className="tiny muted">{m.description}</div></td>
                  <td><Pill>{m.kind}</Pill></td>
                  <td><DownloadButton materialId={m.id} /></td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'quizzes' && (
            <Table head={['Quiz', 'Questions', 'Best score', 'Attempts', '']}>
              {d.quizzes.map((qz: any) => (
                <tr key={qz.id}>
                  <td><strong>{qz.title}</strong><div className="tiny muted">{qz.description}</div></td>
                  <td className="mono">{qz.questions}</td>
                  <td className="mono">{qz.best_score != null ? `${qz.best_score}/${qz.out_of}` : '—'}</td>
                  <td className="mono">{qz.attempts}/{qz.max_attempts}</td>
                  <td><button className="btn ghost sm" onClick={() => go('quiz', qz.id)}>
                    {qz.attempts ? 'Try again' : 'Start'}
                  </button></td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'assignments' && (
            <Table head={['Assignment', 'Due', 'Status', '']}>
              {d.assignments.map((a: any) => (
                <tr key={a.id}>
                  <td><strong>{a.title}</strong></td>
                  <td className="small">{fmtDate(a.due_at)}</td>
                  <td>{a.submission_status === 'graded' ? <Pill tone="ok">{a.score}/{a.max_score}</Pill>
                    : a.submission_status ? <Pill tone="wait">Submitted</Pill>
                    : <Pill tone="mute">Not started</Pill>}</td>
                  <td><button className="btn ghost sm" onClick={() => go('assignment', a.id)}>Open</button></td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </Page>
  )
}

function DownloadButton({ materialId }: { materialId: string }) {
  const { toast } = useSession()
  return (
    <Action small kind="ghost" label="Download" onClick={async () => {
      // The link is minted per request and expires. Nothing stores a URL.
      const r = await client.get(`/student/materials/${materialId}/link`)
      toast(`Signed link ready — expires ${new Date(r.expiresAt).toLocaleTimeString('en-GB')}`)
      window.open(r.url, '_blank', 'noopener')
    }} />
  )
}

function LessonView() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/lessons/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="mycourses" label="My courses" here={d.lesson.title.toUpperCase()} />
          <Head title={d.lesson.title} sub={`${d.lesson.module} · ${d.lesson.est_minutes} min read`} />
          <div className="doc"><Blocks blocks={d.lesson.body} /></div>

          {d.exercises.length ? (
            <>
              <Head title="Try it yourself" sub="Practice runs in your browser and is never marked" />
              {d.exercises.map((e: any) => (
                <div className="unit" key={e.id}>
                  <div className="num">{e.status === 'completed' ? '✓' : '▧'}</div>
                  <div className="body">
                    <div className="t">{e.title}</div>
                    <div className="m">{e.brief}</div>
                  </div>
                  <button className="btn ghost sm" onClick={() => go('exercise', e.id)}>
                    {e.status === 'completed' ? 'Open again' : 'Try it'}
                  </button>
                </div>
              ))}
            </>
          ) : null}

          <div className="row" style={{ marginTop: 20 }}>
            <Action label="Mark as done" onClick={async () => {
              await client.post(`/student/lessons/${param}/progress`, { percent: 100, seconds: 120 })
              toast('Marked as done')
              if (d.next) go('lesson', d.next.id); else q.reload()
            }} />
            {d.next ? <button className="btn ghost" onClick={() => go('lesson', d.next.id)}>
              Next: {d.next.title}
            </button> : null}
          </div>

          {d.lesson.version_no > 1 ? (
            <Note>
              You are reading version {d.lesson.version_no}, updated {fmtAgo(d.lesson.published_at).toLowerCase()}.
              Brolly improves lessons without you needing to update anything.
            </Note>
          ) : null}
        </>
      )}
    </Page>
  )
}

function TextbookView() {
  const { param, go } = useSession()
  const q = useLoad(() => client.get(`/student/textbooks/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title={d.textbook.title} sub={d.textbook.edition} />
          <div className="outline">
            {d.chapters.map((ch: any) => (
              <div className="mod" key={ch.id}>
                <div className="modhead" style={{ cursor: 'default' }}>
                  <span className="n">{String(ch.position).padStart(2, '0')}</span>
                  <span>{ch.title}</span>
                  <span className="spacer" />
                  <span className="count">{ch.sections.length} sections</span>
                </div>
                {ch.sections.map((s: any) => (
                  <button className="lessonrow" key={s.id} onClick={() => go('section', s.id)}>
                    <span>▤</span><span>{s.title}</span><span className="spacer" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </Page>
  )
}

function SectionView() {
  const { param } = useSession()
  const q = useLoad(() => client.get(`/student/sections/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <div className="crumb-l">{d.section.textbook} / {d.section.chapter}</div>
          <Head title={d.section.title} />
          <div className="doc"><Blocks blocks={d.section.body} /></div>
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function ExerciseView() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/exercises/${param}`), [param])
  const [hints, setHints] = useState(0)
  const [showSolution, setShowSolution] = useState(false)

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title={d.exercise.title} sub={`${d.exercise.level} · ${d.exercise.lesson} · never marked`} />
          <Note tone="teal">
            <strong>This is practice.</strong> Run it as often as you like. Nothing is sent to a teacher and
            nothing counts towards a grade.
          </Note>

          <div className="grid g2" style={{ marginTop: 14 }}>
            <div>
              <div className="card" style={{ marginBottom: 14 }}>
                <h3>What to do</h3>
                <p className="small" style={{ margin: '8px 0 0' }}>{d.exercise.brief}</p>
              </div>
              <div className="card">
                <h3>Stuck?</h3>
                {(d.exercise.hints ?? []).slice(0, hints).map((h: string, i: number) => (
                  <div className="unit" key={i} style={{ marginBottom: 7 }}>
                    <div className="num">{i + 1}</div><div className="body"><div className="m">{h}</div></div>
                  </div>
                ))}
                {hints < (d.exercise.hints ?? []).length
                  ? <button className="btn ghost sm" onClick={() => setHints(h => h + 1)}>
                      {hints === 0 ? 'Show a hint' : 'Show a bigger hint'}
                    </button>
                  : !showSolution
                    ? <button className="btn ghost sm" onClick={() => setShowSolution(true)}>Show the answer</button>
                    : <pre className="console" style={{ borderRadius: 10, marginTop: 8 }}>{d.exercise.solution}</pre>}
                <div className="tiny muted" style={{ marginTop: 8 }}>
                  Looking at the answer is fine here. Practice is for learning, not for marks.
                </div>
              </div>
            </div>

            <CodeRunner
              filename="practice.py"
              starter={d.exercise.starterCode}
              tests={d.exercise.tests}
              onRun={async (code, outputs, stdout) => {
                const r = await client.post(`/student/exercises/${param}/run`, { code, outputs, stdout })
                if (r.solved) toast('Solved — nicely done')
                return r
              }}
              footer={<button className="btn ghost" onClick={() => go('lesson', d.exercise.lessonId)}>
                Back to the lesson
              </button>}
            />
          </div>
        </>
      )}
    </Page>
  )
}

/** Python runs in this tab; the source rules are re-checked on the server. */
function CodeRunner({ filename, starter, tests, onRun, footer }: {
  filename: string
  starter: string
  tests: Array<{ name: string; stdin?: string }>
  onRun: (code: string, outputs: Record<string, string>, stdout: string) => Promise<any>
  footer?: React.ReactNode
}) {
  const [code, setCode] = useState(starter)
  const [out, setOut] = useState<React.ReactNode>('Press Run. Get it wrong as many times as you like.')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('saved just now')

  useEffect(() => {
    setSaved('saving…')
    const t = setTimeout(() => setSaved('saved just now'), 500)
    return () => clearTimeout(t)
  }, [code])

  const execute = async () => {
    setBusy(true)
    setOut(<span className="dim">Starting Python…</span>)
    try {
      await loadPython()
      setOut(<span className="dim">Running…</span>)
      const { outputs, stdout, stderr } = await runTests(code, tests)
      if (stderr) {
        setOut(<>
          {stdout ? <>{stdout}{'\n'}</> : null}
          <span className="fail">{stderr}</span>{'\n'}
          <span className="dim">Read the last line first — it usually names what broke.</span>
        </>)
        setBusy(false)
        return
      }
      const r = await onRun(code, outputs, stdout)
      const results: any[] = r.results ?? []
      setOut(<>
        {stdout ? <>{stdout}{'\n'}</> : null}
        {results.map((t: any, i: number) => (
          <span key={i} className={t.passed ? 'pass' : 'fail'}>
            {t.passed ? '✓' : '✗'} {t.name}{i < results.length - 1 ? '   ·   ' : ''}
          </span>
        ))}
        {results.some((t: any) => !t.passed) ? '\n' : null}
        {results.filter((t: any) => !t.passed).map((t: any, i: number) => (
          <span key={i} className="dim">{t.detail}{'\n'}</span>
        ))}
        {r.solved ? <span className="pass">{'\n'}All tests passed.</span> : null}
      </>)
    } catch (e: any) {
      setOut(<span className="fail">{e.message ?? 'Could not run that.'}</span>)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="editor">
        <div className="bar2">
          <span className="fn">{filename}</span><span className="spacer" /><span className="saved">{saved}</span>
        </div>
        <textarea value={code} onChange={e => setCode(e.target.value)} spellCheck={false} />
        <div className="console">{busy ? <><span className="spinner" /> </> : null}{out}</div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn gold" disabled={busy} onClick={execute}>
          {busy ? <><span className="spinner" /> Running</> : 'Run'}
        </button>
        {footer}
      </div>
      {tests.length ? (
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Checked against {tests.length} hidden test{tests.length === 1 ? '' : 's'}. Python runs in this browser
          tab — nothing is installed, and the rules about how you solve it are checked on our servers.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function QuizView() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/quizzes/${param}`), [param])
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [result, setResult] = useState<any>(null)
  const [err, setErr] = useState('')

  const loaded = q.data as any
  useEffect(() => {
    if (!loaded) return
    setAttemptId(loaded.openAttemptId)
    const seed: Record<string, number> = {}
    for (const a of loaded.savedAnswers ?? []) if (a.choice_index != null) seed[a.question_id] = a.choice_index
    setAnswers(seed)
  }, [loaded?.quiz?.id, loaded?.openAttemptId])

  return (
    <Page q={q}>
      {(d: any) => {
        if (result) {
          return (
            <>
              <Head title={d.quiz.title} sub="Your result" />
              <div className="lockbox">
                <Pill tone={result.passed ? 'ok' : 'bad'}>{result.passed ? 'Passed' : 'Not passed'}</Pill>
                <div className="big">{result.percent}%</div>
                <p className="muted small">
                  {result.score} out of {result.maxScore} · pass mark {d.quiz.pass_mark_pct}%
                </p>
              </div>
              <Head title="Your answers" sub="With the right answer and why" />
              {result.review.map((r: any) => (
                <div className="qcard" key={r.position}>
                  <div className="qn">Question {r.position}</div>
                  <div className="qt">{r.text}</div>
                  {(r.options ?? []).map((o: string, oi: number) => (
                    <div key={oi} className={'opt' + (oi === r.answer_index ? ' right' : oi === r.choice_index ? ' wrong' : '')}>
                      <span className="l">{'ABCD'[oi]}</span><span>{o}</span>
                      {oi === r.answer_index ? <span className="tiny muted" style={{ marginLeft: 'auto' }}>correct</span> : null}
                    </div>
                  ))}
                  {r.explanation ? <div className="tiny muted" style={{ marginTop: 8 }}>{r.explanation}</div> : null}
                </div>
              ))}
              <button className="btn ghost" onClick={() => go('course', d.quiz.course_id)}>Back to the course</button>
            </>
          )
        }

        if (!attemptId) {
          return (
            <>
              <Head title={d.quiz.title} sub={d.quiz.description} />
              <div className="lockbox">
                <Pill tone="wait">{d.questions.length} questions · pass mark {d.quiz.pass_mark_pct}%</Pill>
                <div className="big" style={{ fontSize: 30 }}>Ready?</div>
                <p className="muted small" style={{ maxWidth: '46ch', margin: '0 auto 18px' }}>
                  {d.attemptsLeft} of {d.quiz.max_attempts} attempts left. Your answers save as you go, and the
                  result is immediate — nothing here waits on a teacher.
                </p>
                {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
                <Action label="Start the quiz" onClick={async () => {
                  setErr('')
                  try {
                    const r = await client.post(`/student/quizzes/${param}/start`)
                    setAttemptId(r.attemptId)
                  } catch (e: any) { setErr(e.message) }
                }} />
              </div>
              {d.attempts.length ? (
                <>
                  <Head title="Earlier attempts" />
                  <Table head={['Attempt', 'Score', 'Result', 'When']}>
                    {d.attempts.filter((a: any) => a.status === 'submitted').map((a: any) => (
                      <tr key={a.id}>
                        <td className="mono">{a.attempt_no}</td>
                        <td className="mono">{a.score}/{a.max_score}</td>
                        <td>{a.passed ? <Pill tone="ok">Passed</Pill> : <Pill tone="bad">Not passed</Pill>}</td>
                        <td className="small muted">{fmtAgo(a.submitted_at)}</td>
                      </tr>
                    ))}
                  </Table>
                </>
              ) : null}
            </>
          )
        }

        const answered = Object.keys(answers).length
        return (
          <>
            <div className="row" style={{ alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2>{d.quiz.title}</h2>
                <div className="tiny muted">{answered} of {d.questions.length} answered · answers save as you go</div>
              </div>
            </div>
            {d.questions.map((qq: any) => (
              <div className="qcard" key={qq.id}>
                <div className="qn">Question {qq.position} · {qq.marks} mark{qq.marks === 1 ? '' : 's'}</div>
                <div className="qt">{qq.text}</div>
                {(qq.options ?? []).map((o: string, oi: number) => (
                  <button key={oi} className={'opt' + (answers[qq.id] === oi ? ' sel' : '')}
                    onClick={async () => {
                      setAnswers(a => ({ ...a, [qq.id]: oi }))
                      await client.post(`/student/quiz-attempts/${attemptId}/answer`,
                        { questionId: qq.id, choiceIndex: oi }).catch(() => {})
                    }}>
                    <span className="l">{'ABCD'[oi]}</span><span>{o}</span>
                  </button>
                ))}
              </div>
            ))}
            {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
            <div className="row" style={{ marginTop: 14 }}>
              <div style={{ flex: 1 }} />
              <Action label="Submit the quiz" onClick={async () => {
                setErr('')
                try {
                  const r = await client.post(`/student/quiz-attempts/${attemptId}/submit`)
                  setResult(r); toast(r.passed ? 'Passed' : 'Have another go')
                } catch (e: any) { setErr(e.message) }
              }} />
            </div>
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function LiveClasses() {
  const { toast } = useSession()
  const q = useLoad(() => client.get('/student/live'))
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const upcoming = d.sessions.filter((s: any) => s.status === 'scheduled' || s.status === 'live')
        const past = d.sessions.filter((s: any) => s.status === 'ended')
        return (
          <>
            <Head title="Live classes" sub="Taught by a Brolly teacher. The recording appears afterwards." />
            {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}

            {upcoming.length === 0 ? <Empty title="Nothing scheduled right now"
              detail="New sessions appear here as soon as they are scheduled." /> : (
              <div className="grid g2">
                {upcoming.map((s: any) => (
                  <div className="card" key={s.id}>
                    <div className="row tight">
                      <span className="tchip lab">{s.status === 'live' ? 'Live now' : 'Upcoming'}</span>
                      {s.my_status === 'registered' ? <Pill tone="ok">Registered</Pill> : null}
                    </div>
                    <h3 style={{ marginTop: 7 }}>{s.title}</h3>
                    <div className="sub">{s.course} · with {s.teacher}</div>
                    <div className="sub" style={{ marginTop: 6 }}>{fmtDateTime(s.starts_at)}</div>
                    <p className="small muted" style={{ marginTop: 8 }}>{s.description}</p>
                    <div className="row tight" style={{ marginTop: 12 }}>
                      <Action small label="Join the class" onClick={async () => {
                        setErr('')
                        try {
                          const r = await client.post(`/student/live/${s.id}/join`)
                          toast('Opening the room')
                          window.open(r.meetingUrl, '_blank', 'noopener')
                        } catch (e: any) { setErr(e.message) }
                      }} />
                      {s.my_status !== 'registered' ? (
                        <Action small kind="ghost" label="Remind me" onClick={async () => {
                          await client.post(`/student/live/${s.id}/register`)
                          toast('You are registered'); q.reload()
                        }} />
                      ) : null}
                    </div>
                    <p className="tiny muted" style={{ marginTop: 10 }}>
                      The room opens fifteen minutes before the start time.
                    </p>
                  </div>
                ))}
              </div>
            )}

            {past.length ? (
              <>
                <Head title="Past classes" />
                <Table head={['Class', 'Course', 'When', 'You']}>
                  {past.map((s: any) => (
                    <tr key={s.id}>
                      <td><strong>{s.title}</strong></td>
                      <td className="small">{s.course}</td>
                      <td className="small muted">{fmtDateTime(s.starts_at)}</td>
                      <td>{s.my_status === 'attended' ? <Pill tone="ok">Attended</Pill>
                        : <Pill tone="mute">Missed</Pill>}</td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : null}
          </>
        )
      }}
    </Page>
  )
}

function Recordings() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/student/recordings'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Recorded tutorials" sub="Every live class, recorded and kept" />
          {d.recordings.length === 0
            ? <Empty title="No recordings yet" detail="They appear here once your first live class is done." />
            : (
              <div className="lib">
                {d.recordings.map((r: any) => (
                  <button className="libcard" key={r.id} onClick={() => go('recording', r.id)}>
                    <div className="thumb"><div className="play">▶</div>
                      <span className="dur">{duration(r.duration_seconds)}</span>
                      {r.percent > 0 ? <div className="prog"><i style={{ width: `${r.percent}%` }} /></div> : null}
                    </div>
                    <div className="pad">
                      <span className="tchip vid">Recording</span><h4>{r.title}</h4>
                      <div className="meta">{r.course} · {fmtDate(r.recorded_on)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
        </>
      )}
    </Page>
  )
}

function RecordingView() {
  const { param, toast } = useSession()
  const q = useLoad(() => client.get(`/student/recordings/${param}`), [param])
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)

  const loaded = q.data as any
  useEffect(() => {
    if (!loaded) return
    setPos(Math.round((loaded.recording.percent ?? 0) / 100 * loaded.recording.duration_seconds))
  }, [loaded?.recording?.id])

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setPos(p => p + 1), 1000)
    return () => clearInterval(t)
  }, [playing])

  return (
    <Page q={q}>
      {(d: any) => {
        const pct = Math.min(100, Math.round(pos / (d.recording.duration_seconds || 1) * 100))
        return (
          <>
            <Crumb to="recordings" label="Recordings" here={d.recording.title.toUpperCase()} />
            <Head title={d.recording.title} sub={`${d.recording.course} · ${fmtDate(d.recording.recorded_on)}`} />
            <div className="grid g2" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
              <div>
                <div className="player" onClick={() => setPlaying(p => !p)} style={{ cursor: 'pointer' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 40 }}>{playing ? '❚❚' : '▶'}</div>
                    <div className="tiny" style={{ marginTop: 6 }}>{playing ? 'Playing' : 'Tap to play'}</div>
                  </div>
                </div>
                <div className="pbar">
                  <span>{mmss(pos)}</span>
                  <div className="track" onClick={e => {
                    const r = (e.target as HTMLElement).getBoundingClientRect()
                    setPos(Math.round((e.clientX - r.left) / r.width * d.recording.duration_seconds))
                  }}><i style={{ width: `${pct}%` }} /></div>
                  <span>{duration(d.recording.duration_seconds)}</span>
                </div>
                <div className="row" style={{ marginTop: 14 }}>
                  <Action label={pct >= 95 ? 'Mark as watched' : `Save progress (${pct}%)`} onClick={async () => {
                    await client.post(`/student/recordings/${param}/progress`,
                      { percent: pct >= 95 ? 100 : pct, seconds: pos })
                    toast('Progress saved'); q.reload()
                  }} />
                </div>
                <p className="small muted" style={{ marginTop: 14 }}>{d.recording.description}</p>
              </div>

              <div className="card">
                <h3>How this video reaches you</h3>
                <div className="sub" style={{ marginBottom: 10 }}>Worth knowing, because it is the security model</div>
                <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
                  <li>The file lives in object storage under a content-addressed key.</li>
                  <li>No row anywhere holds a usable URL.</li>
                  <li>A link is signed for you, and expires in fifteen minutes.</li>
                  <li>The signature is checked before you get here at all.</li>
                </ul>
                {d.media ? (
                  <div className="slip" style={{ marginTop: 12 }}>
                    <div className="kv">Expires <b>{new Date(d.media.expiresAt).toLocaleTimeString('en-GB')}</b></div>
                    <div className="kv">Size <b>{(d.media.bytes / 1_000_000).toFixed(1)} MB</b></div>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Assignments() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/student/assignments'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Assignments" sub="Marked by your teacher, with feedback" />
          {d.assignments.length === 0
            ? <Empty title="No assignments yet" />
            : (
              <Table head={['Assignment', 'Course', 'Due', 'Status', 'Score', '']}>
                {d.assignments.map((a: any) => (
                  <tr key={a.id}>
                    <td><strong>{a.title}</strong></td>
                    <td className="small">{a.course}</td>
                    <td className="small">{fmtDate(a.due_at)}</td>
                    <td>{a.submission_status === 'graded' ? <Pill tone="ok">Graded</Pill>
                      : a.submission_status === 'returned' ? <Pill tone="wait">Sent back</Pill>
                      : a.submission_status ? <Pill tone="wait">Submitted</Pill>
                      : <Pill tone="mute">Not started</Pill>}</td>
                    <td className="mono">{a.score != null ? `${a.score}/${a.max_score}` : '—'}</td>
                    <td><button className="btn ghost sm" onClick={() => go('assignment', a.id)}>Open</button></td>
                  </tr>
                ))}
              </Table>
            )}
        </>
      )}
    </Page>
  )
}

function AssignmentView() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/assignments/${param}`), [param])
  const [body, setBody] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const s = d.submission
        const locked = s?.status === 'graded' && !d.assignment.allow_resubmit
        return (
          <>
            <Crumb to="assignments" label="Assignments" here={d.assignment.title.toUpperCase()} />
            <Head title={d.assignment.title} sub={`${d.assignment.course} · due ${fmtDate(d.assignment.due_at)}`} />

            {s?.status === 'graded' ? (
              <Note tone="teal">
                <strong>Your teacher gave this {s.score} out of {d.assignment.max_score}.</strong>
                {s.feedback ? ` ${s.feedback}` : ''}
              </Note>
            ) : s?.status === 'returned' ? (
              <Note><strong>Your teacher asked for another go.</strong> {s.feedback}</Note>
            ) : null}

            <div className="grid g2">
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>What to do</h3>
                  <div className="doc" style={{ boxShadow: 'none', padding: 0, marginTop: 8, maxWidth: 'none' }}>
                    <Blocks blocks={d.assignment.instructions} />
                  </div>
                </div>
                <div className="card">
                  <h3>How it is marked</h3>
                  <div className="sub" style={{ marginBottom: 10 }}>You can see this before you start</div>
                  <table className="rubric">
                    <tbody>
                      {(d.assignment.rubric ?? []).map((r: any) => (
                        <tr key={r.key}>
                          <td>{r.label}</td>
                          <td className="mono muted" style={{ textAlign: 'right' }}>
                            {s?.rubric_scores?.[r.key] != null ? `${s.rubric_scores[r.key]} / ${r.max}` : r.max}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <h3>Your answer</h3>
                <Field label="Write your answer">
                  <textarea value={body ?? s?.body ?? ''} onChange={e => setBody(e.target.value)}
                    style={{ minHeight: 120 }} disabled={locked} />
                </Field>
                <Field label="Code (optional)">
                  <textarea value={code ?? s?.code ?? ''} onChange={e => setCode(e.target.value)}
                    style={{ minHeight: 140, fontFamily: 'var(--mono)', fontSize: 13 }} disabled={locked} />
                </Field>
                {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
                {locked
                  ? <p className="tiny muted">This has been graded and cannot be resubmitted.</p>
                  : <Action label={s ? 'Update my submission' : 'Submit'} onClick={async () => {
                      setErr('')
                      try {
                        await client.post(`/student/assignments/${param}/submit`,
                          { body: body ?? s?.body ?? '', code: code ?? s?.code ?? '' })
                        toast('Submitted to your teacher'); q.reload()
                      } catch (e: any) { setErr(e.message) }
                    }} />}
              </div>
            </div>
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

const BADGES: Record<string, string> = {
  first_lesson: 'First lesson', first_exercise: 'First exercise',
  quiz_passed: 'Quiz passed', course_complete: 'Course finished',
}

function Progress() {
  const q = useLoad(() => client.get('/student/progress'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="My progress" sub="Only you and your teachers can see this" />
          <div className="grid g4">
            <Stat small k="Time learning" v={`${d.stats.minutes} min`} />
            <Stat small k="Exercise attempts" v={d.stats.exercise_attempts} d="Never marked" />
            <Stat small k="Assignments graded" v={d.stats.graded} />
            <Stat small k="Average score" v={d.stats.avg_assignment != null ? `${d.stats.avg_assignment}/10` : '—'} />
          </div>

          <Head title="Course by course" />
          {d.courses.map((c: any) => (
            <div className="card" key={c.id} style={{ marginBottom: 12 }}>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <h3>{c.title}</h3>
                <span style={{ flex: 1 }} />
                {c.status === 'completed' ? <Pill tone="ok">Completed</Pill> : <Pill tone="wait">In progress</Pill>}
              </div>
              <div className="sub">{c.done} of {c.total} things finished</div>
              <div style={{ margin: '12px 0' }}><Bar v={c.completion} /></div>
              {c.quiz?.taken ? (
                <div className="tiny muted">
                  {c.quiz.taken} quizzes taken · average {c.quiz.avg_pct}% · {c.quiz.passed} passed
                </div>
              ) : null}
            </div>
          ))}

          {d.badges.length ? (
            <>
              <Head title="Badges" />
              <div className="row">
                {Object.entries(BADGES).map(([key, label]) => {
                  const earned = d.badges.some((b: any) => b.badge_key === key)
                  return (
                    <div className="card" key={key}
                      style={{ flex: 1, minWidth: 140, textAlign: 'center', opacity: earned ? 1 : 0.45 }}>
                      <div style={{ fontSize: 26 }}>{earned ? '★' : '☆'}</div>
                      <div className="small" style={{ fontWeight: 600, marginTop: 4 }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}

          <Head title="Recent activity" />
          <Table head={['What', 'Course', 'When']}>
            {d.recent.map((r: any, i: number) => (
              <tr key={i}>
                <td className="small">{r.node_type} — {r.status === 'completed' ? 'finished' : 'in progress'}</td>
                <td className="small">{r.course}</td>
                <td className="small muted">{fmtAgo(r.last_activity_at)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Page>
  )
}

function Certificates() {
  const { me, toast } = useSession()
  const q = useLoad(() => client.get('/student/certificates'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Certificates" sub="Issued when you finish a course" />
          {d.certificates.length === 0
            ? <Empty title="No certificates yet" detail="Finish a course and one appears here, with a code anyone can verify." />
            : (
              <div className="grid g2">
                {d.certificates.map((c: any) => (
                  <div className="cert" key={c.id}>
                    <div className="tiny" style={{ letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--slate)' }}>
                      {me.brand.name}
                    </div>
                    <h3>{c.course}</h3>
                    <div className="muted">awarded to <strong>{me.user.fullName}</strong></div>
                    {c.final_score ? <div className="muted small" style={{ marginTop: 6 }}>Final score {c.final_score}%</div> : null}
                    <div className="serial">{c.serial} · {fmtDate(c.issued_at)}</div>
                    <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
                      <button className="btn ghost sm" onClick={() => {
                        navigator.clipboard?.writeText(c.verification_code)
                        toast('Verification code copied')
                      }}>Copy verification code</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </>
      )}
    </Page>
  )
}

function Profile() {
  const { me, toast, reload } = useSession()
  const q = useLoad(() => client.get('/student/profile'))
  const [form, setForm] = useState<any>(null)
  const [name, setName] = useState(me.user.fullName)

  return (
    <Page q={q}>
      {(d: any) => {
        const f = form ?? {
          gradeLevel: d.profile.grade_level, guardianName: d.profile.guardian_name,
          guardianEmail: d.profile.guardian_email, guardianPhone: d.profile.guardian_phone,
        }
        return (
          <>
            <Head title="My profile" sub={me.user.email} />
            <div className="grid g2">
              <div className="card">
                <h3>About me</h3>
                <div className="sub" style={{ marginBottom: 12 }}>Only you and Brolly can see this</div>
                <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} /></Field>
                <Field label="Email" help="Sign in with this."><input value={d.profile.email} readOnly /></Field>
                <Field label="School year"><input value={f.gradeLevel ?? ''} onChange={e => setForm({ ...f, gradeLevel: e.target.value })} /></Field>
                <Action label="Save" onClick={async () => {
                  await client.patch('/me', { fullName: name })
                  await client.patch('/student/profile', f)
                  toast('Saved'); await reload(); q.reload()
                }} />
              </div>
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>Parent or guardian</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>
                    Used for consent and for anything a parent needs to know. Your teacher cannot see it.
                  </div>
                  <Field label="Name"><input value={f.guardianName ?? ''} onChange={e => setForm({ ...f, guardianName: e.target.value })} /></Field>
                  <Field label="Email"><input value={f.guardianEmail ?? ''} onChange={e => setForm({ ...f, guardianEmail: e.target.value })} /></Field>
                  <Field label="Phone"><input value={f.guardianPhone ?? ''} onChange={e => setForm({ ...f, guardianPhone: e.target.value })} /></Field>
                  <div className="row tight" style={{ marginTop: 4 }}>
                    <Pill tone={d.profile.consent_status === 'pending' ? 'wait' : 'ok'}>
                      Consent: {d.profile.consent_status.replace('_', ' ')}
                    </Pill>
                  </div>
                </div>
                <OrderHistory />
              </div>
            </div>
          </>
        )
      }}
    </Page>
  )
}

function OrderHistory() {
  const q = useLoad(() => client.get('/student/orders'))
  return (
    <div className="card">
      <h3>My purchases</h3>
      <div className="sub" style={{ marginBottom: 12 }}>No card details are ever stored</div>
      <Page q={q}>
        {(d: any) => d.orders.length === 0
          ? <p className="muted small">Nothing bought yet.</p>
          : (
            <>
              {d.orders.map((o: any) => (
                <div key={o.id} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                  <div className="small" style={{ flex: 1 }}>
                    {o.course}
                    <div className="tiny muted mono">{o.provider} · {o.provider_ref}</div>
                  </div>
                  <div className="small mono">{price(o.amount_minor)}</div>
                  <Pill tone={o.status === 'paid' ? 'ok' : o.status === 'failed' ? 'bad' : 'wait'}>{o.status}</Pill>
                </div>
              ))}
            </>
          )}
      </Page>
    </div>
  )
}
