import React, { useState } from 'react'
import * as client from '../api.ts'
import {
  Action, Bar, Crumb, Empty, Field, Head, Modal, Note, Page, Pill, Stat, Table,
  fmtAgo, fmtDate, fmtDateTime, duration, useLoad, useSession,
} from '../ui.tsx'
import { Blocks } from '../blocks.tsx'

export default function TeacherPortal() {
  const { screen } = useSession()
  switch (screen) {
    case 'courses': return <Courses />
    case 'course': return <CourseView />
    case 'students': return <Students />
    case 'student': return <StudentView />
    case 'live': return <Live />
    case 'session': return <SessionView />
    case 'grading': return <Grading />
    case 'submission': return <SubmissionView />
    case 'recordings': return <Recordings />
    case 'profile': return <Profile />
    default: return <Overview />
  }
}

// ---------------------------------------------------------------------------

function Overview() {
  const { me, go } = useSession()
  const q = useLoad(() => client.get('/teacher/overview'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title={`Good day, ${me.user.fullName.split(' ')[0]}`}
            sub="Your courses, your students, and what is waiting for you." />
          <div className="grid g4">
            <Stat k="Students" v={d.stats.students} d="Across your courses" />
            <Stat k="To grade" v={d.stats.to_grade} d="Waiting on you" />
            <Stat k="Upcoming classes" v={d.stats.upcoming} d="Scheduled" />
            <Stat k="Classes delivered" v={d.stats.delivered} d="All time" />
          </div>

          <Head title="My courses" />
          <div className="grid g2">
            {d.courses.map((c: any) => (
              <div className="card" key={c.id}>
                <div className="row tight">
                  <span className="tchip mat">{c.subject}</span>
                  {c.role === 'lead' ? <Pill tone="ok">Lead teacher</Pill> : <Pill>Assistant</Pill>}
                </div>
                <h3 style={{ marginTop: 7 }}>{c.title}</h3>
                <div className="sub">{c.students} students · {c.lessons} lessons</div>
                <div style={{ marginTop: 12 }}>
                  <button className="btn ghost sm" onClick={() => go('course', c.id)}>Open course</button>
                </div>
              </div>
            ))}
          </div>

          {d.upcoming.length ? (
            <>
              <Head title="Coming up" />
              <Table head={['Class', 'Course', 'When', 'Registered', '']}>
                {d.upcoming.map((s: any) => (
                  <tr key={s.id} className="clickable" onClick={() => go('session', s.id)}>
                    <td><strong>{s.title}</strong></td>
                    <td className="small">{s.course}</td>
                    <td className="small">{fmtDateTime(s.starts_at)}</td>
                    <td className="mono">{s.registered}</td>
                    <td>{s.status === 'live' ? <Pill tone="bad">Live now</Pill> : <Pill tone="wait">Scheduled</Pill>}</td>
                  </tr>
                ))}
              </Table>
            </>
          ) : null}

          {d.recentGrading.length ? (
            <>
              <Head title="Waiting to be graded"
                right={<button className="btn gold" onClick={() => go('grading')}>Open grading</button>} />
              <Table head={['Student', 'Assignment', 'Course', 'Submitted']}>
                {d.recentGrading.map((s: any) => (
                  <tr key={s.id} className="clickable" onClick={() => go('submission', s.id)}>
                    <td><strong>{s.student}</strong></td>
                    <td className="small">{s.assignment}</td>
                    <td className="small">{s.course}</td>
                    <td className="small muted">{fmtAgo(s.submitted_at)}</td>
                  </tr>
                ))}
              </Table>
            </>
          ) : null}

          <Note>
            <strong>You reach a student through a course, not the other way round.</strong> Nobody is assigned
            to you permanently — if a student leaves your course, they leave your lists.
          </Note>
        </>
      )}
    </Page>
  )
}

