import React, { useState } from 'react'
import * as client from '../api.ts'
import {
  Action, Bar, Crumb, Empty, Field, Head, Modal, Note, Page, Pill, Stat, Table,
  fmtAgo, fmtDate, fmtDateTime, useLoad, useSession,
} from '../ui.tsx'

export default function SchoolPortal() {
  const { screen } = useSession()
  switch (screen) {
    case 'teachers': return <Teachers />
    case 'students': return <Students />
    case 'import': return <ImportStudents />
    case 'classes': return <Classes />
    case 'class': return <ClassDetail />
    case 'exams': return <Exams />
    case 'reports': return <Reports />
    case 'profile': return <Profile />
    default: return <Overview />
  }
}

// ---------------------------------------------------------------------------

function Overview() {
  const { me, go } = useSession()
  const q = useLoad(() => client.get('/school/overview'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title={me.tenant.name}
            sub={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
          <div className="grid g4">
            <Stat k="Teachers" v={d.counts.teachers} d="Active this week" />
            <Stat k="Students" v={d.counts.students} d={`of ${d.seats.seats} seats`} />
            <Stat k="Classes" v={d.counts.classes} d={d.seats.levels} />
            <Stat k="Needs grading" v={d.counts.pending_labs + d.counts.pending_marking}
              d={`${d.counts.pending_labs} labs · ${d.counts.pending_marking} exam answers`} />
          </div>

          <Head title="Class progress" sub="Same syllabus, same weeks — the gaps are the conversation" />
          <Table head={['Class', 'Teacher', 'Students', 'Completion', 'Avg exam']}>
            {d.classes.map((c: any) => (
              <tr key={c.id} className="clickable" onClick={() => go('class', c.id)}>
                <td><strong>{c.name}</strong></td>
                <td className="small">{c.teacher}</td>
                <td className="mono">{c.students}</td>
                <td><Bar v={c.completion} /></td>
                <td className="mono">{c.avg_exam ? c.avg_exam + '%' : '—'}</td>
              </tr>
            ))}
          </Table>

          {(() => {
            const sorted = [...d.classes].filter((c: any) => c.students > 0).sort((a: any, b: any) => a.completion - b.completion)
            const worst = sorted[0], best = sorted[sorted.length - 1]
            return worst && best && best.completion - worst.completion > 20 ? (
              <Note>
                <strong>{worst.name} is behind.</strong> {worst.completion}% against {best.completion}% in{' '}
                {best.name}, same syllabus and the same weeks. Teacher activity under Reports shows why.
              </Note>
            ) : null
          })()}
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Teachers() {
  const { toast } = useSession()
  const q = useLoad(() => client.get('/school/teachers'))
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState<any>(null)

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Teachers" sub="You create and manage these accounts yourself"
            right={<button className="btn gold" onClick={() => setAdding(true)}>Add a teacher</button>} />
          <Table head={['Teacher', 'Classes', 'Students', 'Last active', 'Assigned (30d)', 'To grade', '']}>
            {d.teachers.map((t: any) => (
              <tr key={t.id}>
                <td><strong>{t.full_name}</strong><div className="tiny muted mono">{t.email}</div></td>
                <td className="small">{(t.classes ?? []).join(', ') || '—'}</td>
                <td className="mono">{t.students}</td>
                <td className={'small ' + (fmtAgo(t.last_login_at) === 'Today' ? '' : 'muted')}>{fmtAgo(t.last_login_at)}</td>
                <td className="mono">{t.assigned}</td>
                <td>{t.pending > 5 ? <Pill tone="bad">{t.pending}</Pill> : <Pill>{t.pending}</Pill>}</td>
                <td>
                  {t.status === 'active' ? (
                    <Action small kind="ghost" label="Deactivate" onClick={async () => {
                      await client.post(`/school/teachers/${t.id}/deactivate`)
                      toast('Deactivated. Their grading history stays with the students.'); q.reload()
                    }} />
                  ) : <Pill tone="mute">Disabled</Pill>}
                </td>
              </tr>
            ))}
          </Table>
          <Note>
            <strong>Deactivate, never delete.</strong> A teacher who leaves keeps their grading history attached
            to the students they taught. Deleting would take that history with them.
          </Note>

          {adding && (
            <AddTeacher classes={d.classes} onClose={() => setAdding(false)}
              onDone={r => { setAdding(false); setCreated(r); q.reload() }} />
          )}
          {created && (
            <Modal title="Teacher login created" onClose={() => setCreated(null)}>
              <div className="slip">
                <div className="nm">{created.fullName}</div>
                <div className="kv">Email <b>{created.email}</b></div>
                <div className="kv">Temporary password <b>{created.temporaryPassword}</b></div>
                <div className="tiny muted" style={{ marginTop: 6 }}>They must change it at first sign-in.</div>
              </div>
              <div style={{ marginTop: 14 }}>
                <button className="btn gold" onClick={() => setCreated(null)}>Done</button>
              </div>
            </Modal>
          )}
        </>
      )}
    </Page>
  )
}

function AddTeacher({ classes, onClose, onDone }: { classes: any[]; onClose: () => void; onDone: (r: any) => void }) {
  const [f, setF] = useState({ fullName: '', email: '', phone: '', subject: 'Python & AI' })
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState('')
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  return (
    <Modal title="Add a teacher" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        They get their own login and see only the classes you assign — nothing else in the school.
      </p>
      <Field label="Full name"><input value={f.fullName} onChange={e => setF({ ...f, fullName: e.target.value })} placeholder="Anil Varma" /></Field>
      <Field label="Email" help="Their username. Teachers do have email; students usually do not.">
        <input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="anil.v@school.edu.in" />
      </Field>
      <Field label="Subject">
        <select value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })}>
          <option>Python &amp; AI</option><option>Computational Thinking</option><option>Both</option>
        </select>
      </Field>

      <h3 style={{ marginTop: 16 }}>Which classes?</h3>
      <div className="sub" style={{ marginBottom: 10 }}>They see these and nothing else</div>
      {classes.map((c: any) => (
        <label className="unit" key={c.id} style={{ cursor: 'pointer', marginBottom: 7 }}>
          <div className="num"><input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} /></div>
          <div className="body"><div className="t">{c.name}</div></div>
        </label>
      ))}
      {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
      <div className="row" style={{ marginTop: 14 }}>
        <Action label="Create teacher login" onClick={async () => {
          setErr('')
          try {
            const r = await client.post('/school/teachers', { ...f, classIds: picked })
            onDone({ ...r, fullName: f.fullName })
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function Students() {
  const { go, toast } = useSession()
  const [classId, setClassId] = useState<string | null>(null)
  const q = useLoad(() => client.get(`/school/students${classId ? `?classId=${classId}` : ''}`), [classId])
  const [slip, setSlip] = useState<any>(null)

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Students" sub={`${d.seats.used} of ${d.seats.seats} seats used`}
            right={<button className="btn gold" onClick={() => go('import')}>Upload student list</button>} />
          <div className="filters">
            <button className={!classId ? 'on' : ''} onClick={() => setClassId(null)}>All</button>
            {d.classes.map((c: any) => (
              <button key={c.id} className={classId === c.id ? 'on' : ''} onClick={() => setClassId(c.id)}>
                {c.name} <span className="mono">{c.students}</span>
              </button>
            ))}
            <span className={'chip' + (d.seats.left < 10 ? ' warn' : '')} style={{ marginLeft: 6 }}>
              {d.seats.left} seats left
            </span>
          </div>

          <Table head={['Student', 'Roll', 'Class', 'Last login', 'Time in app', 'Completed', '']}>
            {d.students.map((s: any) => (
              <tr key={s.id}>
                <td><strong>{s.full_name}</strong></td>
                <td className="mono small">{s.roll_no}</td>
                <td className="small">{s.class_name ?? '—'}</td>
                <td className={'small ' + (fmtAgo(s.last_login_at) === 'Today' ? '' : 'muted')}>{fmtAgo(s.last_login_at)}</td>
                <td className="mono">{s.minutes} min</td>
                <td className="mono">{s.done}</td>
                <td>
                  <Action small kind="ghost" label="Reset password" onClick={async () => {
                    const r = await client.post(`/school/students/${s.id}/reset-password`)
                    setSlip({ name: s.full_name, roll: s.roll_no, password: r.temporaryPassword })
                    toast('Temporary password generated')
                  }} />
                </td>
              </tr>
            ))}
          </Table>
          {d.students.length >= 400 ? <p className="tiny muted" style={{ marginTop: 10 }}>Showing the first 400. Filter by class to narrow it.</p> : null}

          {slip && (
            <Modal title="Temporary password" onClose={() => setSlip(null)}>
              <div className="slip">
                <div className="nm">{slip.name}</div>
                <div className="kv">Username <b>{slip.roll}</b></div>
                <div className="kv">Password <b>{slip.password}</b></div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  They must change it when they next sign in. Their other sessions have already been signed out.
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
    </Page>
  )
}

/**
 * Bulk import.
 *
 * Two passes on purpose: nothing is written until the school admin has seen
 * exactly what would happen, including whether the seat cap allows it. A
 * 250-student school will not type them in one at a time, and will not accept
 * "some of them worked".
 */
function ImportStudents() {
  const { go, toast, me } = useSession()
  const q = useLoad(() => client.get('/school/students'))
  const [step, setStep] = useState(1)
  const [text, setText] = useState('Aarav Sharma, 9D-01, D\nDivya Menon, 9D-02, D\nKarthik Iyer, , D\nSana Qureshi, 9D-04, D')
  const [classId, setClassId] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [slips, setSlips] = useState<any[] | null>(null)
  const [err, setErr] = useState('')

  const rows = text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [name, roll, section] = line.split(',').map(s => (s ?? '').trim())
    return { name, roll, section }
  })

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="students" label="Students" here="UPLOAD STUDENT LIST" />
          <Head title="Upload the student list" sub="A 250-student school will not type them in one at a time" />
          <div className="steps">
            <div className={step === 1 ? 'on' : 'done'}>1 · Paste the list</div>
            <div className={step === 2 ? 'on' : step > 2 ? 'done' : ''}>2 · Check the rows</div>
            <div className={step === 3 ? 'on' : ''}>3 · Print credentials</div>
          </div>

          {step === 1 && (
            <>
              <div className="grid g2">
                <div className="card">
                  <h3>Paste from your spreadsheet</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>
                    One student per line: <span className="mono">name, roll number, section</span>
                  </div>
                  <div className="field">
                    <textarea value={text} onChange={e => setText(e.target.value)} style={{ minHeight: 190, fontFamily: 'var(--mono)', fontSize: 13 }} />
                  </div>
                  <Field label="Which class do they join?">
                    <select value={classId} onChange={e => setClassId(e.target.value)}>
                      <option value="">Choose a class…</option>
                      {d.classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="card">
                  <h3>What happens next</h3>
                  <ul className="small muted" style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.9 }}>
                    <li>A username and temporary password is generated for every student.</li>
                    <li>You get a printable sheet, cut into slips, handed out in class.</li>
                    <li>Students must change the password on first sign-in.</li>
                    <li>No student email address is needed at any point.</li>
                  </ul>
                  <Note tone="teal">
                    <strong>{d.seats.left} seats left</strong> of {d.seats.seats}. The import is blocked, not
                    truncated, if the list would take you past the cap.
                  </Note>
                </div>
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <Action label={`Check ${rows.length} row${rows.length === 1 ? '' : 's'}`} onClick={async () => {
                  setErr('')
                  const p = await client.post('/school/students/import', { rows })
                  setPreview(p); setStep(2)
                }} />
                <button className="btn ghost" onClick={() => go('students')}>Cancel</button>
              </div>
            </>
          )}

          {step === 2 && preview && (
            <>
              <Note tone={preview.problemCount ? undefined : 'teal'}>
                <strong>{preview.readyCount} ready, {preview.problemCount} need attention.</strong>{' '}
                {preview.problemCount
                  ? 'Fix them in your spreadsheet and paste again, or continue and skip those rows.'
                  : 'Nothing has been written yet.'}
                {preview.wouldExceed ? ' This list would take you past your seat cap.' : ''}
              </Note>
              <Table head={['Line', 'Name', 'Roll', 'Section', '']}>
                {preview.rows.map((r: any) => (
                  <tr key={r.line}>
                    <td className="mono">{r.line}</td>
                    <td>{r.name || <Pill tone="bad">missing</Pill>}</td>
                    <td className="mono">{r.roll || <Pill tone="bad">missing</Pill>}</td>
                    <td className="small">{r.section}</td>
                    <td>{r.problem ? <Pill tone="bad">{r.problem}</Pill> : <Pill tone="ok">Ready</Pill>}</td>
                  </tr>
                ))}
              </Table>
              {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
              <div className="row" style={{ marginTop: 14 }}>
                <Action label={`Create ${preview.readyCount} student logins`} disabled={!preview.readyCount || !classId}
                  title={!classId ? 'Choose a class first' : undefined}
                  onClick={async () => {
                    setErr('')
                    try {
                      const r = await client.post('/school/students/import', { rows, commit: true, classId })
                      setSlips(r.slips); setStep(3); toast(`${r.created} students created`)
                    } catch (e: any) { setErr(e.message) }
                  }} />
                <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
              </div>
            </>
          )}

          {step === 3 && slips && (
            <>
              <Note tone="teal">
                <strong>{slips.length} students created.</strong> Print this sheet, cut along the lines and hand
                them out in class.
              </Note>
              <div className="grid g2" style={{ marginTop: 14 }}>
                {slips.map(s => (
                  <div className="slip" key={s.roll}>
                    <div className="nm">{s.name}</div>
                    <div className="kv">School code <b>{me.tenant.schoolCode}</b></div>
                    <div className="kv">Username <b>{s.roll}</b></div>
                    <div className="kv">Password <b>{s.password}</b></div>
                    <div className="tiny muted" style={{ marginTop: 6 }}>Change this password when you first sign in.</div>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn gold" onClick={() => window.print()}>Print all slips</button>
                <button className="btn ghost" onClick={() => go('students')}>Done</button>
              </div>
            </>
          )}
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Classes() {
  const { go, toast } = useSession()
  const q = useLoad(() => client.get('/school/classes'))
  const [creating, setCreating] = useState(false)
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Classes" sub="A class ties a teacher, a set of students and a course together"
            right={<button className="btn gold" onClick={() => setCreating(true)}>Create a class</button>} />
          {d.classes.length === 0
            ? <Empty title="No classes yet" detail="A class is the object everything else hangs off — material, labs, exams and results."
                action={<button className="btn gold" onClick={() => setCreating(true)}>Create the first class</button>} />
            : (
              <div className="grid g2">
                {d.classes.map((c: any) => (
                  <div className="card" key={c.id}>
                    <h3>{c.name}</h3>
                    <div className="sub">{c.teacher} · {c.students} students · {c.course}</div>
                    <div style={{ margin: '12px 0' }}><Bar v={c.completion} /></div>
                    <button className="btn ghost sm" onClick={() => go('class', c.id)}>Open class</button>
                  </div>
                ))}
              </div>
            )}
          {creating && (
            <CreateClass data={d} onClose={() => setCreating(false)}
              onDone={n => { setCreating(false); toast(`Class created with ${n} students`); q.reload() }} />
          )}
        </>
      )}
    </Page>
  )
}

function CreateClass({ data, onClose, onDone }: { data: any; onClose: () => void; onDone: (n: number) => void }) {
  const [f, setF] = useState({ name: '', courseId: data.courses[0]?.id ?? '', teacherId: '', gradeLevel: '9', sectionLabel: 'A' })
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState('')
  return (
    <Modal title="Create a class" onClose={onClose}>
      <Field label="Class name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="9-D Python & AI" /></Field>
      <Field label="Course" help="Only levels your school is licensed for appear here.">
        <select value={f.courseId} onChange={e => setF({ ...f, courseId: e.target.value })}>
          {data.courses.map((c: any) => <option key={c.id} value={c.id}>{c.level_label} — {c.title}</option>)}
        </select>
      </Field>
      <div className="grid g3" style={{ gap: 10 }}>
        <Field label="Grade"><input value={f.gradeLevel} onChange={e => setF({ ...f, gradeLevel: e.target.value })} /></Field>
        <Field label="Section"><input value={f.sectionLabel} onChange={e => setF({ ...f, sectionLabel: e.target.value })} /></Field>
        <Field label="Teacher">
          <select value={f.teacherId} onChange={e => setF({ ...f, teacherId: e.target.value })}>
            <option value="">Choose…</option>
            {data.teachers.map((t: any) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        </Field>
      </div>

      <h3 style={{ marginTop: 12 }}>Enrol students</h3>
      <div className="sub" style={{ marginBottom: 10 }}>
        {data.unassigned.length} students are not in a class yet
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        <table>
          <tbody>
            {data.unassigned.map((s: any) => (
              <tr key={s.id}>
                <td style={{ width: 34 }}>
                  <input type="checkbox" checked={picked.includes(s.id)}
                    onChange={() => setPicked(p => p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id])} />
                </td>
                <td><strong>{s.full_name}</strong></td>
                <td className="mono small">{s.roll_no}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
      <div className="row" style={{ marginTop: 14 }}>
        <Action label={`Create class with ${picked.length} students`} onClick={async () => {
          setErr('')
          try {
            const r = await client.post('/school/classes', { ...f, studentIds: picked })
            onDone(r.students)
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

function ClassDetail() {
  const { param } = useSession()
  const q = useLoad(() => client.get(`/school/classes/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="classes" label="Classes" here={d.class.name.toUpperCase()} />
          <Head title={d.class.name} sub={`${d.class.teacher} · ${d.students.length} students · ${d.class.course}`} />
          <Table head={['Student', 'Roll', 'Completed', 'Labs', 'Best exam', 'Time', 'Last login']}>
            {d.students.map((s: any) => (
              <tr key={s.id}>
                <td><strong>{s.full_name}</strong></td>
                <td className="mono small">{s.roll_no}</td>
                <td style={{ minWidth: 150 }}><Bar v={s.total_nodes ? s.done / s.total_nodes * 100 : 0} /></td>
                <td className="mono">{s.labs_graded}/{s.labs_total}</td>
                <td className="mono">{s.last_exam ? s.last_exam + '%' : '—'}</td>
                <td className="mono">{s.minutes} min</td>
                <td className={'small ' + (fmtAgo(s.last_login_at) === 'Today' ? '' : 'muted')}>{fmtAgo(s.last_login_at)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Exams() {
  const q = useLoad(() => client.get('/school/exams'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Exams" sub="Scheduled by teachers, visible to you across the school" />
          <Table head={['Exam', 'Class', 'When', 'Sat', 'Average', 'Status']}>
            {d.exams.map((e: any) => (
              <tr key={e.id}>
                <td><strong>{e.title}</strong></td>
                <td className="mono small">{e.class_name}</td>
                <td className="small">{fmtDateTime(e.starts_at)}</td>
                <td className="mono">{e.sat} / {e.enrolled}</td>
                <td className="mono">{e.avg_pct ? e.avg_pct + '%' : '—'}</td>
                <td>
                  {e.status === 'released' ? <Pill tone="ok">Results released</Pill>
                    : e.to_mark > 0 ? <Pill tone="bad">{e.to_mark} answers to mark</Pill>
                    : e.status === 'scheduled' ? <Pill tone="wait">Scheduled</Pill>
                    : <Pill tone="wait">Marking</Pill>}
                </td>
              </tr>
            ))}
          </Table>
          {(() => {
            const absent = d.exams.find((e: any) => e.sat > 0 && e.sat < e.enrolled)
            return absent ? (
              <Note>
                <strong>{absent.enrolled - absent.sat} students missed the {absent.class_name} paper.</strong>{' '}
                Fixed-time exams make absence visible immediately, which is the point of scheduling them rather
                than leaving a window open.
              </Note>
            ) : null
          })()}
        </>
      )}
    </Page>
  )
}

function Reports() {
  const q = useLoad(() => client.get('/school/reports'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Reports" sub="Everything below covers this school only" />
          <div className="grid g2">
            <div className="card">
              <h3>Teacher activity</h3>
              <div className="sub" style={{ marginBottom: 12 }}>Material assigned in the last 30 days</div>
              {d.teacherActivity.map((t: any) => (
                <div key={t.full_name} style={{ marginBottom: 10 }}>
                  <div className="small"><strong>{t.full_name}</strong> — {t.assigned} assignments</div>
                  <Bar v={Math.min(100, t.assigned * 12)} />
                </div>
              ))}
              {(() => {
                const quiet = [...d.teacherActivity].sort((a: any, b: any) => a.assigned - b.assigned)[0]
                return quiet && quiet.assigned < 5
                  ? <div className="tiny muted" style={{ marginTop: 8 }}>
                      {quiet.full_name} has assigned {quiet.assigned} in 30 days. That is usually the reason a class falls behind.
                    </div>
                  : null
              })()}
            </div>
            <div className="card">
              <h3>Exam averages</h3>
              <div className="sub" style={{ marginBottom: 12 }}>Every released paper</div>
              {d.examAverages.length
                ? d.examAverages.map((e: any) => (
                    <div key={e.title} style={{ marginBottom: 10 }}>
                      <div className="small">{e.title}</div><Bar v={e.avg_pct} />
                    </div>
                  ))
                : <p className="muted small">No results released yet.</p>}
            </div>
          </div>

          <div className="grid g2" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>Pending grading</h3>
              <div className="sub" style={{ marginBottom: 10 }}>Across all teachers</div>
              <div className="row tight">
                <Pill tone={d.pending.labs ? 'bad' : 'ok'}>{d.pending.labs} labs</Pill>
                <Pill tone={d.pending.papers ? 'bad' : 'ok'}>{d.pending.papers} exam answers</Pill>
              </div>
            </div>
            <div className="card">
              <h3>Seats</h3>
              <div className="sub" style={{ marginBottom: 10 }}>{d.seats.used} of {d.seats.seats} used</div>
              <Bar v={d.seats.seats ? d.seats.used / d.seats.seats * 100 : 0} />
              <div className="tiny muted" style={{ marginTop: 8 }}>
                {d.seats.left} left. Contact Brolly before adding another section.
              </div>
            </div>
          </div>

          <Head title="Not signed in for a week" sub="The students to call home about — before the exam tells you" />
          <Table head={['Student', 'Roll', 'Class', 'Last activity']}>
            {d.inactive.map((s: any, i: number) => (
              <tr key={i}>
                <td><strong>{s.full_name}</strong></td>
                <td className="mono small">{s.roll_no}</td>
                <td className="small">{s.class_name ?? '—'}</td>
                <td className="small muted">{fmtAgo(s.last_seen)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Profile() {
  const { toast, reload } = useSession()
  const q = useLoad(() => client.get('/school/profile'))
  const [form, setForm] = useState<any>(null)
  const [brand, setBrand] = useState<any>(null)
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const f = form ?? { name: d.school.name, area: d.school.area, board: d.school.board }
        const b = brand ?? {
          displayName: d.school.display_name, primaryColor: d.school.primary_color,
          secondaryColor: d.school.secondary_color, welcomeMessage: d.school.welcome_message,
        }
        return (
          <>
            <Head title="School profile" sub={d.school.name} />
            <div className="grid g2">
              <div className="card">
                <h3>School details</h3>
                <div className="sub" style={{ marginBottom: 12 }}>Shown to your teachers and students</div>
                <Field label="School name"><input value={f.name} onChange={e => setForm({ ...f, name: e.target.value })} /></Field>
                <Field label="School code" help="Students type this at sign-in. Changing it breaks existing logins, so it is set by Brolly.">
                  <input value={d.school.school_code} readOnly />
                </Field>
                <Field label="Address"><input value={f.area} onChange={e => setForm({ ...f, area: e.target.value })} /></Field>
                <Field label="Board">
                  <select value={f.board} onChange={e => setForm({ ...f, board: e.target.value })}>
                    <option>CBSE</option><option>State board</option><option>ICSE</option>
                  </select>
                </Field>
                <Action label="Save school details" onClick={async () => {
                  await client.patch('/school/profile', f); toast('Saved'); await reload(); q.reload()
                }} />
              </div>

              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>Your branding</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>
                    Applied everywhere immediately. A school’s look is a database row, not a build.
                  </div>
                  <Field label="Display name"><input value={b.displayName} onChange={e => setBrand({ ...b, displayName: e.target.value })} /></Field>
                  <Field label="Welcome message" help="Shown on your sign-in page.">
                    <input value={b.welcomeMessage} onChange={e => setBrand({ ...b, welcomeMessage: e.target.value })} />
                  </Field>
                  <div className="grid g2" style={{ gap: 10 }}>
                    <Field label="Primary colour" error={err}>
                      <input type="color" value={b.primaryColor} onChange={e => setBrand({ ...b, primaryColor: e.target.value })} style={{ height: 42, padding: 4 }} />
                    </Field>
                    <Field label="Secondary colour">
                      <input type="color" value={b.secondaryColor} onChange={e => setBrand({ ...b, secondaryColor: e.target.value })} style={{ height: 42, padding: 4 }} />
                    </Field>
                  </div>
                  <Action label="Save branding" onClick={async () => {
                    setErr('')
                    try {
                      await client.patch('/school/branding', b); toast('Branding updated'); await reload()
                    } catch (e: any) { setErr(e.message) }
                  }} />
                </div>

                <div className="card">
                  <h3>Your licence</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>Set by Brolly — you cannot change this here</div>
                  <div className="grid g2" style={{ gap: 10 }}>
                    <div>
                      <div className="tiny mono muted" style={{ letterSpacing: '.1em', textTransform: 'uppercase' }}>Class levels</div>
                      <div style={{ fontWeight: 600, marginTop: 3 }}>{d.licence.levels}</div>
                    </div>
                    <div>
                      <div className="tiny mono muted" style={{ letterSpacing: '.1em', textTransform: 'uppercase' }}>Valid until</div>
                      <div style={{ fontWeight: 600, marginTop: 3 }}>{fmtDate(d.licence.validUntil)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div className="tiny mono muted" style={{ letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>Seats</div>
                    <Bar v={d.licence.seats ? d.licence.used / d.licence.seats * 100 : 0} />
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                      {d.licence.used} of {d.licence.seats} used · {d.licence.left} left
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid g2" style={{ marginTop: 14 }}>
              <div className="card">
                <h3>School at a glance</h3>
                <div className="sub" style={{ marginBottom: 12 }}>Read-only</div>
                {[['Teachers', d.counts.teachers], ['Students', d.counts.students], ['Classes', d.counts.classes],
                  ['Joined Brolly', fmtDate(d.school.joined_on)]].map(([k, v]: any) => (
                  <div key={k} style={{ display: 'flex', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="small muted" style={{ flex: 1 }}>{k}</div>
                    <div className="small" style={{ fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>
              <AuditPanel />
            </div>
          </>
        )
      }}
    </Page>
  )
}

function AuditPanel() {
  const q = useLoad(() => client.get('/school/audit'))
  return (
    <div className="card">
      <h3>Recent activity</h3>
      <div className="sub" style={{ marginBottom: 12 }}>Every administrative action in your school</div>
      <Page q={q}>
        {(d: any) => (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {d.entries.slice(0, 20).map((e: any) => (
              <div key={e.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="tiny mono muted" style={{ minWidth: 104 }}>{fmtDateTime(e.occurred_at)}</div>
                <div className="small">{e.summary}<div className="tiny muted">{e.actor ?? '—'}</div></div>
              </div>
            ))}
          </div>
        )}
      </Page>
    </div>
  )
}
