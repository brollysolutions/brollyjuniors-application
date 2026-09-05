import React, { useEffect, useMemo, useState } from 'react'
import * as client from '../api.ts'
import {
  Action, Bar, Crumb, Empty, Field, Head, Modal, Note, Page, Pill, Stat, Table,
  fmtAgo, fmtDate, fmtDateTime, useLoad, useSession,
} from '../ui.tsx'
import { Blocks } from '../blocks.tsx'

export default function TeacherPortal() {
  const { screen } = useSession()
  switch (screen) {
    case 'class': return <ClassDetail />
    case 'student': return <StudentDetail />
    case 'library': return <Library />
    case 'create': return <CreateMaterial />
    case 'assign': return <Assign />
    case 'labs': return <Labs />
    case 'grade': return <Grade />
    case 'exams': return <Exams />
    case 'mark': return <Marking />
    case 'reports': return <Reports />
    case 'announce': return <Announcements />
    case 'profile': return <Profile />
    default: return <Classes />
  }
}

// ---------------------------------------------------------------------------

function Classes() {
  const { me, go } = useSession()
  const q = useLoad(() => client.get('/teacher/classes'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="My classes" sub={`${me.user.fullName} · ${me.tenant.name}`} />
          {d.classes.length === 0
            ? <Empty title="No classes assigned yet" detail="Your school admin puts you on a class. You will see it here as soon as they do." />
            : (
              <div className="grid g2">
                {d.classes.map((c: any) => (
                  <div className="card" key={c.id}>
                    <h3>{c.name}</h3>
                    <div className="sub">{c.students} students · {c.course}</div>
                    <div style={{ margin: '12px 0' }}><Bar v={c.completion} /></div>
                    {c.pending_labs
                      ? <Pill tone="bad">{c.pending_labs} labs waiting</Pill>
                      : <Pill tone="ok">Nothing pending</Pill>}
                    <div style={{ marginTop: 12 }}>
                      <button className="btn ghost sm" onClick={() => go('class', c.id)}>Open class</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          <Note>
            <strong>Teaching at two schools?</strong> One login. The two schools never see each other — or know
            the other exists.
          </Note>
        </>
      )}
    </Page>
  )
}

function ClassDetail() {
  const { param, go } = useSession()
  const q = useLoad(() => client.get(`/teacher/classes/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="classes" label="My classes" here={d.class.name.toUpperCase()} />
          <Head title={d.class.name} sub={`${d.students.length} students · ${d.class.course}`}
            right={<>
              <button className="btn ghost" onClick={() => go('labs')}>Lab submissions</button>{' '}
              <button className="btn gold" onClick={() => go('assign', param)}>Assign material</button>
            </>} />
          <Table head={['Student', 'Completed', 'Time in app', 'Labs', 'Best exam', 'Last login']}>
            {d.students.map((s: any) => (
              <tr key={s.id} className="clickable" onClick={() => go('student', s.id)}>
                <td>
                  <strong>{s.full_name}</strong> <span className="tiny muted mono">{s.roll_no}</span>
                  {fmtAgo(s.last_login_at).endsWith('days ago') ? <> <Pill tone="bad">Inactive</Pill></> : null}
                </td>
                <td style={{ minWidth: 150 }}><Bar v={s.total_nodes ? s.done / s.total_nodes * 100 : 0} /></td>
                <td className="mono">{s.minutes} min</td>
                <td className="mono">{s.labs_graded}/{s.labs_total}</td>
                <td className="mono">{s.last_exam ? s.last_exam + '%' : '—'}</td>
                <td className={'small ' + (fmtAgo(s.last_login_at) === 'Today' ? '' : 'muted')}>{fmtAgo(s.last_login_at)}</td>
              </tr>
            ))}
          </Table>
          <Note>
            <strong>Three columns, one purpose.</strong> Time in app tells you whether they are showing up,
            completion whether they are moving, exam whether it is going in. A student can be high on one and
            low on another — that is the conversation.
          </Note>

          {d.announcements.length ? (
            <>
              <Head title="Recent announcements" />
              {d.announcements.map((a: any) => (
                <div className="card" key={a.id} style={{ marginBottom: 9 }}>
                  <div className="tiny muted">{fmtAgo(a.created_at)}</div>
                  <div style={{ marginTop: 5 }}>{a.body}</div>
                </div>
              ))}
            </>
          ) : null}
        </>
      )}
    </Page>
  )
}

function StudentDetail() {
  const { param } = useSession()
  const q = useLoad(() => client.get(`/teacher/students/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => {
        const stale = d.student.last_login_at
          ? Math.floor((Date.now() - new Date(d.student.last_login_at).getTime()) / 864e5) : 99
        return (
          <>
            <Crumb to="classes" label="My classes" here={d.student.full_name.toUpperCase()} />
            <Head title={d.student.full_name} sub={`${d.student.class_name ?? ''} · Roll ${d.student.roll_no}`} />
            <div className="grid g4">
              <Stat small k="Time in app" v={`${d.student.minutes} min`} d="All activity" />
              <Stat small k="Completed" v={`${d.student.done}/${d.totalNodes}`} d="Videos, notes, practice" />
              <Stat small k="Labs graded" v={d.labs.filter((l: any) => l.status === 'graded').length} d="Practical file" />
              <Stat small k="Last login" v={fmtAgo(d.student.last_login_at)} />
            </div>

            {stale >= 7 ? (
              <Note>
                <strong>Not opened the app in {stale} days.</strong> This is the student to call home about — and
                the app told you before the exam did.
                {d.student.guardian_phone ? <> Parent: {d.student.guardian_name} · <span className="mono">{d.student.guardian_phone}</span></> : null}
              </Note>
            ) : null}

            <Head title="Lesson by lesson" />
            {d.lessons.map((l: any) => (
              <div className={'unit' + (l.status === 'not_started' ? ' locked' : '')} key={l.id}>
                <div className="num">{l.status === 'completed' ? '✓' : l.status === 'in_progress' ? '▸' : '·'}</div>
                <div className="body">
                  <div className="t">{l.title}</div>
                  <div className="m">{l.unit}</div>
                </div>
                <Pill tone={l.status === 'completed' ? 'ok' : l.status === 'in_progress' ? 'wait' : 'mute'}>
                  {l.status === 'completed' ? 'Complete' : l.status === 'in_progress' ? `${Math.round(l.percent)}%` : 'Not started'}
                </Pill>
              </div>
            ))}

            <Head title="Lab submissions" />
            {d.labs.length
              ? (
                <Table head={['#', 'Program', 'Where', 'Submitted', 'Status']}>
                  {d.labs.map((l: any) => (
                    <tr key={l.id}>
                      <td className="mono">{l.program_no}</td>
                      <td className="small">{l.title}</td>
                      <td><Pill>{l.mode === 'in_app' ? 'In the app' : 'Uploaded'}</Pill></td>
                      <td className="small muted">{fmtAgo(l.submitted_at)}</td>
                      <td>{l.status === 'graded' ? <Pill tone="ok">{l.score} / 10</Pill>
                        : l.status === 'revision' ? <Pill tone="wait">Sent back</Pill>
                        : <Pill tone="wait">Waiting</Pill>}</td>
                    </tr>
                  ))}
                </Table>
              )
              : <p className="muted small">Nothing submitted yet.</p>}

            {d.exams.length ? (
              <>
                <Head title="Exams" />
                <Table head={['Exam', 'Score', 'Status']}>
                  {d.exams.map((e: any, i: number) => (
                    <tr key={i}>
                      <td><strong>{e.title}</strong></td>
                      <td className="mono">{e.exam_status === 'released' && e.total_score != null ? `${e.total_score} / ${e.max_score}` : '—'}</td>
                      <td>{e.exam_status === 'released' ? <Pill tone="ok">Released</Pill> : <Pill tone="wait">Being marked</Pill>}</td>
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

// ---------------------------------------------------------------------------

function Library() {
  const { go } = useSession()
  const [tab, setTab] = useState<'videos' | 'materials' | 'practice' | 'labs' | 'mine'>('videos')
  const q = useLoad(() => client.get('/teacher/library'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Library" sub="Everything you can give your classes"
            right={<button className="btn gold" onClick={() => go('assign')}>Assign something</button>} />
          <div className="filters">
            {([['videos', 'Videos', d.videos.length], ['materials', 'Materials', d.materials.length],
               ['practice', 'Practice labs', d.practice.length], ['labs', 'Graded labs', d.gradedLabs.length],
               ['mine', 'Made by me', d.mine.length]] as const).map(([k, label, n]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>
                {label} <span className="mono">{n}</span>
              </button>
            ))}
          </div>

          {tab === 'videos' && (
            <div className="lib">
              {d.videos.map((v: any) => (
                <div className="libcard" key={v.id}>
                  <div className="thumb"><div className="play">▶</div>
                    <span className="dur">{Math.floor(v.duration_seconds / 60)}:{String(v.duration_seconds % 60).padStart(2, '0')}</span>
                  </div>
                  <div className="pad"><span className="tchip vid">Video</span><h4>{v.title}</h4>
                    <div className="meta">{v.unit}</div></div>
                </div>
              ))}
            </div>
          )}

          {tab === 'materials' && (
            <div className="lib">
              {d.materials.map((m: any) => (
                <div className="libcard" key={m.id}>
                  <div className="thumb mat"><div style={{ fontSize: 26 }}>▤</div></div>
                  <div className="pad"><span className="tchip mat">{m.kind}</span><h4>{m.title}</h4>
                    <div className="meta">{m.unit} · {m.pages} pages · Brolly</div></div>
                </div>
              ))}
            </div>
          )}

          {tab === 'practice' && (
            <div className="lib">
              {d.practice.map((p: any) => (
                <div className="libcard" key={p.id}>
                  <div className="thumb lab"><div style={{ fontSize: 24 }}>▧</div></div>
                  <div className="pad"><span className="tchip lab">{p.level}</span><h4>{p.title}</h4>
                    <div className="meta">{p.unit} · unlimited attempts, never marked</div></div>
                </div>
              ))}
            </div>
          )}

          {tab === 'labs' && (
            <Table head={['#', 'Program', 'Where']}>
              {d.gradedLabs.map((g: any) => (
                <tr key={g.id}>
                  <td className="mono">{g.program_no}</td><td><strong>{g.title}</strong></td>
                  <td><Pill>{g.mode === 'in_app' ? 'In the app' : g.mode === 'uploaded' ? 'Computer lab' : 'Either'}</Pill></td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'mine' && (
            d.mine.length
              ? (
                <Table head={['Material', 'Type', 'Shared with', 'Status', '']}>
                  {d.mine.map((m: any) => (
                    <tr key={m.id}>
                      <td><strong>{m.title}</strong></td>
                      <td><Pill>{m.kind}</Pill></td>
                      <td className="small">{(m.classes ?? []).join(', ') || '—'}</td>
                      <td>{m.status === 'shared' ? <Pill tone="ok">Shared</Pill> : <Pill tone="wait">Draft</Pill>}</td>
                      <td><button className="btn ghost sm" onClick={() => go('create', m.id)}>Edit</button></td>
                    </tr>
                  ))}
                </Table>
              )
              : <Empty title="You have not made anything yet"
                  detail="Your own notes, worksheets and examples sit alongside the Brolly syllabus and only your classes can see them."
                  action={<button className="btn gold" onClick={() => go('create')}>Create a lesson</button>} />
          )}

          <Note>
            <strong>Brolly content cannot be edited</strong>, so every school teaches the same syllabus. Anything
            you make yourself is marked “made by me”, never leaves your school, and is never sent up to the
            Content Hub — the sync only ever flows downward.
          </Note>
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function CreateMaterial() {
  const { param, go, toast } = useSession()
  const lib = useLoad(() => client.get('/teacher/library'))
  const existing = useLoad(() => param ? client.get(`/teacher/materials/${param}`) : Promise.resolve(null), [param])
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('Notes')
  const [unitId, setUnitId] = useState('')
  const [classIds, setClassIds] = useState<string[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')

  // Plain text in, blocks out — the teacher never writes JSON.
  const blocks = useMemo(() => textToBlocks(text), [text])

  // Fill the form from the saved material once it arrives.
  const saved = (existing.data as any)?.material
  useEffect(() => {
    if (!saved) return
    setTitle(saved.title)
    setKind(saved.kind)
    setUnitId(saved.unit_id ?? '')
    setText(blocksToText(saved.body))
  }, [saved?.id])

  return (
    <Page q={lib}>
      {(d: any) => {
        return (
          <>
            <Head title={param ? 'Edit your material' : 'Create a lesson'}
              sub="Your own material, for your classes only" />
            <div className="grid g2">
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="input() mistakes we made in class" /></Field>
                  <div className="grid g2" style={{ gap: 10 }}>
                    <Field label="Type">
                      <select value={kind} onChange={e => setKind(e.target.value)}>
                        <option>Notes</option><option>Worksheet</option><option>Example</option>
                      </select>
                    </Field>
                    <Field label="Attach to unit">
                      <select value={unitId} onChange={e => setUnitId(e.target.value)}>
                        <option value="">Not attached</option>
                        {d.units.map((u: any) => <option key={u.id} value={u.id}>{u.code} — {u.title}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Your material"
                    help="Write normally. A line starting with # is a heading, one starting with - is a bullet, and a block wrapped in ``` is code.">
                    <textarea value={text} onChange={e => setText(e.target.value)} style={{ minHeight: 260 }}
                      placeholder={'# The mistake I saw\nAlmost everyone forgot that input() gives text.\n\n```\nage = input("Your age? ")\nprint(int(age) + 1)\n```\n\n- Adding 1 to text\n- Forgetting int()'} />
                  </Field>
                </div>
              </div>

              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>Preview</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>Exactly what your students will see</div>
                  <div className="doc" style={{ boxShadow: 'none', padding: 18 }}>
                    <h3>{title || 'Untitled'}</h3>
                    <Blocks blocks={blocks} />
                  </div>
                </div>
                <div className="card">
                  <h3>Share with</h3>
                  <div className="sub" style={{ marginBottom: 10 }}>Only these classes will see it</div>
                  {d.units.length === 0 ? null : null}
                  <ClassPicker picked={classIds} onChange={setClassIds} />
                  {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
                  <div className="row" style={{ marginTop: 12 }}>
                    <Action label="Share with my classes" onClick={() => save(true)} />
                    <Action kind="ghost" label="Save as draft" onClick={() => save(false)} />
                  </div>
                  <Note tone="teal">
                    <strong>Your material never leaves your school.</strong> Another school cannot see it, and it
                    is never pushed to the Content Hub.
                  </Note>
                </div>
              </div>
            </div>
          </>
        )

        async function save(share: boolean) {
          setErr('')
          if (!title.trim()) { setErr('Give your material a title.'); return }
          try {
            await client.post('/teacher/materials', {
              id: param ?? undefined, title, kind, unitId: unitId || undefined,
              body: blocks, classIds, share,
            })
            toast(share ? 'Shared with your classes' : 'Saved as a draft — students cannot see it yet')
            go('library')
          } catch (e: any) { setErr(e.message) }
        }
      }}
    </Page>
  )
}

function ClassPicker({ picked, onChange }: { picked: string[]; onChange: (v: string[]) => void }) {
  const q = useLoad(() => client.get('/teacher/classes'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          {d.classes.map((c: any) => (
            <label className="unit" key={c.id} style={{ cursor: 'pointer', marginBottom: 7 }}>
              <div className="num">
                <input type="checkbox" checked={picked.includes(c.id)}
                  onChange={() => onChange(picked.includes(c.id) ? picked.filter(x => x !== c.id) : [...picked, c.id])} />
              </div>
              <div className="body"><div className="t">{c.name}</div><div className="m">{c.students} students</div></div>
            </label>
          ))}
        </>
      )}
    </Page>
  )
}

/** Markdown-ish in, validated blocks out. Teachers never see JSON. */
function textToBlocks(text: string) {
  const out: any[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {
      const src: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) src.push(lines[i++])
      i++
      out.push({ type: 'code', language: 'python', source: src.join('\n') })
      continue
    }
    if (line.trim().startsWith('#')) {
      out.push({ type: 'heading', level: 3, text: line.replace(/^#+\s*/, '') })
      i++; continue
    }
    if (line.trim().startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('- ')) items.push(lines[i++].trim().slice(2))
      out.push({ type: 'list', items })
      continue
    }
    if (line.trim()) out.push({ type: 'paragraph', text: line.trim() })
    i++
  }
  return out
}

function blocksToText(blocks: any[]): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.map(b => {
    if (b.type === 'heading') return `# ${b.text}`
    if (b.type === 'list') return (b.items ?? []).map((x: string) => `- ${x}`).join('\n')
    if (b.type === 'code') return '```\n' + b.source + '\n```'
    return b.text ?? ''
  }).join('\n\n')
}

// ---------------------------------------------------------------------------

function Assign() {
  const { param, go, toast } = useSession()
  const lib = useLoad(() => client.get('/teacher/library'))
  const classes = useLoad(() => client.get('/teacher/classes'))
  const [classId, setClassId] = useState<string>(param ?? '')
  const [dueAt, setDueAt] = useState(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10))
  const [title, setTitle] = useState('This week')
  const [tab, setTab] = useState<'videos' | 'materials' | 'practice' | 'labs' | 'mine'>('videos')
  const [picked, setPicked] = useState<Array<{ type: string; id: string; label: string }>>([])
  const [err, setErr] = useState('')

  const toggle = (type: string, id: string, label: string) =>
    setPicked(p => p.some(x => x.id === id) ? p.filter(x => x.id !== id) : [...p, { type, id, label }])

  return (
    <Page q={lib}>
      {(d: any) => (
        <>
          <Head title="Assign to a class" sub="Pick what they get this week and when it is due" />
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ minWidth: 230 }}>
                <Field label="Class">
                  <select value={classId} onChange={e => setClassId(e.target.value)}>
                    <option value="">Choose a class…</option>
                    {(classes.data as any)?.classes?.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.students})</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 200 }}>
                <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} /></Field>
              </div>
              <div style={{ minWidth: 170 }}>
                <Field label="Due date"><input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} /></Field>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ paddingBottom: 14 }}>
                <Action label={`Assign ${picked.length} item${picked.length === 1 ? '' : 's'}`}
                  disabled={!classId || !picked.length}
                  onClick={async () => {
                    setErr('')
                    try {
                      const r = await client.post('/teacher/assignments', {
                        classId, title, dueAt: new Date(dueAt).toISOString(),
                        items: picked.map(p => ({ type: p.type, id: p.id })),
                      })
                      toast(`Assigned to ${r.students} students, due ${fmtDate(dueAt)}`)
                      go('class', classId)
                    } catch (e: any) { setErr(e.message) }
                  }} />
              </div>
            </div>
            {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
            {picked.length ? (
              <div className="row tight" style={{ marginTop: 4 }}>
                {picked.map(p => (
                  <span key={p.id} className="chip act" onClick={() => toggle(p.type, p.id, p.label)}>
                    {p.label} ✕
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="filters">
            {([['videos', 'Videos'], ['materials', 'Materials'], ['practice', 'Practice labs'],
               ['labs', 'Graded labs'], ['mine', 'Made by me']] as const).map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>{label}</button>
            ))}
          </div>

          {tab === 'videos' && d.videos.map((v: any) => (
            <PickRow key={v.id} chip="Video" cls="vid" title={v.title} meta={v.unit}
              on={picked.some(p => p.id === v.id)} onToggle={() => toggle('video', v.id, v.title)} />
          ))}
          {tab === 'materials' && d.materials.map((m: any) => (
            <PickRow key={m.id} chip={m.kind} cls="mat" title={m.title} meta={`${m.unit} · ${m.pages} pages · Brolly`}
              on={picked.some(p => p.id === m.id)} onToggle={() => toggle('material', m.id, m.title)} />
          ))}
          {tab === 'practice' && d.practice.map((p: any) => (
            <PickRow key={p.id} chip="Practice lab" cls="lab" title={p.title} meta={`${p.unit} · ${p.level} · unlimited attempts, never marked`}
              on={picked.some(x => x.id === p.id)} onToggle={() => toggle('practice_lab', p.id, p.title)} />
          ))}
          {tab === 'labs' && d.gradedLabs.map((g: any) => (
            <PickRow key={g.id} chip="Graded lab" cls="lab" title={`Program ${g.program_no} — ${g.title}`}
              meta={g.mode === 'uploaded' ? 'Computer lab · upload the sheet · 10 marks' : 'In the app · auto-checked · 10 marks'}
              on={picked.some(x => x.id === g.id)} onToggle={() => toggle('graded_lab', g.id, g.title)} />
          ))}
          {tab === 'mine' && (d.mine.length
            ? d.mine.map((m: any) => (
                <PickRow key={m.id} chip="Mine" cls="mat" title={m.title} meta={m.status === 'shared' ? 'Shared' : 'Draft'}
                  on={picked.some(x => x.id === m.id)} onToggle={() => toggle('teacher_material', m.id, m.title)} />
              ))
            : <Empty title="Nothing of your own yet" detail="Anything you write appears here to assign alongside the Brolly syllabus." />)}

          <Note>
            <strong>Practice labs and graded labs are different on purpose.</strong> Practice can be attempted as
            often as they like and is never marked. A graded lab goes into the practical file and you grade it
            once.
          </Note>
        </>
      )}
    </Page>
  )
}

function PickRow({ chip, cls, title, meta, on, onToggle }:
  { chip: string; cls: string; title: string; meta: string; on: boolean; onToggle: () => void }) {
  return (
    <label className="unit" style={{ cursor: 'pointer' }}>
      <div className="num"><input type="checkbox" checked={on} onChange={onToggle} /></div>
      <div className="body">
        <span className={`tchip ${cls}`}>{chip}</span>
        <div className="t" style={{ marginTop: 5 }}>{title}</div>
        <div className="m">{meta}</div>
      </div>
    </label>
  )
}

// ---------------------------------------------------------------------------

function Labs() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/teacher/labs'))
  return (
    <Page q={q}>
      {(d: any) => {
        const waiting = d.submissions.filter((s: any) => s.status === 'submitted')
        return (
          <>
            <Head title="Lab submissions"
              sub="Both kinds land in one list — written in the app, or done on a lab computer and uploaded" />
            <div className="row tight" style={{ marginBottom: 14 }}>
              <span className={'chip' + (waiting.length ? ' warn' : '')}>{waiting.length} waiting</span>
              <span className="chip">{d.submissions.length - waiting.length} graded</span>
            </div>
            {d.submissions.length === 0
              ? <Empty title="Nothing submitted yet" detail="Graded labs appear here the moment a student submits." />
              : (
                <Table head={['Student', 'Program', 'Where', 'Submitted', 'Auto-check', 'Status', '']}>
                  {d.submissions.map((s: any) => (
                    <tr key={s.id}>
                      <td><strong>{s.student}</strong><div className="tiny muted mono">{s.roll_no} · {s.class_name}</div></td>
                      <td className="small">Program {s.program_no} — {s.title}</td>
                      <td><Pill>{s.mode === 'in_app' ? 'In the app' : 'Uploaded'}</Pill></td>
                      <td className="small muted">{fmtAgo(s.submitted_at)}</td>
                      <td className="mono small">{s.auto_score != null ? `${s.auto_score}/${s.max_score}` : '—'}</td>
                      <td>{s.status === 'graded' ? <Pill tone="ok">{s.score} / {s.max_score}</Pill>
                        : s.status === 'revision' ? <Pill tone="wait">Sent back</Pill>
                        : <Pill tone="wait">Waiting</Pill>}</td>
                      <td>{s.status !== 'graded'
                        ? <button className="btn ghost sm" onClick={() => go('grade', s.id)}>Grade</button>
                        : <button className="btn ghost sm" onClick={() => go('grade', s.id)}>Open</button>}</td>
                    </tr>
                  ))}
                </Table>
              )}
            <Note>
              <strong>The auto-check column is what keeps this list short.</strong> Programs written in the app
              arrive already tested against hidden cases. You confirm and comment; you do not read 38 programs
              line by line.
            </Note>
          </>
        )
      }}
    </Page>
  )
}

function Grade() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/teacher/labs/${param}`), [param])
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
        const detail: any[] = s.auto_detail ?? []

        return (
          <>
            <Crumb to="labs" label="Lab submissions" here="GRADING" />
            <Head title={s.student} sub={`Program ${s.program_no} — ${s.title} · ${s.mode === 'in_app' ? 'in the app' : 'uploaded'} · ${fmtDateTime(s.submitted_at)}`} />
            <div className="grid g2">
              <div>
                {s.mode === 'uploaded' ? (
                  <div className="card">
                    <h3>Uploaded work</h3>
                    <div className="sub" style={{ marginBottom: 12 }}>{s.file_name || 'No file name recorded'}</div>
                    <div className="dropzone" style={{ padding: 52 }}>▤<div style={{ marginTop: 8 }}>Page 1</div></div>
                    {s.student_note ? <Note tone="teal"><strong>From the student:</strong> {s.student_note}</Note> : null}
                  </div>
                ) : (
                  <div className="editor">
                    <div className="bar2">
                      <span className="fn">program_{String(s.program_no).padStart(2, '0')}.py</span>
                      <span className="spacer" />
                      <span className="saved">submitted {fmtAgo(s.submitted_at).toLowerCase()}</span>
                    </div>
                    <textarea readOnly value={s.code} />
                    <div className="console">
                      {detail.length
                        ? <>
                            {detail.map((r, i) => (
                              <span key={i} className={r.passed ? 'pass' : 'fail'}>
                                {r.passed ? '✓' : '✗'} {r.name}{i < detail.length - 1 ? '   ·   ' : ''}
                              </span>
                            ))}
                            {'\n'}
                            {detail.filter(r => !r.passed).map((r, i) => <span key={i} className="dim">{r.detail}{'\n'}</span>)}
                            {`\nAuto-score: ${s.auto_score} / ${s.max_score}`}
                          </>
                        : <span className="dim">No automatic checks for this program.</span>}
                    </div>
                  </div>
                )}
              </div>

              <div>
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
                  <Field label="Comment to the student" error={err}>
                    <textarea value={feedback ?? s.feedback ?? ''} onChange={e => setFeedback(e.target.value)}
                      placeholder="Rounding is the only thing missing. Try round(total/len(marks), 2)." />
                  </Field>
                  <div className="row">
                    <Action label="Send grade" onClick={async () => {
                      setErr('')
                      try {
                        await client.post(`/teacher/labs/${param}/grade`, { scores: current, feedback: feedback ?? s.feedback ?? '' })
                        toast('Grade sent'); go('labs')
                      } catch (e: any) { setErr(e.message) }
                    }} />
                    <Action kind="ghost" label="Ask for a revision" onClick={async () => {
                      await client.post(`/teacher/labs/${param}/grade`, { action: 'revise', feedback: feedback ?? '' })
                      toast('Sent back for revision — no attempt used'); go('labs')
                    }} />
                  </div>
                  <p className="tiny muted" style={{ marginTop: 10 }}>
                    A revision does not use up an attempt. The point is the student fixing it, not the mark.
                  </p>
                </div>
              </div>
            </div>
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Exams() {
  const { go, toast } = useSession()
  const q = useLoad(() => client.get('/teacher/exams'))
  const [scheduling, setScheduling] = useState(false)
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Exams" sub="Fixed date and time. The paper stays locked until it opens."
            right={<button className="btn gold" onClick={() => setScheduling(true)}>Schedule an exam</button>} />
          {d.exams.length === 0
            ? <Empty title="No exams yet" detail="Schedule one from the Brolly question bank. Everyone sits it at the same time."
                action={<button className="btn gold" onClick={() => setScheduling(true)}>Schedule an exam</button>} />
            : (
              <Table head={['Exam', 'Class', 'Starts', 'Length', 'Sat', 'Average', 'Status', '']}>
                {d.exams.map((e: any) => (
                  <tr key={e.id}>
                    <td><strong>{e.title}</strong></td>
                    <td className="mono small">{e.class_name}</td>
                    <td className="small">{fmtDateTime(e.starts_at)}</td>
                    <td className="mono">{e.duration_minutes} min</td>
                    <td className="mono">{e.sat} / {e.enrolled}</td>
                    <td className="mono">{e.avg_pct ? e.avg_pct + '%' : '—'}</td>
                    <td>
                      {e.status === 'released' ? <Pill tone="ok">Released</Pill>
                        : e.to_mark > 0 ? <Pill tone="bad">{e.to_mark} to mark</Pill>
                        : new Date(e.starts_at) > new Date() ? <Pill tone="wait">Scheduled</Pill>
                        : <Pill tone="wait">Marking</Pill>}
                    </td>
                    <td>
                      {e.to_mark > 0
                        ? <button className="btn gold sm" onClick={() => go('mark', e.id)}>Mark</button>
                        : e.sat > 0 && e.status !== 'released'
                          ? <button className="btn ghost sm" onClick={() => go('mark', e.id)}>Open</button>
                          : null}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          <Note>
            <strong>Objective questions mark themselves.</strong> Only written answers reach you — which is what
            stops 38 papers becoming an evening’s work.
          </Note>

          {scheduling && (
            <ScheduleExam data={d} onClose={() => setScheduling(false)}
              onDone={n => { setScheduling(false); toast(`Scheduled for ${n} students · locked until it opens`); q.reload() }} />
          )}
        </>
      )}
    </Page>
  )
}

function ScheduleExam({ data, onClose, onDone }: { data: any; onClose: () => void; onDone: (n: number) => void }) {
  const tomorrow = new Date(Date.now() + 864e5)
  const [f, setF] = useState({
    classId: data.classes[0]?.id ?? '', blueprintId: data.blueprints[0]?.id ?? '',
    date: tomorrow.toISOString().slice(0, 10), time: '10:00', durationMinutes: '45',
  })
  const [err, setErr] = useState('')
  const bp = data.blueprints.find((b: any) => b.id === f.blueprintId)

  return (
    <Modal title="Schedule an exam" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Everyone sits it at the same time, in the school lab.</p>
      <Field label="Paper">
        <select value={f.blueprintId} onChange={e => setF({ ...f, blueprintId: e.target.value })}>
          {data.blueprints.map((b: any) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
      </Field>
      <Field label="Class">
        <select value={f.classId} onChange={e => setF({ ...f, classId: e.target.value })}>
          {data.classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="grid g3" style={{ gap: 10 }}>
        <Field label="Date"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Start time"><input type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></Field>
        <Field label="Length">
          <select value={f.durationMinutes} onChange={e => setF({ ...f, durationMinutes: e.target.value })}>
            <option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option>
          </select>
        </Field>
      </div>

      {bp ? (
        <>
          <h3 style={{ marginTop: 12 }}>The paper</h3>
          <div className="sub" style={{ marginBottom: 10 }}>Assembled from the Brolly question bank and snapshotted now</div>
          <div className="unit">
            <div className="num">{bp.questions}</div>
            <div className="body"><div className="t">Questions</div>
              <div className="m">Objective marked automatically · written marked by you</div></div>
          </div>
        </>
      ) : null}

      <Note tone="teal">
        <strong>Results are not released automatically.</strong> They wait until you have marked the written
        answers and pressed release — so no student ever sees half a result.
      </Note>
      {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
      <div className="row" style={{ marginTop: 14 }}>
        <Action label="Schedule it" onClick={async () => {
          setErr('')
          try {
            const startsAt = new Date(`${f.date}T${f.time}:00`).toISOString()
            const r = await client.post('/teacher/exams', {
              classId: f.classId, blueprintId: f.blueprintId, startsAt,
              durationMinutes: Number(f.durationMinutes),
            })
            onDone(r.students)
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

function Marking() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/teacher/exams/${param}/marking`), [param])
  const [marks, setMarks] = useState<Record<string, number>>({})
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const left = d.answers.filter((a: any) => a.marks_awarded == null && !saved.has(a.id)).length
        const byQuestion = d.questions.map((qq: any) => ({
          question: qq,
          answers: d.answers.filter((a: any) => a.question_id === qq.id),
        }))
        return (
          <>
            <Crumb to="exams" label="Exams" here="MARK PAPERS" />
            <Head title={d.exam.title} sub={`${d.exam.class_name} · ${d.stats.papers} papers · objective already marked`} />
            <div className="grid g4">
              <Stat small k="Papers" v={d.stats.papers} d="All submitted" />
              <Stat small k="Objective" v="Marked" d="Automatically, on submission" />
              <Stat small k="Written left" v={left} d="Only these reach you" />
              <Stat small k="Objective avg" v={d.stats.avg_objective ?? '—'} d="Out of the objective marks" />
            </div>

            {byQuestion.map(({ question, answers }: any) => (
              <div key={question.id}>
                <Head title={`Question ${question.position}`} sub={`${question.text} (${question.marks} marks)`} />
                {answers.map((a: any) => {
                  const value = marks[a.id] ?? a.marks_awarded ?? ''
                  const done = saved.has(a.id) || a.marks_awarded != null
                  return (
                    <div className="qcard" key={a.id}>
                      <div className="qn">{a.student} · {a.roll_no}</div>
                      <div className="qt" style={{ fontWeight: 400 }}>{a.text_answer || <span className="muted">No answer written.</span>}</div>
                      <div className="row" style={{ alignItems: 'center' }}>
                        <div style={{ width: 160 }}>
                          <Field label={`Marks out of ${a.max_marks}`}>
                            <input type="number" min={0} max={a.max_marks} value={value}
                              onChange={e => setMarks({ ...marks, [a.id]: Number(e.target.value) })} />
                          </Field>
                        </div>
                        <div style={{ flex: 1 }} />
                        <div style={{ paddingBottom: 14 }}>
                          <Action small kind={done ? 'ghost' : 'gold'} label={done ? 'Marked ✓' : 'Save mark'}
                            onClick={async () => {
                              setErr('')
                              try {
                                await client.post(`/teacher/exams/${param}/marks`, {
                                  marks: [{ answerId: a.id, marks: Number(value || 0) }],
                                })
                                setSaved(s => new Set([...s, a.id]))
                              } catch (e: any) { setErr(e.message) }
                            }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
            <div className="row" style={{ marginTop: 12 }}>
              <Action label={`Mark all remaining at full marks`} kind="ghost" onClick={async () => {
                const payload = d.answers
                  .filter((a: any) => a.marks_awarded == null && !saved.has(a.id))
                  .map((a: any) => ({ answerId: a.id, marks: marks[a.id] ?? a.max_marks }))
                if (!payload.length) return
                await client.post(`/teacher/exams/${param}/marks`, { marks: payload })
                setSaved(s => new Set([...s, ...payload.map((p: any) => p.answerId)]))
                toast(`${payload.length} answers marked`)
              }} />
              <Action label={`Release results to ${d.stats.papers} students`} onClick={async () => {
                setErr('')
                try {
                  const r = await client.post(`/teacher/exams/${param}/release`)
                  toast(`Results released to ${r.students} students`); go('exams')
                } catch (e: any) { setErr(e.message) }
              }} />
            </div>
            <Note>
              <strong>Release is one deliberate action.</strong> Until you press it, students see “being marked” —
              not a partial score that changes under them.
            </Note>
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Reports() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/teacher/reports'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Exam reports" sub="Results for the exams you have run" />
          <div className="grid g4">
            <Stat small k="Exams run" v={d.summary?.exams ?? 0} d="This term" />
            <Stat small k="Class average" v={d.summary?.avg_pct ? d.summary.avg_pct + '%' : '—'} d="All released papers" />
            <Stat small k="Papers" v={d.exams.reduce((a: number, e: any) => a + (e.sat ?? 0), 0)} d="Sat in total" />
            <Stat small k="Questions analysed" v={d.questionAnalysis.length} d="Weakest first" />
          </div>

          <Head title="Exam by exam" />
          <Table head={['Exam', 'Class', 'Date', 'Sat', 'Average', '']}>
            {d.exams.map((e: any) => (
              <tr key={e.id}>
                <td><strong>{e.title}</strong></td>
                <td className="mono small">{e.class_name}</td>
                <td className="small">{fmtDate(e.starts_at)}</td>
                <td className="mono">{e.sat}</td>
                <td className="mono">{e.avg_pct ? e.avg_pct + '%' : '—'}</td>
                <td>{e.status !== 'released'
                  ? <button className="btn ghost sm" onClick={() => go('mark', e.id)}>Open</button> : null}</td>
              </tr>
            ))}
          </Table>

          {d.questionAnalysis.length ? (
            <>
              <Head title="Which questions went wrong" sub="Same paper, every student who sat it" />
              <div className="card">
                {d.questionAnalysis.map((qa: any, i: number) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div className="small">Q{qa.position} — {qa.text.slice(0, 80)}{qa.text.length > 80 ? '…' : ''}</div>
                    <Bar v={qa.pct} />
                  </div>
                ))}
                {(() => {
                  const worst = d.questionAnalysis[0]
                  return worst && worst.pct < 50 ? (
                    <div className="tiny muted">
                      Only {worst.pct}% got Q{worst.position} right. That is a teaching problem, not a student
                      problem — reteach it before the next unit.
                    </div>
                  ) : null
                })()}
              </div>
            </>
          ) : null}

          {d.students?.length ? (
            <>
              <Head title="Student by student" sub="Released results only" />
              <Table head={['Student', 'Roll', 'Objective', 'Written', 'Overall']}>
                {d.students.map((s: any, i: number) => (
                  <tr key={i}>
                    <td><strong>{s.full_name}</strong></td>
                    <td className="mono small">{s.roll_no}</td>
                    <td className="mono">{s.objective ?? '—'}</td>
                    <td className="mono">{s.written ?? '—'}</td>
                    <td style={{ minWidth: 160 }}><Bar v={s.pct} /></td>
                  </tr>
                ))}
              </Table>
            </>
          ) : null}

          <Note>
            <strong>This screen replaces guessing.</strong> You know which question the class failed, not just who
            failed the paper.
          </Note>
        </>
      )}
    </Page>
  )
}

function Announcements() {
  const { toast } = useSession()
  const q = useLoad(() => client.get('/teacher/announcements'))
  const classes = useLoad(() => client.get('/teacher/classes'))
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Announcements" sub="A note to the whole class. Not a chat." />
          <div className="card" style={{ marginBottom: 14 }}>
            <Field label="To">
              <div className="row tight">
                {(classes.data as any)?.classes?.map((c: any) => (
                  <button key={c.id} className={'chip act' + (picked.includes(c.id) ? ' warn' : '')}
                    onClick={() => setPicked(p => p.includes(c.id) ? p.filter(x => x !== c.id) : [...p, c.id])}>
                    {c.name} {picked.includes(c.id) ? '✓' : ''}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Message" error={err}>
              <textarea value={body} onChange={e => setBody(e.target.value)}
                placeholder="Bring your lab notebook on Monday. We will do the flowchart for Program 8 on paper first, then type it." />
            </Field>
            <Action label="Post to the class" disabled={!picked.length || !body.trim()} onClick={async () => {
              setErr('')
              try {
                const r = await client.post('/teacher/announcements', { classIds: picked, body })
                toast(`Posted to ${r.students} students`); setBody(''); setPicked([]); q.reload()
              } catch (e: any) { setErr(e.message) }
            }} />
          </div>

          <Head title="Posted" />
          {d.announcements.length
            ? d.announcements.map((a: any) => (
                <div className="card" key={a.id} style={{ marginBottom: 9 }}>
                  <div className="tiny muted">{fmtAgo(a.created_at)} · {a.class_name} · {a.students} students</div>
                  <div style={{ marginTop: 5 }}>{a.body}</div>
                </div>
              ))
            : <Empty title="Nothing posted yet" />}

          <Note>
            <strong>Why announcements and not messaging.</strong> A one-way class post is safe by design. There
            is no private teacher-to-student channel that a parent cannot see.
          </Note>
        </>
      )}
    </Page>
  )
}

function Profile() {
  const { me, toast, reload } = useSession()
  const [fullName, setFullName] = useState(me.user.fullName)
  const q = useLoad(() => client.get('/teacher/classes'))
  return (
    <>
      <Head title="My profile" sub={me.user.fullName} />
      <div className="grid g2">
        <div className="card">
          <h3>My details</h3>
          <div className="sub" style={{ marginBottom: 12 }}>Your school admin can also change these</div>
          <Field label="Full name"><input value={fullName} onChange={e => setFullName(e.target.value)} /></Field>
          <Field label="Email" help="This is your username. Only your school admin can change it.">
            <input value={me.user.email ?? ''} readOnly />
          </Field>
          <Action label="Save" onClick={async () => {
            await client.patch('/me', { fullName }); toast('Saved'); await reload()
          }} />
        </div>
        <div className="card">
          <h3>My teaching</h3>
          <div className="sub" style={{ marginBottom: 12 }}>This term</div>
          <Page q={q}>
            {(d: any) => (
              <>
                {[['Classes', d.classes.length],
                  ['Students', d.classes.reduce((a: number, c: any) => a + c.students, 0)],
                  ['Waiting to grade', d.classes.reduce((a: number, c: any) => a + c.pending_labs, 0)]].map(([k, v]: any) => (
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
