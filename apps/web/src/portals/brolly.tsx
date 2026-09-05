import React, { useState } from 'react'
import * as client from '../api.ts'
import {
  Action, Bar, Crumb, Empty, Field, Head, Loading, Modal, Note, Page, Pill, Stat, Table,
  fmtDate, fmtAgo, fmtDateTime, useLoad, useSession,
} from '../ui.tsx'
import { Blocks } from '../blocks.tsx'

export default function BrollyPortal() {
  const { screen } = useSession()
  switch (screen) {
    case 'schools': return <Schools />
    case 'school': return <SchoolDetail />
    case 'addschool': return <AddSchool />
    case 'content': return <Content />
    case 'material': return <MaterialEditor />
    case 'licences': return <Licences />
    case 'reports': return <Reports />
    case 'audit': return <Audit />
    case 'profile': return <Profile />
    default: return <Overview />
  }
}

const health = (s: any) =>
  s.status === 'provisioning' ? <Pill tone="wait">Onboarding</Pill>
  : s.usage_pct < 50 ? <Pill tone="bad">Needs a call</Pill>
  : <Pill tone="ok">Healthy</Pill>

// ---------------------------------------------------------------------------

function Overview() {
  const { go, toast } = useSession()
  const q = useLoad(() => client.get('/platform/overview'))
  return (
    <Page q={q} what="Loading every school">
      {(d: any) => (
        <>
          <Head title="Across all schools" sub={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
          <div className="grid g4">
            <Stat k="Schools" v={d.totals.schools} d="Licences current" />
            <Stat k="School admins" v={d.totals.admins} d="One per school" />
            <Stat k="Teachers" v={d.totals.teachers} d="Python & AI trainers" />
            <Stat k="Students" v={d.totals.students} d={`of ${d.totals.seats} seats licensed`} />
          </div>

          <Head title="Content sync" sub="This app reads from the Content Hub. Nothing here was uploaded into it." />
          <div className="grid g4">
            <Stat small k="Last pull" v={fmtAgo(d.sync.lastRunAt)} d="Runs every 5 minutes" />
            <Stat small k="Cursor" v={d.sync.cursor} d="The last change it processed" />
            <Stat small k="Items held" v={d.sync.itemsHeld} d="Videos, materials, labs, questions" />
            <Stat small k="Failed pulls" v={d.sync.failedRuns} d="Last 7 days" />
          </div>
          {d.sync.pending > 0 ? (
            <Note>
              <strong>{d.sync.pending} change{d.sync.pending === 1 ? '' : 's'} waiting.</strong>{' '}
              <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={async () => {
                const r = await client.post('/platform/sync/run')
                toast(`Pulled ${r.pulled} change${r.pulled === 1 ? '' : 's'}`)
                q.reload()
              }}>Pull now</button>
            </Note>
          ) : null}

          <Head title="School health" sub="Sorted so the school you should call first is at the top." />
          <Table head={['School', 'Students', 'App usage', 'Completion', 'Avg exam', '']}>
            {d.schools.map((s: any) => (
              <tr key={s.id} className="clickable" onClick={() => go('school', s.id)}>
                <td><strong>{s.name}</strong><div className="tiny muted">{s.area}</div></td>
                <td className="mono">{s.students} / {s.seats ?? '—'}</td>
                <td><Bar v={s.usage_pct} /></td>
                <td><Bar v={s.completion} /></td>
                <td className="mono">{s.avg_exam ? s.avg_exam + '%' : '—'}</td>
                <td>{health(s)}</td>
              </tr>
            ))}
          </Table>

          {(() => {
            const worry = d.schools.find((s: any) => s.status !== 'provisioning' && s.usage_pct < 50)
            return worry ? (
              <Note>
                <strong>This is the renewal signal.</strong> {worry.name} is at {worry.usage_pct}% usage with{' '}
                {worry.students} of {worry.seats} seats filled. Months before the boards, that is a conversation,
                not a report.
              </Note>
            ) : null
          })()}
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Schools() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/platform/schools'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Schools" sub="Every school on the platform"
            right={<button className="btn gold" onClick={() => go('addschool')}>Add a school</button>} />
          <Table head={['School', 'Levels', 'Seats used', 'Teachers', 'Classes', 'Licence ends', '']}>
            {d.schools.map((s: any) => (
              <tr key={s.id} className="clickable" onClick={() => go('school', s.id)}>
                <td><strong>{s.name}</strong><div className="tiny muted">{s.school_code} · {s.area}</div></td>
                <td className="small">{s.levels || '—'}</td>
                <td>
                  <Bar v={s.seats ? Math.round(s.students / s.seats * 100) : 0} />
                  <div className="tiny muted mono">{s.students} of {s.seats ?? '—'}</div>
                </td>
                <td className="mono">{s.teachers}</td>
                <td className="mono">{s.classes}</td>
                <td className="small">{fmtDate(s.valid_until)}</td>
                <td>{health(s)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Page>
  )
}

function SchoolDetail() {
  const { param, go } = useSession()
  const q = useLoad(() => client.get(`/platform/schools/${param}`), [param])
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Crumb to="schools" label="Schools" here={d.school.name.toUpperCase()} />
          <Head title={d.school.name} sub={`${d.school.school_code} · ${d.school.area}`}
            right={<button className="btn ghost" onClick={() => go('licences')}>Edit licence</button>} />
          <div className="grid g4">
            <Stat small k="Seats used" v={`${d.school.students}/${d.school.seats ?? '—'}`} d="Blocked at the cap" />
            <Stat small k="Teachers" v={d.school.teachers} />
            <Stat small k="Classes" v={d.school.classes} />
            <Stat small k="Licence ends" v={fmtDate(d.school.valid_until)} />
          </div>

          <Head title="Usage detail" />
          <div className="grid g2">
            <div className="card">
              <h3>Course completion</h3>
              <div className="sub" style={{ marginBottom: 10 }}>All classes</div>
              <Bar v={d.school.completion} />
            </div>
            <div className="card">
              <h3>App usage</h3>
              <div className="sub" style={{ marginBottom: 10 }}>Active in the last 7 days</div>
              <Bar v={d.school.usage_pct} />
            </div>
          </div>

          <Head title="Classes" />
          <Table head={['Class', 'Grade', 'Students']}>
            {d.classes.map((c: any) => (
              <tr key={c.id}><td><strong>{c.name}</strong></td><td className="small">{c.grade_level}</td><td className="mono">{c.students}</td></tr>
            ))}
          </Table>

          <Note>
            <strong>What you cannot open here.</strong> A student’s answer sheet, their code, or their personal
            record. You see counts and rates. The database has no policy granting this login access to those
            tables at all — the same rule that stops School A reading School B applies to you, because it is
            what you sell.
          </Note>
        </>
      )}
    </Page>
  )
}

function AddSchool() {
  const { go, toast } = useSession()
  const [f, setF] = useState({
    name: '', schoolCode: '', area: '', board: 'CBSE',
    adminName: '', adminEmail: '', adminPhone: '', seats: '150', levels: 'Class 9', validUntil: '2027-03-31',
  })
  const [err, setErr] = useState('')
  const [created, setCreated] = useState<any>(null)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })

  if (created) {
    return (
      <>
        <Crumb to="schools" label="Schools" here="CREATED" />
        <Head title={`${f.name} is set up`} sub="Hand these details to the school. They take it from here." />
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="slip">
            <div className="nm">{f.adminName} — school admin</div>
            <div className="kv">School code <b>{created.schoolCode}</b></div>
            <div className="kv">Email <b>{created.adminEmail}</b></div>
            <div className="kv">Temporary password <b>{created.temporaryPassword}</b></div>
            <div className="tiny muted" style={{ marginTop: 6 }}>They must change it at first sign-in.</div>
          </div>
        </div>
        <Note tone="teal">
          <strong>You never create teachers or students.</strong> That is the school admin’s job, and it is what
          keeps Brolly out of daily account work as more schools are added.
        </Note>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn gold" onClick={() => go('licences')}>Set the licence</button>
          <button className="btn ghost" onClick={() => go('schools')}>Back to schools</button>
        </div>
      </>
    )
  }

  return (
    <>
      <Crumb to="schools" label="Schools" here="ADD A SCHOOL" />
      <Head title="Add a school" sub="Step one of the whole chain. Everything else hangs off this record." />
      <div className="steps"><div className="on">1 · School details</div><div>2 · First admin login</div><div>3 · Licence</div></div>
      <div className="grid g2">
        <div className="card">
          <Field label="School name"><input value={f.name} onChange={set('name')} placeholder="Crescent Heights School" /></Field>
          <Field label="Area"><input value={f.area} onChange={set('area')} placeholder="Nizampet, Hyderabad" /></Field>
          <Field label="Board">
            <select value={f.board} onChange={set('board')}><option>CBSE</option><option>State board</option><option>ICSE</option></select>
          </Field>
          <Field label="School code" help="Students type this at sign-in, so keep it short and memorable.">
            <input value={f.schoolCode} onChange={e => setF({ ...f, schoolCode: e.target.value.toUpperCase() })} placeholder="CHS-NZM" />
          </Field>
          <div className="grid g3" style={{ gap: 10 }}>
            <Field label="Seats"><input value={f.seats} onChange={set('seats')} /></Field>
            <Field label="Levels">
              <select value={f.levels} onChange={set('levels')}>
                <option>Class 9</option><option>Class 8, 9</option><option>Class 5 to 9</option>
              </select>
            </Field>
            <Field label="Valid until"><input type="date" value={f.validUntil} onChange={set('validUntil')} /></Field>
          </div>
        </div>
        <div className="card">
          <h3>First school admin</h3>
          <div className="sub" style={{ marginBottom: 14 }}>You create this one login. After that the school runs itself.</div>
          <Field label="Admin name"><input value={f.adminName} onChange={set('adminName')} placeholder="Lakshmi Prasad" /></Field>
          <Field label="Email"><input value={f.adminEmail} onChange={set('adminEmail')} placeholder="principal@crescentheights.edu.in" /></Field>
          <Field label="Mobile" error={err}><input value={f.adminPhone} onChange={set('adminPhone')} placeholder="+91 98••• •••••" /></Field>
          <Note tone="teal">
            <strong>Adding a school is a data operation.</strong> No deploy, no configuration file, no code
            change — a row, a licence and one login.
          </Note>
        </div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <Action label="Create school and admin login" onClick={async () => {
          setErr('')
          try {
            const r = await client.post('/platform/schools', { ...f, seats: Number(f.seats) })
            setCreated(r); toast('School created')
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost" onClick={() => go('schools')}>Cancel</button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

function Content() {
  const { go, toast } = useSession()
  const [tab, setTab] = useState<'units' | 'videos' | 'materials' | 'practice' | 'labs'>('units')
  const q = useLoad(() => client.get('/platform/content'))

  return (
    <Page q={q} what="Loading the library">
      {(d: any) => (
        <>
          <Head title="Content" sub="Owned by the Content Hub. One copy, read by every school."
            right={
              <Action kind="ghost" label="Pull from the Hub" onClick={async () => {
                const r = await client.post('/platform/sync/run')
                toast(`Pulled ${r.pulled} change${r.pulled === 1 ? '' : 's'}`); q.reload()
              }} />
            } />
          <Note tone="teal">
            <strong>Nothing was uploaded into this app.</strong> The sync client is at cursor{' '}
            <span className="mono">{d.sync.cursor}</span>, holding {d.sync.itemsHeld} items, currently serving{' '}
            <span className="mono">release {d.sync.releaseNo}</span>. Publish in the Hub and it appears here
            without anyone touching this application.
          </Note>

          <div className="grid g4" style={{ marginTop: 18 }}>
            <Stat small k="Videos" v={d.videos.length} d="Across all units" />
            <Stat small k="Materials" v={d.materials.length} d="Notes, worksheets, PDFs" />
            <Stat small k="Practice labs" v={d.practice.length} d="Unlimited attempts" />
            <Stat small k="Graded labs" v={d.gradedLabs.length} d="The practical file" />
          </div>

          <div className="row tight" style={{ margin: '18px 0 14px' }}>
            {d.courses.map((c: any) => (
              <span key={c.id} className={'chip' + (c.status !== 'published' ? ' warn' : '')}>
                {c.level_label} — {c.title}{c.code ? ` (${c.code})` : ''} · {c.schools} school{c.schools === 1 ? '' : 's'}
              </span>
            ))}
          </div>

          <div className="filters">
            {([['units', 'Units', d.units.length], ['videos', 'Videos', d.videos.length],
               ['materials', 'Materials', d.materials.length], ['practice', 'Practice labs', d.practice.length],
               ['labs', 'Graded labs', d.gradedLabs.length]] as const).map(([k, label, n]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>
                {label} <span className="mono">{n}</span>
              </button>
            ))}
          </div>

          {tab === 'units' && (
            <Table head={['Unit', 'Videos', 'Materials', 'Practice', 'Objective Qs', 'Written Qs', 'Status']}>
              {d.units.map((u: any) => (
                <tr key={u.id}>
                  <td><strong>{u.code} — {u.title}</strong><div className="tiny muted">{u.hours_label}</div></td>
                  <td className="mono">{u.videos}</td><td className="mono">{u.materials}</td>
                  <td className="mono">{u.practice}</td><td className="mono">{u.objective}</td><td className="mono">{u.written}</td>
                  <td>{u.status === 'published' ? <Pill tone="ok">Published</Pill> : <Pill tone="wait">Drafting</Pill>}</td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'videos' && (
            <div className="lib">
              {d.videos.map((v: any) => (
                <div className="libcard" key={v.id}>
                  <div className="thumb"><div className="play">▶</div>
                    <span className="dur">{Math.floor(v.duration_seconds / 60)}:{String(v.duration_seconds % 60).padStart(2, '0')}</span>
                  </div>
                  <div className="pad">
                    <span className="tchip vid">Video</span><h4>{v.title}</h4>
                    <div className="meta">{v.unit}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'materials' && (
            <Table head={['Material', 'Unit', 'Kind', 'Pages', 'Version', 'Published', '']}>
              {d.materials.map((m: any) => (
                <tr key={m.id}>
                  <td><strong>{m.title}</strong></td>
                  <td className="mono small">{m.unit}</td>
                  <td><Pill>{m.kind}</Pill></td>
                  <td className="mono">{m.pages}</td>
                  <td className="mono">v{m.version_no ?? 1}</td>
                  <td className="small muted">{fmtAgo(m.published_at)}</td>
                  <td><button className="btn ghost sm" onClick={() => go('material', m.id)}>Open & publish</button></td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'practice' && (
            <Table head={['Practice lab', 'Unit', 'Level']}>
              {d.practice.map((p: any) => (
                <tr key={p.id}><td><strong>{p.title}</strong></td><td className="mono small">{p.unit}</td><td><Pill>{p.level}</Pill></td></tr>
              ))}
            </Table>
          )}

          {tab === 'labs' && (
            <Table head={['#', 'Program', 'Where', 'Marks']}>
              {d.gradedLabs.map((g: any) => (
                <tr key={g.id}>
                  <td className="mono">{g.program_no}</td><td><strong>{g.title}</strong></td>
                  <td><Pill>{g.mode === 'in_app' ? 'In the app' : g.mode === 'uploaded' ? 'Computer lab' : 'Either'}</Pill></td>
                  <td className="mono">{g.max_score}</td>
                </tr>
              ))}
            </Table>
          )}

          <Note>
            <strong>Four kinds of content, one library.</strong> A video teaches it, a material lets them read it
            again, a practice lab lets them try it as often as they like, and an exam measures it. Every item
            belongs to a unit, so a teacher assigns by unit and nothing gets missed.
          </Note>
        </>
      )}
    </Page>
  )
}

/**
 * The publishing screen. Editing creates a new immutable version and moves one
 * pointer — which is why students see the change in seconds and rolling back is
 * a database write rather than a redeploy.
 */
function MaterialEditor() {
  const { param, go, toast } = useSession()
  const q = useLoad(() => client.get(`/platform/materials/${param}`), [param])
  const [draft, setDraft] = useState<string>('')
  const [changelog, setChangelog] = useState('')
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const body = draft || JSON.stringify(d.material.body ?? [], null, 2)
        return (
          <>
            <Crumb to="content" label="Content" here={d.material.title.toUpperCase()} />
            <Head title={d.material.title}
              sub={`${d.material.unit} · ${d.material.kind} · currently published as version ${d.material.version_no ?? 1}`} />
            <div className="grid g2">
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>Blocks</h3>
                  <div className="sub" style={{ marginBottom: 10 }}>
                    Structured blocks, not HTML — there is nowhere for a script to live, so content rendered to
                    children is safe by construction rather than by filtering.
                  </div>
                  <div className="editor">
                    <div className="bar2"><span className="fn">content.json</span></div>
                    <textarea value={body} onChange={e => setDraft(e.target.value)} style={{ minHeight: 320 }} />
                  </div>
                </div>
                <Field label="What changed" error={err}>
                  <input value={changelog} onChange={e => setChangelog(e.target.value)}
                    placeholder="Added a fourth common mistake" />
                </Field>
                <Action label="Publish a new version" onClick={async () => {
                  setErr('')
                  try {
                    const parsed = JSON.parse(body)
                    const r = await client.post(`/platform/materials/${param}/publish`, { body: parsed, changelog })
                    toast(`Published version ${r.versionNo} as release ${r.releaseNo}`)
                    setDraft(''); q.reload()
                  } catch (e: any) {
                    setErr(e instanceof SyntaxError ? 'That is not valid JSON yet.' : e.message)
                  }
                }} />
              </div>

              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>What a student sees</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>Rendered through the same block registry as the reader</div>
                  <div className="doc" style={{ boxShadow: 'none', padding: 18 }}>
                    <SafePreview json={body} />
                  </div>
                </div>
                <div className="card">
                  <h3>Version history</h3>
                  <div className="sub" style={{ marginBottom: 10 }}>Every published edit, kept</div>
                  {d.history.map((h: any) => (
                    <div className="unit" key={h.version_no} style={{ marginBottom: 7 }}>
                      <div className="num">v{h.version_no}</div>
                      <div className="body">
                        <div className="t" style={{ fontSize: 14 }}>{h.changelog || 'No note'}</div>
                        <div className="m">{fmtDateTime(h.published_at)}</div>
                      </div>
                      {h.status === 'published' ? <Pill tone="ok">Live</Pill> : <Pill>{h.status}</Pill>}
                    </div>
                  ))}
                  <Note tone="teal">
                    <strong>No deploy is involved.</strong> Publishing writes a new version and moves one pointer.
                    Every entitled school reads the new text on their next request.
                  </Note>
                </div>
              </div>
            </div>
          </>
        )
      }}
    </Page>
  )
}

function SafePreview({ json }: { json: string }) {
  try { return <Blocks blocks={JSON.parse(json)} /> }
  catch { return <p className="muted">Preview appears once the JSON is valid.</p> }
}

// ---------------------------------------------------------------------------

function Licences() {
  const { toast } = useSession()
  const q = useLoad(() => client.get('/platform/licences'))
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState({ seats: '', levels: '', validUntil: '' })
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Licences and seats" sub="Seats are the revenue control. A school cannot add a student past its cap." />
          <Table head={['School', 'Levels', 'Seats', 'Used', 'Left', 'Ends', '']}>
            {d.schools.map((s: any) => {
              const left = (s.seats ?? 0) - s.students
              return (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong><div className="tiny muted">{s.school_code}</div></td>
                  <td className="small">{s.levels}</td>
                  <td className="mono">{s.seats}</td>
                  <td className="mono">{s.students}</td>
                  <td>{left < 10 ? <Pill tone="bad">{left} left</Pill> : <span className="mono">{left}</span>}</td>
                  <td className="small">{fmtDate(s.valid_until)}</td>
                  <td>
                    <button className="btn ghost sm" onClick={() => {
                      setEditing(s)
                      setForm({ seats: String(s.seats ?? ''), levels: s.levels ?? '', validUntil: (s.valid_until ?? '').slice(0, 10) })
                      setErr('')
                    }}>Edit</button>
                  </td>
                </tr>
              )
            })}
          </Table>

          {(() => {
            const tight = d.schools.filter((s: any) => (s.seats ?? 0) - s.students < 10)
            return tight.length ? (
              <Note>
                <strong>{tight[0].name} has {(tight[0].seats ?? 0) - tight[0].students} seats left.</strong>{' '}
                Their admin hits the block next time they import a class. Call before they discover it — that is
                how per-student pricing gets enforced without an argument.
              </Note>
            ) : null
          })()}

          {editing && (
            <Modal title={`Licence — ${editing.name}`} onClose={() => setEditing(null)}>
              <div className="grid g3">
                <Field label="Seats" error={err}><input value={form.seats} onChange={e => setForm({ ...form, seats: e.target.value })} /></Field>
                <Field label="Class levels">
                  <select value={form.levels} onChange={e => setForm({ ...form, levels: e.target.value })}>
                    <option>Class 9</option><option>Class 8, 9</option><option>Class 5 to 9</option>
                  </select>
                </Field>
                <Field label="Valid until"><input type="date" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} /></Field>
              </div>
              <div className="row">
                <Action label="Save licence" onClick={async () => {
                  setErr('')
                  try {
                    await client.put(`/platform/licences/${editing.id}`,
                      { seats: Number(form.seats), levels: form.levels, validUntil: form.validUntil })
                    toast('Licence saved'); setEditing(null); q.reload()
                  } catch (e: any) { setErr(e.message) }
                }} />
                <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </Modal>
          )}
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Reports() {
  const q = useLoad(() => client.get('/platform/reports'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Reports" sub="Everything, across every school" />
          <div className="grid g2">
            <div className="card">
              <h3>Completion by school</h3>
              <div className="sub" style={{ marginBottom: 12 }}>All licensed courses</div>
              {d.schools.map((s: any) => (
                <div key={s.id} style={{ marginBottom: 10 }}>
                  <div className="small">{s.name}</div><Bar v={s.completion} />
                </div>
              ))}
            </div>
            <div className="card">
              <h3>Where students stop</h3>
              <div className="sub" style={{ marginBottom: 12 }}>Completion by unit, all schools</div>
              {d.byUnit.map((u: any) => (
                <div key={u.code} style={{ marginBottom: 10 }}>
                  <div className="small">{u.code}</div><Bar v={u.completion} />
                </div>
              ))}
            </div>
          </div>

          {d.examAverages.length ? (
            <>
              <Head title="Exam averages" sub="Every released paper, every school" />
              <Table head={['Exam', 'Sat', 'Average']}>
                {d.examAverages.map((e: any) => (
                  <tr key={e.title}><td><strong>{e.title}</strong></td><td className="mono">{e.sat}</td>
                    <td style={{ width: 200 }}><Bar v={e.avg_pct} /></td></tr>
                ))}
              </Table>
            </>
          ) : null}

          {(() => {
            const worst = [...d.byUnit].sort((a: any, b: any) => a.completion - b.completion)[0]
            return worst ? (
              <Note>
                <strong>{worst.code} is where students stall</strong> across the platform, at {worst.completion}%.
                That is a content problem, not a school problem — and it is yours to fix.
              </Note>
            ) : null
          })()}
        </>
      )}
    </Page>
  )
}

function Audit() {
  const q = useLoad(() => client.get('/platform/audit'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Activity log" sub="Every administrative action, with who did it and when" />
          <Table head={['When', 'Who', 'School', 'Action', 'What']}>
            {d.entries.map((e: any) => (
              <tr key={e.id}>
                <td className="tiny mono muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.occurred_at)}</td>
                <td className="small">{e.actor ?? '—'}</td>
                <td className="small muted">{e.school ?? 'Platform'}</td>
                <td><span className="mono tiny">{e.action}</span></td>
                <td className="small">{e.summary}</td>
              </tr>
            ))}
          </Table>
          <Note>
            <strong>Redaction is a whitelist.</strong> Only fields explicitly marked auditable are ever written
            here, so a new column added tomorrow cannot start leaking into the log — which is exactly how
            blacklists fail.
          </Note>
        </>
      )}
    </Page>
  )
}

function Profile() {
  const { me, toast, reload } = useSession()
  const [fullName, setFullName] = useState(me.user.fullName)
  return (
    <>
      <Head title="My profile" sub={me.tenant.name} />
      <div className="grid g2">
        <div className="card">
          <h3>Your details</h3>
          <div className="sub" style={{ marginBottom: 12 }}>Shown on school letters and in the activity log</div>
          <Field label="Name"><input value={fullName} onChange={e => setFullName(e.target.value)} /></Field>
          <Field label="Email"><input value={me.user.email ?? ''} readOnly /></Field>
          <Action label="Save" onClick={async () => {
            await client.patch('/me', { fullName }); toast('Saved'); await reload()
          }} />
        </div>
        <div className="card">
          <h3>What this login can reach</h3>
          <div className="sub" style={{ marginBottom: 12 }}>Permissions granted by your role</div>
          <div className="row tight">
            {me.permissions.map(p => <span key={p} className="chip mono tiny">{p}</span>)}
          </div>
        </div>
      </div>
    </>
  )
}