function Courses() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/teacher/overview'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="My courses" sub="Courses Brolly has assigned you to" />
          <div className="grid g2">
            {d.courses.map((c: any) => (
              <div className="card" key={c.id}>
                <h3>{c.title}</h3>
                <div className="sub">{c.subtitle}</div>
                <div className="sub" style={{ marginTop: 8 }}>{c.students} students · {c.lessons} lessons</div>
                <div style={{ marginTop: 12 }}>
                  <button className="btn ghost sm" onClick={() => go('course', c.id)}>Open</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Page>
  )
}

function CourseView() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/teacher/courses/${param}`), [param])
  const [tab, setTab] = useState<'students' | 'outline' | 'assignments' | 'quizzes'>('students')
  const [creating, setCreating] = useState(false)

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="courses" label="My courses" here={d.course.title.toUpperCase()} />
          <Head title={d.course.title} sub={d.course.subtitle}
            right={<button className="btn gold" onClick={() => setCreating(true)}>New assignment</button>} />
          <div className="grid g4">
            <Stat small k="Students" v={d.students.length} />
            <Stat small k="Modules" v={d.modules.length} />
            <Stat small k="Assignments" v={d.assignments.length} />
            <Stat small k="To grade" v={d.assignments.reduce((a: number, x: any) => a + x.to_grade, 0)} />
          </div>

          <div className="filters" style={{ marginTop: 20 }}>
            {([['students', 'Students'], ['outline', 'Outline'],
               ['assignments', 'Assignments'], ['quizzes', 'Quizzes']] as const).map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>{label}</button>
            ))}
          </div>

          {tab === 'students' && (
            <Table head={['Student', 'Progress', 'Quiz average', 'Last seen', 'Status']}>
              {d.students.map((s: any) => (
                <tr key={s.id} className="clickable" onClick={() => go('student', s.id)}>
                  <td><strong>{s.full_name}</strong><div className="tiny muted mono">{s.email}</div></td>
                  <td style={{ minWidth: 150 }}><Bar v={s.total_nodes ? s.done / s.total_nodes * 100 : 0} /></td>
                  <td className="mono">{s.quiz_pct != null ? `${s.quiz_pct}%` : '—'}</td>
                  <td className={'small ' + (fmtAgo(s.last_seen) === 'Today' ? '' : 'muted')}>{fmtAgo(s.last_seen)}</td>
                  <td>{s.status === 'completed' ? <Pill tone="ok">Completed</Pill> : <Pill tone="wait">Learning</Pill>}</td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'outline' && (
            <div className="outline">
              {d.modules.map((m: any) => (
                <div className="mod" key={m.id}>
                  <div className="modhead" style={{ cursor: 'default' }}>
                    <span className="n">{String(m.position).padStart(2, '0')}</span>
                    <span>{m.title}</span><span className="spacer" />
                    <span className="count">{m.lessons.length} lessons</span>
                  </div>
                  {m.lessons.map((l: any) => (
                    <div className="lessonrow locked" key={l.id}>
                      <span>▤</span><span>{l.title}</span><span className="spacer" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === 'assignments' && (
            <Table head={['Assignment', 'Due', 'Submitted', 'To grade', '']}>
              {d.assignments.map((a: any) => (
                <tr key={a.id}>
                  <td><strong>{a.title}</strong></td>
                  <td className="small">{fmtDate(a.due_at)}</td>
                  <td className="mono">{a.submitted}</td>
                  <td>{a.to_grade > 0 ? <Pill tone="bad">{a.to_grade}</Pill> : <Pill tone="ok">None</Pill>}</td>
                  <td>{a.to_grade > 0 ? <button className="btn gold sm" onClick={() => go('grading')}>Grade</button> : null}</td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'quizzes' && (
            <Table head={['Quiz', 'Questions', 'Attempts', 'Average', 'Pass mark']}>
              {d.quizzes.map((z: any) => (
                <tr key={z.id}>
                  <td><strong>{z.title}</strong></td>
                  <td className="mono">{z.questions}</td>
                  <td className="mono">{z.attempts}</td>
                  <td style={{ width: 180 }}>{z.avg_pct != null ? <Bar v={z.avg_pct} /> : '—'}</td>
                  <td className="mono">{z.pass_mark_pct}%</td>
                </tr>
              ))}
            </Table>
          )}

          {creating && (
            <NewAssignment courseId={param!} modules={d.modules} onClose={() => setCreating(false)}
              onDone={n => { setCreating(false); toast(`Assigned to ${n} students`); q.reload() }} />
          )}
        </>
      )}
    </Page>
  )
}

function NewAssignment({ courseId, modules, onClose, onDone }: {
  courseId: string; modules: any[]; onClose: () => void; onDone: (n: number) => void
}) {
  const [f, setF] = useState({ title: '', brief: '', moduleId: '', maxScore: '10', dueAt: '' })
  const [err, setErr] = useState('')
  return (
    <Modal title="New assignment" onClose={onClose}>
      <Field label="Title"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })}
        placeholder="Build a marks calculator" /></Field>
      <Field label="What to do">
        <textarea value={f.brief} onChange={e => setF({ ...f, brief: e.target.value })}
          placeholder="Write a program that asks for five marks, then prints the total and the average." />
      </Field>
      <div className="grid g3" style={{ gap: 10 }}>
        <Field label="Module">
          <select value={f.moduleId} onChange={e => setF({ ...f, moduleId: e.target.value })}>
            <option value="">Whole course</option>
            {modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </Field>
        <Field label="Out of"><input value={f.maxScore} onChange={e => setF({ ...f, maxScore: e.target.value })} /></Field>
        <Field label="Due"><input type="date" value={f.dueAt} onChange={e => setF({ ...f, dueAt: e.target.value })} /></Field>
      </div>
      <Note tone="teal">
        <strong>Students see the rubric before they start.</strong> The default is the four-part Brolly rubric —
        does what was asked, sensible approach, readable, on time.
      </Note>
      {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
      <div className="row" style={{ marginTop: 14 }}>
        <Action label="Create assignment" onClick={async () => {
          setErr('')
          try {
            const r = await client.post('/teacher/assignments', {
              courseId, title: f.title, brief: f.brief,
              moduleId: f.moduleId || undefined, maxScore: Number(f.maxScore),
              dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined,
            })
            onDone(r.students)
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function Students() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/teacher/students'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="My students" sub="Everyone enrolled in a course you teach" />
          <Table head={['Student', 'Courses', 'Last seen', 'Waiting on you']}>
            {d.students.map((s: any) => (
              <tr key={s.id} className="clickable" onClick={() => go('student', s.id)}>
                <td><strong>{s.full_name}</strong><div className="tiny muted mono">{s.email}</div></td>
                <td className="small">{s.courses}</td>
                <td className={'small ' + (fmtAgo(s.last_seen) === 'Today' ? '' : 'muted')}>{fmtAgo(s.last_seen)}</td>
                <td>{s.awaiting_grade > 0 ? <Pill tone="bad">{s.awaiting_grade}</Pill> : <Pill tone="mute">—</Pill>}</td>
              </tr>
            ))}
          </Table>
          <Note>
            <strong>This list is derived, not stored.</strong> It is everyone enrolled in a course you teach —
            which means it changes on its own when enrolments change.
          </Note>
        </>
      )}
    </Page>
  )
}

function StudentView() {
  const { param, go } = useSession()
  const q = useLoad(() => client.get(`/teacher/students/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => {
        const stale = d.recent[0]
          ? Math.floor((Date.now() - new Date(d.recent[0].last_activity_at).getTime()) / 864e5) : 99
        return (
          <>
            <Crumb to="students" label="My students" here={d.student.full_name.toUpperCase()} />
            <Head title={d.student.full_name} sub={d.student.email} />
            <div className="grid g4">
              <Stat small k="Courses with me" v={d.courses.length} />
              <Stat small k="Quizzes taken" v={d.quizzes.length} />
              <Stat small k="Submissions" v={d.submissions.length} />
              <Stat small k="Last active" v={d.recent[0] ? fmtAgo(d.recent[0].last_activity_at) : 'Never'} />
            </div>

            {stale >= 14 ? (
              <Note>
                <strong>Nothing for {stale} days.</strong> Worth a nudge before they drift away — a
                B2C student has nobody at a school chasing them.
              </Note>
            ) : null}

            <Head title="Courses" />
            <Table head={['Course', 'Enrolled', 'Finished items', 'Status']}>
              {d.courses.map((c: any) => (
                <tr key={c.id}>
                  <td><strong>{c.title}</strong></td>
                  <td className="small">{fmtDate(c.enrolled_at)}</td>
                  <td className="mono">{c.done}</td>
                  <td>{c.status === 'completed' ? <Pill tone="ok">Completed</Pill> : <Pill tone="wait">Learning</Pill>}</td>
                </tr>
              ))}
            </Table>

            {d.quizzes.length ? (
              <>
                <Head title="Quiz results" />
                <Table head={['Quiz', 'Course', 'Score', 'Result', 'When']}>
                  {d.quizzes.map((z: any, i: number) => (
                    <tr key={i}>
                      <td className="small">{z.title}</td>
                      <td className="small">{z.course}</td>
                      <td className="mono">{z.score}/{z.max_score}</td>
                      <td>{z.passed ? <Pill tone="ok">Passed</Pill> : <Pill tone="bad">Not passed</Pill>}</td>
                      <td className="small muted">{fmtAgo(z.submitted_at)}</td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : null}

            {d.submissions.length ? (
              <>
                <Head title="Assignments" />
                <Table head={['Assignment', 'Status', 'Score', 'Submitted', '']}>
                  {d.submissions.map((s: any) => (
                    <tr key={s.id}>
                      <td className="small">{s.title}</td>
                      <td>{s.status === 'graded' ? <Pill tone="ok">Graded</Pill> : <Pill tone="wait">Waiting</Pill>}</td>
                      <td className="mono">{s.score != null ? `${s.score}/${s.max_score}` : '—'}</td>
                      <td className="small muted">{fmtAgo(s.submitted_at)}</td>
                      <td><button className="btn ghost sm" onClick={() => go('submission', s.id)}>Open</button></td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : null}

            <Note>
              <strong>What is not on this page.</strong> Their date of birth, their guardian's contact details,
              their practice attempts and anything about their other courses. The database has no policy giving
              a teacher those rows, so a query for them returns nothing.
            </Note>
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Grading() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/teacher/grading'))
  return (
    <Page q={q}>
      {(d: any) => {
        const waiting = d.submissions.filter((s: any) => s.status === 'submitted')
        return (
          <>
            <Head title="Grading" sub="Everything waiting on you, oldest first" />
            <div className="row tight" style={{ marginBottom: 14 }}>
              <span className={'chip' + (waiting.length ? ' warn' : '')}>{waiting.length} waiting</span>
              <span className="chip">{d.submissions.length - waiting.length} done</span>
            </div>
            {d.submissions.length === 0
              ? <Empty title="Nothing submitted yet" />
              : (
                <Table head={['Student', 'Assignment', 'Course', 'Submitted', 'Status', '']}>
                  {d.submissions.map((s: any) => (
                    <tr key={s.id}>
                      <td><strong>{s.student}</strong></td>
                      <td className="small">{s.assignment}</td>
                      <td className="small">{s.course}</td>
                      <td className="small muted">{fmtAgo(s.submitted_at)}</td>
                      <td>{s.status === 'graded' ? <Pill tone="ok">{s.score}/{s.max_score}</Pill>
                        : s.status === 'returned' ? <Pill tone="wait">Sent back</Pill>
                        : <Pill tone="wait">Waiting</Pill>}</td>
                      <td><button className={'btn sm ' + (s.status === 'submitted' ? 'gold' : 'ghost')}
                        onClick={() => go('submission', s.id)}>
                        {s.status === 'submitted' ? 'Grade' : 'Open'}
                      </button></td>
                    </tr>
                  ))}
                </Table>
              )}
          </>
        )
      }}
    </Page>
  )
}

function SubmissionView() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/teacher/submissions/${param}`), [param])
  const [scores, setScores] = useState<Record<string, number> | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const s = d.submission
        const rubric: any[] = s.rubric ?? []
        const current = scores ?? Object.fromEntries(rubric.map(r => [r.key, s.rubric_scores?.[r.key] ?? r.max]))
        const total = rubric.reduce((a, r) => a + (Number(current[r.key]) || 0), 0)

        return (
          <>
            <Crumb to="grading" label="Grading" here={s.student.toUpperCase()} />
            <Head title={s.student} sub={`${s.assignment} · submitted ${fmtDateTime(s.submitted_at)}`} />
            <div className="grid g2">
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>What was asked</h3>
                  <div className="doc" style={{ boxShadow: 'none', padding: 0, marginTop: 8, maxWidth: 'none' }}>
                    <Blocks blocks={s.instructions} />
                  </div>
                </div>
                {s.body ? (
                  <div className="card" style={{ marginBottom: 14 }}>
                    <h3>Their answer</h3>
                    <p className="small" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{s.body}</p>
                  </div>
                ) : null}
                {s.code ? (
                  <div className="editor">
                    <div className="bar2"><span className="fn">submission.py</span>
                      <span className="spacer" />
                      <span className="saved">attempt {s.attempt_no}</span></div>
                    <textarea readOnly value={s.code} />
                  </div>
                ) : null}
              </div>

              <div className="card">
                <h3>Rubric</h3>
                <div className="sub" style={{ marginBottom: 10 }}>The student saw this before starting</div>
                <table className="rubric">
                  <tbody>
                    {rubric.map(r => (
                      <tr key={r.key}>
                        <td>{r.label}</td>
                        <td className="mono muted">of {r.max}</td>
                        <td>
                          <input type="number" min={0} max={r.max} value={current[r.key]}
                            onChange={e => setScores({ ...current, [r.key]: Number(e.target.value) })} />
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td><strong>Total</strong></td><td />
                      <td className="mono"><strong>{total} / {s.max_score}</strong></td>
                    </tr>
                  </tbody>
                </table>
                <Field label="Feedback for the student" error={err}>
                  <textarea value={feedback ?? s.feedback ?? ''} onChange={e => setFeedback(e.target.value)}
                    placeholder="Neat and readable. Add a comment above the loop next time." />
                </Field>
                <div className="row">
                  <Action label="Send grade" onClick={async () => {
                    setErr('')
                    try {
                      await client.post(`/teacher/submissions/${param}/grade`,
                        { scores: current, feedback: feedback ?? s.feedback ?? '' })
                      toast('Grade sent'); go('grading')
                    } catch (e: any) { setErr(e.message) }
                  }} />
                  <Action kind="ghost" label="Ask for another go" onClick={async () => {
                    await client.post(`/teacher/submissions/${param}/grade`,
                      { action: 'return', feedback: feedback ?? '' })
                    toast('Sent back'); go('grading')
                  }} />
                </div>
                <p className="tiny muted" style={{ marginTop: 10 }}>
                  The student is notified either way, and sees exactly what you wrote here.
                </p>
              </div>
            </div>
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Live() {
  const { go, toast } = useSession()
  const q = useLoad(() => client.get('/teacher/live'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Live classes" sub="Scheduled by Brolly. You host them." />
          {d.sessions.length === 0
            ? <Empty title="No sessions scheduled" detail="Brolly schedules live classes and assigns you to them." />
            : (
              <Table head={['Class', 'Course', 'When', 'Registered', 'Attended', 'Status', '']}>
                {d.sessions.map((s: any) => (
                  <tr key={s.id}>
                    <td><strong>{s.title}</strong></td>
                    <td className="small">{s.course}</td>
                    <td className="small">{fmtDateTime(s.starts_at)}</td>
                    <td className="mono">{s.registered}/{s.enrolled}</td>
                    <td className="mono">{s.attended || '—'}</td>
                    <td>{s.status === 'live' ? <Pill tone="bad">Live</Pill>
                      : s.status === 'ended' ? <Pill tone="mute">Ended</Pill>
                      : <Pill tone="wait">Scheduled</Pill>}</td>
                    <td className="row tight">
                      <button className="btn ghost sm" onClick={() => go('session', s.id)}>Open</button>
                      {s.status === 'scheduled' ? (
                        <Action small label="Start" onClick={async () => {
                          await client.post(`/teacher/live/${s.id}/status`, { status: 'live' })
                          toast('Session started'); q.reload()
                          window.open(s.meeting_url, '_blank', 'noopener')
                        }} />
                      ) : s.status === 'live' ? (
                        <Action small kind="ghost" label="End" onClick={async () => {
                          await client.post(`/teacher/live/${s.id}/status`, { status: 'ended' })
                          toast('Session ended'); q.reload()
                        }} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
        </>
      )}
    </Page>
  )
}

function SessionView() {
  const { param, toast } = useSession()
  const q = useLoad(() => client.get(`/teacher/live/${param}`), [param])
  const [marks, setMarks] = useState<Record<string, string>>({})

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="live" label="Live classes" here={d.session.title.toUpperCase()} />
          <Head title={d.session.title} sub={`${d.session.course} · ${fmtDateTime(d.session.starts_at)}`} />
          <div className="grid g4">
            <Stat small k="Enrolled" v={d.attendance.length} />
            <Stat small k="Registered" v={d.attendance.filter((a: any) => a.status).length} />
            <Stat small k="Attended" v={d.attendance.filter((a: any) => a.status === 'attended').length} />
            <Stat small k="Status" v={d.session.status} />
          </div>

          <Head title="Attendance" sub="Marked here, or automatically when a student joins" />
          <Table head={['Student', 'Status', 'Joined', 'Mark']}>
            {d.attendance.map((a: any) => (
              <tr key={a.user_id}>
                <td><strong>{a.full_name}</strong></td>
                <td>{a.status === 'attended' ? <Pill tone="ok">Attended</Pill>
                  : a.status === 'absent' ? <Pill tone="bad">Absent</Pill>
                  : a.status ? <Pill tone="wait">Registered</Pill> : <Pill tone="mute">—</Pill>}</td>
                <td className="small muted">{a.joined_at ? fmtDateTime(a.joined_at) : '—'}</td>
                <td>
                  <select value={marks[a.user_id] ?? a.status ?? ''}
                    onChange={e => setMarks({ ...marks, [a.user_id]: e.target.value })}
                    style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6 }}>
                    <option value="">—</option>
                    <option value="registered">Registered</option>
                    <option value="attended">Attended</option>
                    <option value="absent">Absent</option>
                  </select>
                </td>
              </tr>
            ))}
          </Table>
          <div className="row" style={{ marginTop: 14 }}>
            <Action label="Save attendance" disabled={Object.keys(marks).length === 0} onClick={async () => {
              const payload = Object.entries(marks).filter(([, v]) => v)
                .map(([userId, status]) => ({ userId, status }))
              const r = await client.post(`/teacher/live/${param}/attendance`, { marks: payload })
              toast(`Marked ${r.marked} students`); setMarks({}); q.reload()
            }} />
          </div>
        </>
      )}
    </Page>
  )
}

function Recordings() {
  const q = useLoad(() => client.get('/teacher/recordings'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Recordings" sub="Every recorded class on your courses" />
          <div className="lib">
            {d.recordings.map((r: any) => (
              <div className="libcard" key={r.id}>
                <div className="thumb"><div className="play">▶</div>
                  <span className="dur">{duration(r.duration_seconds)}</span></div>
                <div className="pad">
                  <span className="tchip vid">Recording</span><h4>{r.title}</h4>
                  <div className="meta">{r.course} · {fmtDate(r.recorded_on)}</div>
                </div>
              </div>
            ))}
          </div>
          <Note>
            <strong>Brolly uploads and publishes recordings.</strong> Whether teachers may upload directly is a
            permission (<span className="mono">recording:manage</span>), so it is a role change rather than a
            code change if that becomes the policy.
          </Note>
        </>
      )}
    </Page>
  )
}

function Profile() {
  const { me, toast, reload } = useSession()
  const [name, setName] = useState(me.user.fullName)
  const q = useLoad(() => client.get('/teacher/overview'))
  return (
    <>
      <Head title="My profile" sub={me.user.email} />
      <div className="grid g2">
        <div className="card">
          <h3>My details</h3>
          <div className="sub" style={{ marginBottom: 12 }}>Shown on the course pages students browse</div>
          <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Email" help="Your username. Only Brolly can change it."><input value={me.user.email} readOnly /></Field>
          <Action label="Save" onClick={async () => {
            await client.patch('/me', { fullName: name }); toast('Saved'); await reload()
          }} />
        </div>
        <div className="card">
          <h3>My teaching</h3>
          <div className="sub" style={{ marginBottom: 12 }}>Right now</div>
          <Page q={q}>
            {(d: any) => (
              <>
                {[['Courses', d.courses.length], ['Students', d.stats.students],
                  ['Waiting to grade', d.stats.to_grade], ['Classes delivered', d.stats.delivered]]
                  .map(([k, v]: any) => (
                    <div key={k} style={{ display: 'flex', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                      <div className="small muted" style={{ flex: 1 }}>{k}</div>
                      <div className="small" style={{ fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
              </>
            )}
          </Page>
        </div>
      </div>
    </>
  )
}
