import React, { useEffect, useRef, useState } from 'react'
import * as client from '../api.ts'
import {
  Action, Bar, Crumb, Empty, Field, Head, Modal, Note, Page, Pill, Stat, Table,
  fmtAgo, fmtDate, fmtDateTime, mmss, useLoad, useSession,
} from '../ui.tsx'
import { Blocks } from '../blocks.tsx'
import { runTests, loadPython } from '../python.ts'

export default function StudentPortal() {
  const { screen } = useSession()
  switch (screen) {
    case 'videos': return <Videos />
    case 'video': return <VideoView />
    case 'materials': return <Materials />
    case 'material': return <MaterialView />
    case 'teacherMaterial': return <TeacherMaterialView />
    case 'practice': return <Practice />
    case 'practiceLab': return <PracticeLab />
    case 'labs': return <GradedLabs />
    case 'lab': return <GradedLab />
    case 'exams': return <Exams />
    case 'exam': return <ExamRoom />
    case 'results': return <Results />
    case 'file': return <PracticalFile />
    case 'profile': return <Profile />
    default: return <Home />
  }
}

const durationLabel = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// ---------------------------------------------------------------------------

function Home() {
  const { me, go } = useSession()
  const q = useLoad(() => client.get('/student/home'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title={`Hello, ${me.user.fullName.split(' ')[0]}`} sub={`${me.tenant.name}`} />
          <div className="grid g4">
            <Stat small k="Videos watched" v={`${d.counts.videos_done} / ${d.counts.videos_total}`} />
            <Stat small k="Materials read" v={`${d.counts.materials_done} / ${d.counts.materials_total}`} />
            <Stat small k="Practice solved" v={`${d.counts.practice_done} / ${d.counts.practice_total}`} />
            <Stat small k="Graded labs" v={`${d.counts.labs_done} / ${d.counts.labs_total}`} d="Practical file" />
          </div>

          <Head title="Carry on where you stopped" />
          {d.continueItems.length
            ? (
              <div className="lib">
                {d.continueItems.map((v: any) => (
                  <button className="libcard" key={v.id} onClick={() => go('video', v.id)}>
                    <div className="thumb">
                      <div className="play">▶</div>
                      <span className="dur">{durationLabel(v.duration_seconds)}</span>
                      {v.percent > 0 ? <div className="prog"><i style={{ width: `${v.percent}%` }} /></div> : null}
                    </div>
                    <div className="pad">
                      <span className="tchip vid">Video</span><h4>{v.title}</h4>
                      <div className="meta">{v.percent > 0 ? `${Math.round(v.percent)}% watched` : 'Not started'} · {v.unit}</div>
                    </div>
                  </button>
                ))}
              </div>
            )
            : <Empty title="You are up to date" detail="Everything assigned so far is finished. Nicely done." />}

          <Head title="Coming up" />
          <div className="grid g2">
            {d.nextExam ? (
              <div className="card">
                <span className="tchip exam">Exam</span>
                <h3 style={{ marginTop: 7 }}>{d.nextExam.title}</h3>
                <div className="sub">{fmtDateTime(d.nextExam.starts_at)} · {d.nextExam.duration_minutes} minutes</div>
                <div style={{ marginTop: 12 }}>
                  <button className="btn ghost sm" onClick={() => go('exam', d.nextExam.id)}>See details</button>
                </div>
              </div>
            ) : null}
            {d.nextLab ? (
              <div className="card">
                <span className="tchip lab">Graded lab</span>
                <h3 style={{ marginTop: 7 }}>Program {d.nextLab.program_no} — {d.nextLab.title}</h3>
                <div className="sub">Goes into your practical file</div>
                <div style={{ marginTop: 12 }}>
                  <button className="btn gold sm" onClick={() => go('lab', d.nextLab.id)}>Open lab</button>
                </div>
              </div>
            ) : null}
          </div>

          {d.announcements.length ? (
            <>
              <Head title="From your teacher" />
              {d.announcements.map((a: any, i: number) => (
                <div className="card" key={i} style={{ marginBottom: 9 }}>
                  <div className="small"><strong>{a.teacher}</strong> <span className="muted">· {fmtAgo(a.created_at)}</span></div>
                  <div style={{ marginTop: 6 }}>{a.body}</div>
                </div>
              ))}
            </>
          ) : null}

          <Note>
            <strong>Parents use this same login.</strong> Everything a parent needs — what is due, what is done,
            what the teacher said — is on this screen.
          </Note>
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Videos() {
  const { go } = useSession()
  const [unit, setUnit] = useState('all')
  const q = useLoad(() => client.get('/student/videos'))
  return (
    <Page q={q}>
      {(d: any) => {
        const list = unit === 'all' ? d.videos : d.videos.filter((v: any) => v.unit === unit)
        return (
          <>
            <Head title="Videos" sub="Watch, then try it in a practice lab" />
            <div className="filters">
              <button className={unit === 'all' ? 'on' : ''} onClick={() => setUnit('all')}>All</button>
              {d.units.map((u: any) => (
                <button key={u.id} className={unit === u.code ? 'on' : ''} onClick={() => setUnit(u.code)}>
                  {u.code} · {u.title.split('—')[0].trim()}
                </button>
              ))}
            </div>
            <div className="lib">
              {list.map((v: any) => (
                <button className="libcard" key={v.id} onClick={() => go('video', v.id)}>
                  <div className="thumb">
                    <div className="play">▶</div>
                    <span className="dur">{durationLabel(v.duration_seconds)}</span>
                    {v.percent > 0 ? <div className="prog"><i style={{ width: `${v.percent}%` }} /></div> : null}
                  </div>
                  <div className="pad">
                    <span className="tchip vid">Video</span><h4>{v.title}</h4>
                    <div className="meta">
                      {v.status === 'completed' ? <Pill tone="ok">Watched</Pill>
                        : v.percent > 0 ? <Pill tone="wait">{Math.round(v.percent)}% watched</Pill>
                        : <Pill tone="mute">Not started</Pill>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )
      }}
    </Page>
  )
}

function VideoView() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/videos/${param}`), [param])
  const [note, setNote] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)

  // A real player would report position; here the timer stands in for playback
  // and the progress it writes is the same row a teacher's dashboard reads.
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setPos(p => p + 1), 1000)
    return () => clearInterval(t)
  }, [playing])

  // Seed the scrub position from saved progress once the video has loaded.
  // Doing this in an effect rather than during render keeps React from
  // updating this component while Page is still rendering.
  const loaded = q.data as any
  useEffect(() => {
    if (!loaded) return
    setPos(Math.round((loaded.progress?.percent ?? 0) / 100 * loaded.video.duration_seconds))
  }, [loaded?.video?.id])

  return (
    <Page q={q}>
      {(d: any) => {
        const pct = Math.min(100, Math.round(pos / d.video.duration_seconds * 100))
        return (
          <>
            <Crumb to="videos" label="Videos" here={d.video.title.toUpperCase()} />
            <Head title={d.video.title} sub={`${d.video.unit} — ${d.video.unit_title} · ${durationLabel(d.video.duration_seconds)}`} />
            <div className="grid g2" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
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
                    setPos(Math.round((e.clientX - r.left) / r.width * d.video.duration_seconds))
                  }}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <span>{durationLabel(d.video.duration_seconds)}</span>
                </div>

                <div className="row" style={{ marginTop: 14 }}>
                  <Action label={pct >= 95 ? 'Mark as watched' : `Save progress (${pct}%)`} onClick={async () => {
                    await client.post(`/student/videos/${param}/progress`, { percent: pct >= 95 ? 100 : pct, seconds: pos })
                    toast(pct >= 95 ? 'Marked as watched' : 'Progress saved'); q.reload()
                  }} />
                  <button className="btn ghost" onClick={() => go('practice')}>Try it in a practice lab</button>
                  <button className="btn ghost" onClick={() => go('materials')}>Read the notes</button>
                </div>

                <div className="card" style={{ marginTop: 14 }}>
                  <h3>What this video covers</h3>
                  <ul className="small" style={{ margin: '9px 0 0', paddingLeft: 18, lineHeight: 1.9, color: 'var(--slate)' }}>
                    {(d.video.summary ?? []).map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              </div>

              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>My notes</h3>
                  <div className="sub" style={{ marginBottom: 10 }}>Only you can see these</div>
                  <div className="field">
                    <textarea value={note ?? d.note} onChange={e => setNote(e.target.value)}
                      placeholder="Write while you watch…" style={{ minHeight: 130 }} />
                  </div>
                  <Action small kind="ghost" label="Save note" onClick={async () => {
                    await client.put(`/student/videos/${param}/note`, { body: note ?? d.note })
                    toast('Note saved')
                  }} />
                </div>
                <div className="card">
                  <h3>Next in {d.video.unit}</h3>
                  {d.nextInUnit.map((v: any) => (
                    <div className="unit" key={v.id} style={{ marginBottom: 7, cursor: 'pointer' }} onClick={() => go('video', v.id)}>
                      <div className="num">▶</div>
                      <div className="body">
                        <div className="t" style={{ fontSize: 14 }}>{v.title}</div>
                        <div className="m">{durationLabel(v.duration_seconds)}</div>
                      </div>
                    </div>
                  ))}
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

function Materials() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/student/materials'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Materials" sub="Notes, worksheets and reference sheets you can read any time" />
          <div className="lib">
            {d.materials.map((m: any) => (
              <button className="libcard" key={m.id} onClick={() => go('material', m.id)}>
                <div className="thumb mat"><div style={{ fontSize: 28 }}>▤</div></div>
                <div className="pad">
                  <span className="tchip mat">{m.kind}</span><h4>{m.title}</h4>
                  <div className="meta">{m.unit} · {m.pages} pages {m.read ? <Pill tone="ok">Read</Pill> : null}</div>
                </div>
              </button>
            ))}
          </div>

          {d.fromTeacher.length ? (
            <>
              <Head title="From your teacher" sub="Made by your own teacher, for your class" />
              <div className="lib">
                {d.fromTeacher.map((m: any) => (
                  <button className="libcard" key={m.id} onClick={() => go('teacherMaterial', m.id)}>
                    <div className="thumb lab"><div style={{ fontSize: 28 }}>✎</div></div>
                    <div className="pad">
                      <span className="tchip lab">{m.kind}</span><h4>{m.title}</h4>
                      <div className="meta">from {m.teacher} · {fmtAgo(m.created_at)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </Page>
  )
}

function MaterialView() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/materials/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="materials" label="Materials" here={d.material.title.toUpperCase()} />
          <Head title={d.material.title} sub={`${d.material.kind} · ${d.material.pages} pages · ${d.material.unit}`}
            right={<Action label="Mark as read" onClick={async () => {
              await client.post(`/student/materials/${param}/read`); toast('Marked as read'); go('materials')
            }} />} />
          <div className="doc"><Blocks blocks={d.material.body} /></div>
          <Note>
            <strong>This is the same material your teacher gave in class.</strong> You can read it as many times
            as you like, and it stays here after the lesson is over.
            {d.material.version_no > 1
              ? ` This copy is version ${d.material.version_no}, updated ${fmtAgo(d.material.published_at).toLowerCase()}.`
              : null}
          </Note>
        </>
      )}
    </Page>
  )
}

function TeacherMaterialView() {
  const { param } = useSession()
  const q = useLoad(() => client.get(`/student/teacher-materials/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="materials" label="Materials" here={d.material.title.toUpperCase()} />
          <Head title={d.material.title} sub={`From ${d.material.teacher} · ${fmtAgo(d.material.created_at)}`} />
          <div className="doc"><Blocks blocks={d.material.body} /></div>
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Practice() {
  const { go } = useSession()
  const [level, setLevel] = useState('all')
  const q = useLoad(() => client.get('/student/practice'))
  return (
    <Page q={q}>
      {(d: any) => {
        const list = level === 'all' ? d.labs : d.labs.filter((l: any) => l.level === level)
        return (
          <>
            <Head title="Practice labs" sub="Try as many times as you like. Nothing here is marked." />
            <div className="grid g4" style={{ marginBottom: 18 }}>
              <Stat small k="Solved" v={d.stats.solved} d={`of ${d.stats.total} practice labs`} />
              <Stat small k="Attempts" v={d.stats.attempts} d="Practice does not cost you marks" />
              <Stat small k="Graded labs" v={`${d.stats.labs_done} / ${d.stats.labs_total}`} d="Those do count" />
              <Stat small k="Python" v="In your browser" d="Nothing to install" />
            </div>
            <div className="filters">
              {['all', 'Easy', 'Medium', 'Hard'].map(l => (
                <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
                  {l === 'all' ? 'All' : l}
                </button>
              ))}
            </div>
            <div className="lib">
              {list.map((p: any) => (
                <button className="libcard" key={p.id} onClick={() => go('practiceLab', p.id)}>
                  <div className="thumb lab"><div style={{ fontSize: 26 }}>▧</div></div>
                  <div className="pad">
                    <span className="tchip lab">{p.level}</span><h4>{p.title}</h4>
                    <div className="meta">
                      {p.attempts ? `${p.attempts} attempt${p.attempts === 1 ? '' : 's'}` : 'Not tried yet'}
                      {p.status === 'completed' ? <> · <Pill tone="ok">Solved</Pill></> : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <Note>
              <strong>Practice first, then the graded lab.</strong> Nothing you do here affects your marks, so try
              the wrong thing on purpose and see what the error says.
            </Note>
          </>
        )
      }}
    </Page>
  )
}

function PracticeLab() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/practice/${param}`), [param])
  const [hintsShown, setHintsShown] = useState(0)
  const [solution, setSolution] = useState(false)

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="practice" label="Practice labs" here="PRACTICE" />
          <Head title={d.lab.title} sub={`${d.lab.level} · ${d.lab.unit} · not marked`} />
          <Note tone="teal">
            <strong>This is practice.</strong> Run it as many times as you like. Nothing is sent to your teacher
            and nothing counts towards your marks.
          </Note>

          <div className="grid g2" style={{ marginTop: 14 }}>
            <div>
              <div className="card" style={{ marginBottom: 14 }}>
                <h3>What to do</h3>
                <p className="small" style={{ margin: '8px 0 0' }}>{d.lab.brief}</p>
              </div>
              <div className="card">
                <h3>Stuck?</h3>
                {(d.lab.hints ?? []).slice(0, hintsShown).map((h: string, i: number) => (
                  <div className="unit" key={i} style={{ marginBottom: 7 }}>
                    <div className="num">{i + 1}</div>
                    <div className="body"><div className="m">{h}</div></div>
                  </div>
                ))}
                {hintsShown < (d.lab.hints ?? []).length ? (
                  <button className="btn ghost sm" onClick={() => setHintsShown(h => h + 1)}>
                    {hintsShown === 0 ? 'Show a hint' : 'Show a bigger hint'}
                  </button>
                ) : (
                  <>
                    {!solution
                      ? <button className="btn ghost sm" onClick={() => setSolution(true)}>Show the answer</button>
                      : <pre className="console" style={{ borderRadius: 10, marginTop: 8 }}>{d.lab.solution}</pre>}
                  </>
                )}
                <div className="tiny muted" style={{ marginTop: 8 }}>
                  Looking at the answer is allowed here. It is not allowed in a graded lab.
                </div>
              </div>
            </div>

            <CodeRunner
              filename="practice.py"
              starter={d.lab.starterCode}
              tests={d.lab.tests}
              runLabel="Run"
              onRun={async (code, outputs, stdout) => {
                const r = await client.post(`/student/practice/${param}/attempt`, { code, outputs, stdout })
                if (r.solved) toast('Solved. Nothing was sent to your teacher.')
                return r
              }}
              footer={<button className="btn ghost" onClick={() => go('practice')}>Back to practice labs</button>}
            />
          </div>
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function GradedLabs() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/student/labs'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Graded labs" sub="These count. Each one goes into your practical file."
            right={<button className="btn ghost" onClick={() => go('file')}>My practical file</button>} />
          <Table head={['#', 'Program', 'Where', 'Status', '']}>
            {d.labs.map((l: any) => (
              <tr key={l.id}>
                <td className="mono">{l.program_no}</td>
                <td><strong>{l.title}</strong></td>
                <td><Pill>{l.mode === 'in_app' ? 'In the app' : l.mode === 'uploaded' ? 'Computer lab' : 'Either'}</Pill></td>
                <td>
                  {l.status === 'graded' ? <Pill tone="ok">{l.score} / {l.max_score}</Pill>
                    : l.status === 'revision' ? <Pill tone="wait">Fix and resubmit</Pill>
                    : l.status === 'submitted' ? <Pill tone="wait">Waiting for your teacher</Pill>
                    : <Pill tone="mute">Not started</Pill>}
                </td>
                <td><button className="btn ghost sm" onClick={() => go('lab', l.id)}>
                  {l.status === 'graded' ? 'See feedback' : 'Open'}
                </button></td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Page>
  )
}

function GradedLab() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/labs/${param}`), [param])
  const [mode, setMode] = useState<'in_app' | 'uploaded' | null>(null)
  const [fileName, setFileName] = useState('')
  const [studentNote, setStudentNote] = useState('')
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const s = d.submission
        const chosen = mode ?? (d.lab.mode === 'uploaded' ? 'uploaded' : 'in_app')
        const locked = s?.status === 'graded'
        return (
          <>
            <Crumb to="labs" label="Graded labs" here={`PROGRAM ${d.lab.programNo}`} />
            <Head title={`Program ${d.lab.programNo} — ${d.lab.title}`} sub="Practical file" />
            <div className="row tight" style={{ marginBottom: 14 }}>
              <span className="chip">{d.lab.maxScore} marks</span>
              {s?.status === 'graded' ? <span className="chip">Graded {s.score} / {d.lab.maxScore}</span>
                : s?.status === 'submitted' ? <span className="chip warn">Submitted — waiting</span>
                : s?.status === 'revision' ? <span className="chip warn">Sent back for a fix</span>
                : <span className="chip warn">Not submitted</span>}
            </div>

            {s?.status === 'graded' || s?.status === 'revision' ? (
              <Note tone={s.status === 'graded' ? 'teal' : undefined}>
                <strong>{s.status === 'graded' ? `Your teacher gave this ${s.score} / ${d.lab.maxScore}.` : 'Your teacher sent this back.'}</strong>
                {s.feedback ? ` ${s.feedback}` : ''}
                {s.status === 'revision' ? ' Fixing it does not use up an attempt.' : ''}
              </Note>
            ) : null}

            <div className="grid g2">
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>What to do</h3>
                  <p className="small" style={{ margin: '8px 0 0' }}>{d.lab.brief}</p>
                </div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>Rubric</h3>
                  <div className="sub" style={{ marginBottom: 10 }}>You can see this before you start</div>
                  <table className="rubric">
                    <tbody>
                      {(d.lab.rubric ?? []).map((r: any) => (
                        <tr key={r.key}>
                          <td>{r.label}</td>
                          <td className="mono muted" style={{ textAlign: 'right' }}>{r.max}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.lab.mode === 'either' ? (
                  <div className="card">
                    <h3>Doing this in the computer lab?</h3>
                    <p className="small muted" style={{ margin: '8px 0 12px' }}>
                      Write it on the lab machine, then upload the file or a photo of your lab sheet. Both count the same.
                    </p>
                    <div className="row tight">
                      <button className={'btn sm ' + (chosen === 'in_app' ? 'gold' : 'ghost')} onClick={() => setMode('in_app')}>Type it here</button>
                      <button className={'btn sm ' + (chosen === 'uploaded' ? 'gold' : 'ghost')} onClick={() => setMode('uploaded')}>Upload instead</button>
                    </div>
                  </div>
                ) : null}
              </div>

              {chosen === 'uploaded' ? (
                <div className="card">
                  <h3>Upload your work</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>A file from the lab machine, or a photo of your written sheet</div>
                  <label className="dropzone" style={{ display: 'block', cursor: 'pointer' }}>
                    <input type="file" style={{ display: 'none' }} onChange={e => setFileName(e.target.files?.[0]?.name ?? '')} />
                    {fileName ? <><strong>{fileName}</strong><br /><span className="tiny">Click to choose a different file</span></>
                      : <>Drop a file, or <strong>browse</strong><br /><span className="tiny">PDF, image or .py file · up to 10 MB</span></>}
                  </label>
                  <Field label="A note for your teacher">
                    <textarea value={studentNote} onChange={e => setStudentNote(e.target.value)}
                      placeholder="I could not finish the last part — the loop kept running forever." />
                  </Field>
                  {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
                  <Action label="Submit lab report" disabled={locked || !fileName} onClick={async () => {
                    setErr('')
                    try {
                      await client.post(`/student/labs/${param}/submit`, { mode: 'uploaded', fileName, note: studentNote })
                      toast('Submitted to your teacher'); go('file')
                    } catch (e: any) { setErr(e.message) }
                  }} />
                  <Note tone="teal">
                    <strong>Both kinds of lab count the same.</strong> Whether you typed it here or wrote it on a
                    lab computer, it goes into the same practical file.
                  </Note>
                </div>
              ) : (
                <CodeRunner
                  filename={`program_${String(d.lab.programNo).padStart(2, '0')}.py`}
                  starter={d.lab.starterCode}
                  tests={d.lab.tests}
                  runLabel="Run"
                  disabled={locked}
                  onRun={(code, outputs) => client.post(`/student/labs/${param}/run`, { code, outputs })}
                  onSubmit={locked ? undefined : async (code, outputs, stdout) => {
                    const r = await client.post(`/student/labs/${param}/submit`, { mode: 'in_app', code, outputs, stdout })
                    toast(`Submitted · auto-check ${r.autoScore}/${d.lab.maxScore}. Your teacher grades it next.`)
                    q.reload()
                    return r
                  }}
                  footer={<p className="tiny muted" style={{ marginTop: 10 }}>
                    Run as many times as you like — only Submit counts.
                  </p>}
                />
              )}
            </div>
          </>
        )
      }}
    </Page>
  )
}

// ---------------------------------------------------------------------------

/**
 * Python runs in this tab, via Pyodide. The source rules ("use a loop") are
 * re-checked on the server, so a student cannot pass by editing the page.
 */
function CodeRunner({ filename, starter, tests, onRun, onSubmit, footer, runLabel = 'Run', disabled }: {
  filename: string
  starter: string
  tests: Array<{ name: string; stdin?: string }>
  onRun: (code: string, outputs: Record<string, string>, stdout: string) => Promise<any>
  onSubmit?: (code: string, outputs: Record<string, string>, stdout: string) => Promise<any>
  footer?: React.ReactNode
  runLabel?: string
  disabled?: boolean
}) {
  const [code, setCode] = useState(starter)
  const [out, setOut] = useState<React.ReactNode>('Press Run. Get it wrong as many times as you like.')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('saved just now')

  // Autosave is local here; the value of saying so is that a student on a
  // flaky school connection knows their typing is not at risk.
  useEffect(() => {
    setSaved('saving…')
    const t = setTimeout(() => setSaved('saved just now'), 500)
    return () => clearTimeout(t)
  }, [code])

  const execute = async (submit: boolean) => {
    setBusy(true)
    setOut(<span className="dim">Starting Python…</span>)
    try {
      await loadPython()
      setOut(<span className="dim">Running…</span>)
      const { outputs, stdout, stderr } = await runTests(code, tests)
      if (stderr) {
        setOut(<>
          {stdout ? <>{stdout}{'\n'}</> : null}
          <span className="fail">{stderr}</span>
          {'\n'}<span className="dim">Read the last line first — it usually names the line that broke.</span>
        </>)
        if (!submit) { setBusy(false); return }
      }
      const r = submit && onSubmit
        ? await onSubmit(code, outputs, stdout)
        : await onRun(code, outputs, stdout)

      const results: any[] = r.results ?? r.auto_detail ?? []
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
        {r.passed === r.total && r.total > 0
          ? <span className="pass">{'\n'}All tests passed.{submit ? '' : ' You can submit this.'}</span>
          : null}
        {r.autoScore != null ? <span className="dim">{'\n'}Auto-score: {r.autoScore} / 10 — your teacher grades it next.</span> : null}
      </>)
    } catch (e: any) {
      setOut(<span className="fail">{e.message ?? 'Could not run that.'}</span>)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="editor">
        <div className="bar2">
          <span className="fn">{filename}</span>
          <span className="spacer" />
          <span className="saved">{saved}</span>
        </div>
        <textarea value={code} onChange={e => setCode(e.target.value)} spellCheck={false} disabled={disabled} />
        <div className="console">{busy ? <><span className="spinner" /> </> : null}{out}</div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className={'btn ' + (onSubmit ? 'ghost' : 'gold')} disabled={busy || disabled} onClick={() => execute(false)}>
          {busy ? <><span className="spinner dark" /> Running</> : runLabel}
        </button>
        {onSubmit ? (
          <button className="btn gold" disabled={busy || disabled} onClick={() => execute(true)}>Submit to teacher</button>
        ) : null}
        {footer}
      </div>
      {tests.length ? (
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Your code is checked against {tests.length} hidden test{tests.length === 1 ? '' : 's'}. Python runs in
          this browser tab — nothing is installed and nothing is sent anywhere until you submit.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Exams() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/student/exams'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Exams" sub="Fixed date and time. The paper unlocks by itself." />
          {d.exams.length === 0
            ? <Empty title="No exams scheduled" detail="Your teacher will schedule one. You will see it here with the date and time." />
            : (
              <Table head={['Exam', 'When', 'Length', 'Status', '']}>
                {d.exams.map((e: any) => (
                  <tr key={e.id}>
                    <td><strong>{e.title}</strong></td>
                    <td className="small">{fmtDateTime(e.starts_at)}</td>
                    <td className="mono">{e.duration_minutes} min</td>
                    <td>
                      {e.status === 'released' ? <Pill tone="ok">Results out</Pill>
                        : e.attempt_status === 'submitted' || e.attempt_status === 'marked' ? <Pill tone="wait">Being marked</Pill>
                        : new Date(e.starts_at) > new Date() ? <Pill tone="mute">Locked until {fmtDateTime(e.starts_at)}</Pill>
                        : <Pill tone="bad">Open now</Pill>}
                    </td>
                    <td><button className="btn ghost sm" onClick={() => go('exam', e.id)}>Open</button></td>
                  </tr>
                ))}
              </Table>
            )}
        </>
      )}
    </Page>
  )
}

/**
 * The exam room.
 *
 * Every answer is written to the server as it is chosen, so a dropped
 * connection in a school computer lab costs nothing: signing back in resumes
 * from the last saved answer, and the clock is the server's, not the browser's.
 */
function ExamRoom() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/student/exams/${param}`), [param])
  const [answers, setAnswers] = useState<Record<string, { choice?: number; text?: string }>>({})
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [offline, setOffline] = useState(false)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  // Restore whatever was already saved on the server. This is what makes a
  // dropped connection a non-event: the answers come back from the database,
  // not from this browser.
  const loaded = q.data as any
  useEffect(() => {
    if (!loaded?.answers?.length) return
    const seed: Record<string, { choice?: number; text?: string }> = {}
    for (const a of loaded.answers) {
      seed[a.exam_question_id] = { choice: a.choice_index ?? undefined, text: a.text_answer ?? '' }
    }
    setAnswers(seed)
  }, [loaded?.attempt?.id])

  return (
    <Page q={q}>
      {(d: any) => {

        if (d.state === 'locked') {
          return (
            <>
              <Head title={d.exam.title} sub={`${d.exam.questionCount} questions · ${d.exam.duration_minutes} minutes`} />
              <div className="lockbox">
                <Pill tone="wait">Opens {fmtDateTime(d.opensAt)}</Pill>
                <div className="big">Locked</div>
                <p className="muted small" style={{ maxWidth: '46ch', margin: '0 auto 18px' }}>
                  The paper unlocks by itself at the start time. You cannot open it early, and the questions are
                  not in this page until then.
                </p>
                <button className="btn ghost" onClick={() => go('exams')}>Back to exams</button>
              </div>
              <Note>
                <strong>If your internet drops mid-exam</strong>, sign in again and carry on from your last
                answer. Answers save on the server, not on this computer.
              </Note>
            </>
          )
        }

        if (d.state === 'submitted') {
          return (
            <>
              <Head title={d.exam.title} sub="Paper submitted" />
              <div className="lockbox">
                <Pill tone="ok">Submitted {fmtDateTime(d.attempt.submitted_at)}</Pill>
                <div className="big" style={{ fontSize: 30 }}>Done</div>
                <p className="muted small" style={{ maxWidth: '46ch', margin: '0 auto 18px' }}>
                  Your objective answers are marked already. Your teacher marks the written ones. You will never
                  see half a result.
                </p>
                <button className="btn ghost" onClick={() => go('results')}>See my results</button>
              </div>
            </>
          )
        }

        if (d.state === 'released') {
          return <ReleasedPaper d={d} />
        }

        if (d.state === 'closed') {
          return (
            <>
              <Head title={d.exam.title} />
              <div className="lockbox">
                <Pill tone="bad">Closed</Pill>
                <div className="big" style={{ fontSize: 30 }}>You did not sit this paper</div>
                <p className="muted small" style={{ maxWidth: '44ch', margin: '0 auto 18px' }}>
                  Speak to your teacher. Fixed-time exams make absence visible straight away, which is the point.
                </p>
                <button className="btn ghost" onClick={() => go('exams')}>Back to exams</button>
              </div>
            </>
          )
        }

        if (d.state === 'ready') {
          return (
            <>
              <Head title={d.exam.title} sub={`${d.exam.duration_minutes} minutes · the clock starts when you begin`} />
              <div className="lockbox">
                <Pill tone="bad">Open now</Pill>
                <div className="big" style={{ fontSize: 30 }}>Ready when you are</div>
                <p className="muted small" style={{ maxWidth: '46ch', margin: '0 auto 18px' }}>
                  Once you start, the clock runs on the server. If your connection drops, sign back in and carry
                  on — nothing you have answered is lost.
                </p>
                <Action label="Start the exam" onClick={async () => {
                  await client.post(`/student/exams/${param}/start`); q.reload()
                }} />
              </div>
            </>
          )
        }

        // in progress
        const closes = new Date(d.closesAt).getTime()
        const left = Math.max(0, Math.round((closes - now) / 1000))
        const answered = Object.values(answers).filter(a => a.choice != null || (a.text ?? '').trim()).length

        if (left === 0) {
          return (
            <div className="lockbox">
              <Pill tone="bad">Time is up</Pill>
              <div className="big" style={{ fontSize: 30 }}>The paper submitted itself</div>
              <Action label="Finish" onClick={async () => {
                await client.post(`/student/exams/${param}/submit`); q.reload()
              }} />
            </div>
          )
        }

        const save = async (questionId: string, payload: { choiceIndex?: number; text?: string }) => {
          try {
            const r = await client.post(`/student/exams/${param}/answer`, { questionId, ...payload })
            setSavedAt(r.savedAt); setOffline(false)
          } catch { setOffline(true) }
        }

        return (
          <>
            <div className="row" style={{ alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2>{d.exam.title}</h2>
                <div className="tiny muted">
                  {answered} of {d.questions.length} answered ·{' '}
                  {offline ? <span style={{ color: 'var(--rose)' }}>offline — retrying</span>
                    : savedAt ? `saved ${new Date(savedAt).toLocaleTimeString('en-GB')}` : 'answers save as you go'}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <span className={'timer' + (left > 300 ? ' calm' : '')}>{mmss(left)} left</span>
            </div>

            {d.questions.map((qq: any) => (
              <div className="qcard" key={qq.id}>
                <div className="qn">Question {qq.position} · {qq.marks} mark{qq.marks === 1 ? '' : 's'}</div>
                <div className="qt">{qq.text}</div>
                {qq.kind === 'objective'
                  ? (qq.options ?? []).map((o: string, oi: number) => (
                      <button key={oi} className={'opt' + (answers[qq.id]?.choice === oi ? ' sel' : '')}
                        onClick={() => {
                          setAnswers(a => ({ ...a, [qq.id]: { ...a[qq.id], choice: oi } }))
                          save(qq.id, { choiceIndex: oi })
                        }}>
                        <span className="l">{'ABCD'[oi]}</span><span>{o}</span>
                      </button>
                    ))
                  : (
                    <div className="field" style={{ marginBottom: 0 }}>
                      <textarea value={answers[qq.id]?.text ?? ''} style={{ minHeight: 110 }}
                        placeholder="Write your answer here…"
                        onChange={e => setAnswers(a => ({ ...a, [qq.id]: { ...a[qq.id], text: e.target.value } }))}
                        onBlur={e => save(qq.id, { text: e.target.value })} />
                    </div>
                  )}
              </div>
            ))}

            <div className="row" style={{ marginTop: 14 }}>
              <div style={{ flex: 1 }} />
              <Action label="Submit paper" onClick={async () => {
                await client.post(`/student/exams/${param}/submit`)
                toast('Paper submitted'); q.reload()
              }} />
            </div>
          </>
        )
      }}
    </Page>
  )
}

function ReleasedPaper({ d }: { d: any }) {
  const { go } = useSession()
  return (
    <>
      <Head title={d.exam.title} sub="Results released" />
      <div className="grid g4">
        <Stat small k="Your score" v={`${d.attempt.total_score} / ${d.attempt.max_score}`} />
        <Stat small k="Objective" v={d.attempt.objective_score ?? '—'} d="Marked automatically" />
        <Stat small k="Written" v={d.attempt.written_score ?? '—'} d="Marked by your teacher" />
        <Stat small k="Percentage"
          v={`${Math.round((d.attempt.total_score / (d.attempt.max_score || 1)) * 100)}%`} />
      </div>

      <Head title="Your paper" sub="Every question, with the right answer" />
      {d.answers.map((a: any) => (
        <div className="qcard" key={a.position}>
          <div className="qn">
            Question {a.position} · {a.marks_awarded ?? 0} of {a.marks}
          </div>
          <div className="qt">{a.text}</div>
          {a.kind === 'objective'
            ? (a.options ?? []).map((o: string, oi: number) => (
                <div key={oi} className={'opt' + (oi === a.answer_index ? ' right' : oi === a.choice_index ? ' wrong' : '')}>
                  <span className="l">{'ABCD'[oi]}</span><span>{o}</span>
                  {oi === a.answer_index ? <span className="tiny muted" style={{ marginLeft: 'auto' }}>correct</span> : null}
                </div>
              ))
            : (
              <div className="doc" style={{ boxShadow: 'none', padding: 14, maxWidth: 'none' }}>
                <p>{a.text_answer || <span className="muted">You did not answer this one.</span>}</p>
              </div>
            )}
        </div>
      ))}
      <button className="btn ghost" onClick={() => go('results')}>Back to results</button>
    </>
  )
}

// ---------------------------------------------------------------------------

function Results() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/student/results'))
  return (
    <Page q={q}>
      {(d: any) => {
        const strong = d.topics.filter((t: any) => t.pct >= 70)
        const weak = d.topics.filter((t: any) => t.pct < 70)
        return (
          <>
            <Head title="My results" sub="Every exam you have sat" />
            {d.results.length === 0
              ? <Empty title="No results yet" detail="Once you sit an exam and your teacher releases the marks, they appear here." />
              : (
                <Table head={['Exam', 'Date', 'Score', 'Class average', '']}>
                  {d.results.map((r: any) => (
                    <tr key={r.id}>
                      <td><strong>{r.title}</strong></td>
                      <td className="small">{fmtDate(r.starts_at)}</td>
                      <td>{r.status === 'released'
                        ? <span className="mono"><strong>{Math.round(r.score / (r.max_score || 1) * 100)}%</strong> <span className="muted">({r.score}/{r.max_score})</span></span>
                        : <Pill tone="wait">Being marked</Pill>}</td>
                      <td className="mono muted">{r.class_avg != null ? r.class_avg + '%' : '—'}</td>
                      <td>{r.status === 'released'
                        ? <button className="btn ghost sm" onClick={() => go('exam', r.id)}>See paper</button> : null}</td>
                    </tr>
                  ))}
                </Table>
              )}

            {d.topics.length ? (
              <>
                <Head title="Where you are strong, where you are not" sub="From the questions you have actually answered" />
                <div className="grid g2">
                  <div className="card">
                    <h3>Going well</h3>
                    {strong.length ? strong.map((t: any) => (
                      <div key={t.topic} style={{ marginTop: 10 }}>
                        <div className="small">{t.topic}</div><Bar v={t.pct} />
                      </div>
                    )) : <p className="muted small" style={{ marginTop: 8 }}>Nothing above 70% yet — keep going.</p>}
                  </div>
                  <div className="card">
                    <h3>Needs work</h3>
                    {weak.length ? weak.map((t: any) => (
                      <div key={t.topic} style={{ marginTop: 10 }}>
                        <div className="small">{t.topic}</div><Bar v={t.pct} />
                      </div>
                    )) : <p className="muted small" style={{ marginTop: 8 }}>Nothing below 70%. Well done.</p>}
                  </div>
                </div>
              </>
            ) : null}

            <Note>
              <strong>“Being marked” means your teacher has not finished the written answers yet.</strong> You
              will never see half a score.
            </Note>
          </>
        )
      }}
    </Page>
  )
}

function PracticalFile() {
  const { go, toast } = useSession()
  const q = useLoad(() => client.get('/student/practical-file'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="My practical file" sub={`${d.total} programs are needed for the Class 9 practical exam`} />
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {d.programs.map((p: any) => (
                <span key={p.program_no}
                  className={'pill ' + (p.status === 'graded' ? 'ok' : p.status === 'submitted' ? 'wait' : 'mute')}
                  style={{ minWidth: 38, textAlign: 'center' }}>
                  {p.program_no}
                </span>
              ))}
            </div>
            <div className="tiny muted" style={{ marginTop: 12 }}>
              {d.approved} approved · {d.programs.filter((p: any) => p.status === 'submitted').length} waiting for the teacher ·{' '}
              {d.programs.filter((p: any) => !p.status).length} not started
            </div>
          </div>

          <Table head={['#', 'Program', 'Where', 'Status', '']}>
            {d.programs.map((p: any) => (
              <tr key={p.program_no}>
                <td className="mono">{p.program_no}</td>
                <td>{p.title}</td>
                <td><Pill>{p.submitted_mode === 'uploaded' ? 'Computer lab' : p.submitted_mode === 'in_app' ? 'In the app' : '—'}</Pill></td>
                <td>
                  {p.status === 'graded' ? <Pill tone="ok">{p.score} / {p.max_score}</Pill>
                    : p.status === 'submitted' ? <Pill tone="wait">Waiting</Pill>
                    : p.status === 'revision' ? <Pill tone="wait">Fix and resubmit</Pill>
                    : <Pill tone="mute">Not started</Pill>}
                </td>
                <td>{p.status !== 'graded' ? <button className="btn ghost sm" onClick={() => go('labs')}>Open</button> : null}</td>
              </tr>
            ))}
          </Table>

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn gold" disabled={!d.canDownload}
              onClick={() => toast('Your practical file is ready to print')}>
              Download practical file as PDF
            </button>
          </div>
          <Note>
            <strong>The download unlocks when all {d.total} are approved.</strong> It prints as a proper practical
            file — index, aim, code and output for each program — ready for the board practical.
          </Note>
        </>
      )}
    </Page>
  )
}

function Profile() {
  const { me, toast, reload } = useSession()
  const q = useLoad(() => client.get('/student/profile'))
  const [guardian, setGuardian] = useState<any>(null)

  const BADGES = [
    ['first_program', 'First program'], ['ten_programs', '10 programs'],
    ['six_day_streak', '6-day streak'], ['all_programs', 'All 15 programs'], ['exam_90', '90% in an exam'],
  ]

  return (
    <Page q={q}>
      {(d: any) => {
        const g = guardian ?? { guardianName: d.profile.guardian_name, guardianPhone: d.profile.guardian_phone }
        const earned = new Set(d.badges.map((b: any) => b.badge_key))
        return (
          <>
            <Head title="My profile" sub={me.user.fullName} />
            <div className="grid g2">
              <div className="card">
                <h3>About me</h3>
                <div className="sub" style={{ marginBottom: 12 }}>Your school sets most of this</div>
                <Field label="Name"><input value={d.profile.full_name} readOnly /></Field>
                <Field label="Roll number" help="Set by your school. This is your username.">
                  <input value={d.profile.roll_no ?? ''} readOnly />
                </Field>
                <Field label="Class"><input value={d.profile.class_name ?? ''} readOnly /></Field>
                <Field label="School"><input value={d.profile.school} readOnly /></Field>
              </div>
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>My parent</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>
                    Your parent uses this same login to see your work. Your school uses this number if they need to call home.
                  </div>
                  <Field label="Parent name">
                    <input value={g.guardianName ?? ''} onChange={e => setGuardian({ ...g, guardianName: e.target.value })} />
                  </Field>
                  <Field label="Parent mobile">
                    <input value={g.guardianPhone ?? ''} onChange={e => setGuardian({ ...g, guardianPhone: e.target.value })} />
                  </Field>
                  <Action label="Save" onClick={async () => {
                    await client.patch('/student/profile', g); toast('Saved'); q.reload()
                  }} />
                </div>
                <div className="card">
                  <h3>How I am doing</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>{me.tenant.name}</div>
                  {[['Things finished', d.stats.completed], ['Lab programs graded', d.stats.labs],
                    ['Average in exams', d.stats.avg_exam ? d.stats.avg_exam + '%' : '—'],
                    ['Time in the app', `${d.stats.minutes} minutes`]].map(([k, v]: any) => (
                    <div key={k} style={{ display: 'flex', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                      <div className="small muted" style={{ flex: 1 }}>{k}</div>
                      <div className="small" style={{ fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Head title="Badges" sub="Small wins" />
            <div className="row">
              {BADGES.map(([key, label]) => (
                <div className="card" key={key}
                  style={{ flex: 1, minWidth: 130, textAlign: 'center', opacity: earned.has(key) ? 1 : 0.45 }}>
                  <div style={{ fontSize: 26 }}>{earned.has(key) ? '★' : '☆'}</div>
                  <div className="small" style={{ fontWeight: 600, marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>
          </>
        )
      }}
    </Page>
  )
}
