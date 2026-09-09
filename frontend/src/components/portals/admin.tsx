'use client'

import React, { useState } from 'react'
import * as client from '@/lib/api'
import {
  Action, Bar, Crumb, Field, Head, Modal, Note, Page, Pill, Stat, Table,
  fmtAgo, fmtDate, fmtDateTime, price, useLoad, useSession,
} from '@/components/ui'
import { Blocks } from '@/components/blocks'

export default function AdminPortal() {
  const { screen } = useSession()
  switch (screen) {
    case 'courses': return <Courses />
    case 'content': return <ContentHub />
    case 'contentItem': return <ContentEditor />
    case 'teachers': return <Teachers />
    case 'students': return <Students />
    case 'live': return <Live />
    case 'orders': return <Orders />
    case 'audit': return <Audit />
    case 'profile': return <Profile />
    default: return <Overview />
  }
}

// ---------------------------------------------------------------------------

function Overview() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/admin/overview'))
  return (
    <Page q={q} what="Loading the platform">
      {(d: any) => (
        <>
          <Head title="Brolly Juniors" sub={new Date().toLocaleDateString('en-GB',
            { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
          <div className="grid g4">
            <Stat k="Students" v={d.totals.students} d={`${d.totals.active_students} active this week`} />
            <Stat k="Teachers" v={d.totals.teachers} d="Brolly staff" />
            <Stat k="Enrolments" v={d.totals.enrolments} d={`${d.totals.completions} completed`} />
            <Stat k="Revenue" v={price(Number(d.totals.revenue_minor))} d={`${d.totals.paid_orders} paid orders`} />
          </div>
          <div className="grid g4" style={{ marginTop: 14 }}>
            <Stat small k="Published courses" v={d.totals.courses} />
            <Stat small k="Upcoming live classes" v={d.totals.upcoming_live} />
            <Stat small k="Certificates issued" v={d.totals.certificates} />
            <Stat small k="Completion rate"
              v={d.totals.enrolments ? `${Math.round(d.totals.completions / d.totals.enrolments * 100)}%` : '—'} />
          </div>

          <Head title="Courses" sub="Where the money and the learning actually is" />
          <Table head={['Course', 'Status', 'Price', 'Enrolments', 'Completed', 'Revenue', 'Content progress']}>
            {d.courses.map((c: any) => (
              <tr key={c.id} className="clickable" onClick={() => go('courses')}>
                <td><strong>{c.title}</strong><div className="tiny muted">{c.subject}</div></td>
                <td>{c.status === 'published' ? <Pill tone="ok">Published</Pill>
                  : c.status === 'draft' ? <Pill tone="wait">Draft</Pill> : <Pill tone="mute">Retired</Pill>}</td>
                <td className="mono">{price(c.price_minor)}</td>
                <td className="mono">{c.enrolments}</td>
                <td className="mono">{c.completed}</td>
                <td className="mono">{price(Number(c.revenue_minor))}</td>
                <td style={{ minWidth: 160 }}>
                  <Bar v={c.enrolments && c.nodes ? c.completed_nodes / (c.enrolments * c.nodes) * 100 : 0}
                    label={`Content completed across ${c.title}`} />
                </td>
              </tr>
            ))}
          </Table>

          <div className="grid g2" style={{ marginTop: 20 }}>
            <div className="card">
              <h3>Enrolments by week</h3>
              <div className="sub" style={{ marginBottom: 12 }}>Last twelve weeks</div>
              {d.signupsByWeek.length === 0
                ? <p className="small muted" style={{ margin: 0 }}>No enrolments in the last twelve weeks.</p>
                : d.signupsByWeek.map((w: any) => (
                  <div key={w.week} style={{ marginBottom: 8 }}>
                    <div className="small">{w.week} · {w.enrolments}</div>
                    <Bar v={Math.min(100, w.enrolments * 4)} label={`Enrolments in the week of ${w.week}`} />
                  </div>
                ))}
            </div>
            <div className="card">
              <h3>Recent orders</h3>
              <div className="sub" style={{ marginBottom: 12 }}>Newest first</div>
              {d.recentOrders.length === 0
                ? <p className="small muted" style={{ margin: 0 }}>Nothing has been bought yet.</p>
                : d.recentOrders.map((o: any) => (
                  <div key={o.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="small" style={{ flex: 1 }}>
                      {o.student}<div className="tiny muted">{o.course}</div>
                    </div>
                    <div className="small mono">{price(o.amount_minor)}</div>
                    <Pill tone={o.status === 'paid' ? 'ok' : o.status === 'failed' ? 'bad' : 'wait'}>{o.status}</Pill>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------

function Courses() {
  const { toast } = useSession()
  const q = useLoad(() => client.get('/admin/courses'))
  const [editing, setEditing] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [assigning, setAssigning] = useState<any>(null)

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Courses" sub="The catalogue students see"
            right={<button className="btn gold" onClick={() => setCreating(true)}>New course</button>} />
          <Table head={['Course', 'Subject', 'Status', 'Price', 'Structure', 'Enrolments', 'Teachers', '']}>
            {d.courses.map((c: any) => (
              <tr key={c.id}>
                <td><strong>{c.title}</strong><div className="tiny muted mono">/{c.slug}</div></td>
                <td className="small">{c.subject}</td>
                <td>{c.status === 'published' ? <Pill tone="ok">Published</Pill>
                  : c.status === 'draft' ? <Pill tone="wait">Draft</Pill> : <Pill tone="mute">Retired</Pill>}</td>
                <td className="mono">{price(c.price_minor)}</td>
                <td className="small">{c.modules} modules · {c.lessons} lessons</td>
                <td className="mono">{c.enrolments}</td>
                <td className="small">{(c.teachers ?? []).join(', ') || '—'}</td>
                <td className="row tight">
                  <button className="btn ghost sm" onClick={() => setEditing(c)}>Edit</button>
                  <button className="btn ghost sm" onClick={() => setAssigning(c)}>Teachers</button>
                  <Action small kind={c.status === 'published' ? 'ghost' : 'gold'}
                    label={c.status === 'published' ? 'Unpublish' : 'Publish'}
                    onClick={async () => {
                      await client.post(`/admin/courses/${c.id}/status`,
                        { status: c.status === 'published' ? 'draft' : 'published' })
                      toast(c.status === 'published' ? 'Taken off the catalogue' : 'Published to the catalogue')
                      q.reload()
                    }} />
                </td>
              </tr>
            ))}
          </Table>
          <Note>
            <strong>Unpublishing hides a course from the catalogue, not from the people who bought it.</strong>{' '}
            Their enrolment is what grants access, so nobody loses what they paid for.
          </Note>

          {creating && <CourseForm subjects={d.subjects} onClose={() => setCreating(false)}
            onDone={() => { setCreating(false); toast('Course created as a draft'); q.reload() }} />}
          {editing && <CourseForm course={editing} subjects={d.subjects} onClose={() => setEditing(null)}
            onDone={() => { setEditing(null); toast('Saved'); q.reload() }} />}
          {assigning && <TeacherAssign course={assigning} teachers={d.teachers}
            onClose={() => setAssigning(null)} onDone={() => { setAssigning(null); toast('Updated'); q.reload() }} />}
        </>
      )}
    </Page>
  )
}

function CourseForm({ course, subjects, onClose, onDone }: {
  course?: any; subjects: any[]; onClose: () => void; onDone: () => void
}) {
  const [f, setF] = useState({
    title: course?.title ?? '', slug: course?.slug ?? '', subtitle: course?.subtitle ?? '',
    description: course?.description ?? '', subjectId: subjects[0]?.id ?? '',
    level: course?.level ?? 'Beginner', durationHours: String(course?.duration_hours ?? 12),
    priceMinor: String(course?.price_minor ?? 499900),
  })
  const [err, setErr] = useState('')
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })

  return (
    <Modal title={course ? `Edit ${course.title}` : 'New course'} onClose={onClose}>
      <Field label="Title"><input value={f.title} onChange={set('title')} /></Field>
      {!course && (
        <Field label="URL slug" help="Lowercase letters, digits and hyphens. Students see this in the address bar.">
          <input value={f.slug} onChange={e => setF({ ...f, slug: e.target.value.toLowerCase() })}
            placeholder="machine-learning-basics" />
        </Field>
      )}
      <Field label="One-line summary"><input value={f.subtitle} onChange={set('subtitle')} /></Field>
      <Field label="Description"><textarea value={f.description} onChange={set('description')} /></Field>
      <div className="grid g3" style={{ gap: 10 }}>
        {!course && (
          <Field label="Subject">
            <select value={f.subjectId} onChange={set('subjectId')}>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Level">
          <select value={f.level} onChange={set('level')}>
            <option>Beginner</option><option>Intermediate</option><option>Advanced</option>
          </select>
        </Field>
        <Field label="Hours"><input value={f.durationHours} onChange={set('durationHours')} inputMode="numeric" /></Field>
        <Field label="Price in paise" help={`Shows as ${price(Number(f.priceMinor) || 0)}`} error={err}>
          <input value={f.priceMinor} onChange={set('priceMinor')} inputMode="numeric" />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <Action label={course ? 'Save changes' : 'Create as draft'} onClick={async () => {
          setErr('')
          try {
            if (course) {
              await client.patch(`/admin/courses/${course.id}`, {
                title: f.title, subtitle: f.subtitle, description: f.description, level: f.level,
                durationHours: Number(f.durationHours), priceMinor: Number(f.priceMinor),
              })
            } else {
              await client.post('/admin/courses', {
                ...f, durationHours: Number(f.durationHours), priceMinor: Number(f.priceMinor),
              })
            }
            onDone()
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost stack" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

function TeacherAssign({ course, teachers, onClose, onDone }: {
  course: any; teachers: any[]; onClose: () => void; onDone: () => void
}) {
  const assigned = new Set<string>((course.teachers ?? []).map((t: string) => t))
  return (
    <Modal title={`Teachers on ${course.title}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        A course can have several teachers, and a teacher several courses. This join is the whole of the
        student/teacher relationship — there is nothing else linking them.
      </p>
      {teachers.length === 0
        ? <p className="small muted">There are no teacher accounts yet. Add one under Teachers first.</p>
        : teachers.map(t => (
          <div className="unit" key={t.id}>
            <div className="num" aria-hidden="true">◈</div>
            <div className="body"><div className="t">{t.full_name}</div></div>
            {assigned.has(t.full_name)
              ? <Action small kind="ghost" label="Remove" onClick={async () => {
                await client.post(`/admin/courses/${course.id}/teachers`, { teacherId: t.id, remove: true })
                onDone()
              }} />
              : <Action small label="Assign" onClick={async () => {
                await client.post(`/admin/courses/${course.id}/teachers`, { teacherId: t.id, role: 'assistant' })
                onDone()
              }} />}
          </div>
        ))}
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function ContentHub() {
  const { go } = useSession()
  const q = useLoad(() => client.get('/admin/content'))
  const [filter, setFilter] = useState('')

  return (
    <Page q={q} what="Loading the Content Hub">
      {(d: any) => {
        const items = filter ? d.items.filter((i: any) => i.course_id === filter) : d.items
        return (
          <>
            <Head title="Content Hub" sub="The single source of truth for everything students read" />
            <Note tone="teal">
              <strong>Publishing here does not deploy anything.</strong> A new version is written, the pointer
              moves, and the next request from any enrolled student returns the new text. Rolling back is the
              same move with the numbers swapped.
            </Note>

            <div className="grid g4" style={{ marginTop: 18 }}>
              <Stat small k="Content items" v={d.items.length} d="Lessons and textbook sections" />
              <Stat small k="Awaiting review" v={d.pendingReview.length} d="Drafts not yet live" />
              <Stat small k="Courses" v={d.courses.length} />
              <Stat small k="Current release"
                v={d.courses[0]?.release_no ? `v${d.courses[0].release_no}` : '—'}
                d={d.courses[0]?.title} />
            </div>

            {d.pendingReview.length ? (
              <>
                <Head title="Drafts in progress" sub="Students still read the published version until you publish these" />
                <Table head={['Item', 'Type', 'Version', 'What changed', 'Saved']}>
                  {d.pendingReview.map((v: any) => (
                    <tr key={v.id}>
                      <td><strong>{v.title}</strong></td>
                      <td><Pill>{v.content_type}</Pill></td>
                      <td className="mono">v{v.version_no}</td>
                      <td className="small">{v.changelog || '—'}</td>
                      <td className="small muted">{fmtAgo(v.created_at)}</td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : null}

            <Head title="Everything" />
            <div className="filters">
              <button className={!filter ? 'on' : ''} onClick={() => setFilter('')}>All</button>
              {d.courses.map((c: any) => (
                <button key={c.id} className={filter === c.id ? 'on' : ''} onClick={() => setFilter(c.id)}>
                  {c.title} {c.release_no ? <span className="mono">v{c.release_no}</span> : null}
                </button>
              ))}
            </div>
            <Table head={['Item', 'Type', 'Course', 'Live version', 'Published', 'Drafts', '']}>
              {items.map((i: any) => (
                <tr key={i.id}>
                  <td><strong>{i.title}</strong></td>
                  <td><Pill>{i.content_type}</Pill></td>
                  <td className="small">{i.course ?? '—'}</td>
                  <td className="mono">v{i.version_no ?? '—'}</td>
                  <td className="small muted">{fmtAgo(i.published_at)}</td>
                  <td>{i.pending > 0 ? <Pill tone="wait">{i.pending}</Pill> : <Pill tone="mute">—</Pill>}</td>
                  <td><button className="btn ghost sm" onClick={() => go('contentItem', i.id)}>Open</button></td>
                </tr>
              ))}
            </Table>
          </>
        )
      }}
    </Page>
  )
}

/**
 * The editor. Content is a block document, never HTML — so there is nowhere for
 * a script to live in something rendered to a thirteen-year-old.
 */
function ContentEditor() {
  const { param, toast } = useSession()
  const q = useLoad(() => client.get(`/admin/content/${param}`), [param])
  const [draft, setDraft] = useState<string | null>(null)
  const [changelog, setChangelog] = useState('')
  const [err, setErr] = useState('')

  return (
    <Page q={q}>
      {(d: any) => {
        const live = d.versions.find((v: any) => v.status === 'published')
        const open = d.versions.find((v: any) => v.status === 'draft' || v.status === 'review')
        const source = draft ?? JSON.stringify((open ?? live)?.body ?? [], null, 2)

        return (
          <>
            <Crumb to="content" label="Content Hub" here={d.item.title.toUpperCase()} />
            <Head title={d.item.title}
              sub={`${d.item.content_type} · ${d.item.course ?? 'no course'} · live version ${live?.version_no ?? '—'}`} />

            <div className="grid g2">
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>Blocks</h3>
                  <div className="sub" style={{ marginBottom: 10 }}>
                    Structured blocks, not HTML. The renderer knows a fixed set of types, so unsafe content is
                    designed out rather than filtered out.
                  </div>
                  <div className="editor">
                    <div className="bar2"><span className="fn">content.json</span>
                      <span className="spacer" />
                      {open ? <span className="saved">draft v{open.version_no}</span> : null}</div>
                    <textarea value={source} onChange={e => setDraft(e.target.value)}
                      spellCheck={false} aria-label="Content blocks as JSON" style={{ minHeight: 340 }} />
                  </div>
                </div>
                <Field label="What changed" error={err}>
                  <input value={changelog} onChange={e => setChangelog(e.target.value)}
                    placeholder="Clarified the input() rule" />
                </Field>
                <div className="row">
                  <Action kind="ghost" label="Save draft" onClick={async () => {
                    setErr('')
                    try {
                      const body = JSON.parse(source)
                      const r = await client.post(`/admin/content/${param}/draft`, { body, changelog })
                      toast(`Draft saved as v${r.versionNo}`); setDraft(null); q.reload()
                    } catch (e: any) {
                      setErr(e instanceof SyntaxError ? 'That is not valid JSON yet.' : e.message)
                    }
                  }} />
                  {open ? (
                    <>
                      {open.status === 'draft' ? (
                        <Action kind="ghost" label="Send for review" onClick={async () => {
                          await client.post(`/admin/content/versions/${open.id}/review`)
                          toast('Moved to review'); q.reload()
                        }} />
                      ) : null}
                      <Action label={`Publish v${open.version_no}`} onClick={async () => {
                        setErr('')
                        try {
                          const r = await client.post(`/admin/content/versions/${open.id}/publish`)
                          toast(`Published v${r.versionNo}${r.releaseNo ? ` as release ${r.releaseNo}` : ''} — students see it now`)
                          setDraft(null); q.reload()
                        } catch (e: any) { setErr(e.message) }
                      }} />
                    </>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3>What a student sees</h3>
                  <div className="sub" style={{ marginBottom: 12 }}>Rendered through the same block registry</div>
                  <div className="doc" style={{ boxShadow: 'none', padding: 18 }}>
                    <SafePreview json={source} />
                  </div>
                </div>

                <div className="card">
                  <h3>Version history</h3>
                  <div className="sub" style={{ marginBottom: 10 }}>Published versions are immutable</div>
                  {d.versions.map((v: any) => (
                    <div className="unit" key={v.id} style={{ marginBottom: 7 }}>
                      <div className="num">v{v.version_no}</div>
                      <div className="body">
                        <div className="t" style={{ fontSize: 14 }}>{v.changelog || 'No note'}</div>
                        <div className="m">{v.published_at ? fmtDateTime(v.published_at) : fmtAgo(v.created_at)}</div>
                      </div>
                      {v.status === 'published' ? <Pill tone="ok">Live</Pill>
                        : v.status === 'review' ? <Pill tone="wait">In review</Pill>
                          : v.status === 'draft' ? <Pill tone="wait">Draft</Pill>
                            : <Pill tone="mute">Archived</Pill>}
                    </div>
                  ))}
                  {d.versions.some((v: any) => v.status === 'archived') ? (
                    <Action kind="ghost" label="Roll back to the previous version" onClick={async () => {
                      const r = await client.post(`/admin/content/${param}/rollback`)
                      toast(`Rolled back to v${r.versionNo}`); q.reload()
                    }} />
                  ) : null}
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

function Teachers() {
  const { toast } = useSession()
  const q = useLoad(() => client.get('/admin/teachers'))
  const courses = useLoad(() => client.get('/admin/courses'))
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState<any>(null)

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Teachers" sub="Brolly Juniors staff. Not attached to any school."
            right={<button className="btn gold" onClick={() => setAdding(true)}>Add a teacher</button>} />
          <Table head={['Teacher', 'Courses', 'Students', 'Sessions', 'Last active', 'Status', '']}>
            {d.teachers.map((t: any) => (
              <tr key={t.id}>
                <td><strong>{t.full_name}</strong><div className="tiny muted mono">{t.email}</div>
                  {t.headline ? <div className="tiny muted">{t.headline}</div> : null}</td>
                <td className="small">{(t.courses ?? []).join(', ') || '—'}</td>
                <td className="mono">{t.students}</td>
                <td className="mono">{t.sessions}</td>
                <td className={'small ' + (fmtAgo(t.last_login_at) === 'Today' ? '' : 'muted')}>{fmtAgo(t.last_login_at)}</td>
                <td>{t.status === 'active' ? <Pill tone="ok">Active</Pill> : <Pill tone="mute">Disabled</Pill>}</td>
                <td>
                  <Action small kind="ghost" label={t.status === 'active' ? 'Deactivate' : 'Reactivate'}
                    onClick={async () => {
                      await client.post(`/admin/users/${t.id}/status`,
                        { status: t.status === 'active' ? 'disabled' : 'active' })
                      toast('Updated'); q.reload()
                    }} />
                </td>
              </tr>
            ))}
          </Table>

          {adding && (
            <AddTeacher courses={(courses.data as any)?.courses ?? []} onClose={() => setAdding(false)}
              onDone={r => { setAdding(false); setCreated(r); q.reload() }} />
          )}
          {created && (
            <Modal title="Teacher account created" onClose={() => setCreated(null)}>
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

function AddTeacher({ courses, onClose, onDone }: {
  courses: any[]; onClose: () => void; onDone: (r: any) => void
}) {
  const [f, setF] = useState({ fullName: '', email: '', headline: '', bio: '', yearsExp: '5' })
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState('')
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })

  return (
    <Modal title="Add a teacher" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        They get a Brolly Juniors login and see only the courses you assign them to.
      </p>
      <Field label="Full name"><input value={f.fullName} onChange={set('fullName')} /></Field>
      <Field label="Email">
        <input type="email" value={f.email} onChange={set('email')} placeholder="name@brollyjuniors.com" />
      </Field>
      <Field label="Headline" help="Shown on the public course page.">
        <input value={f.headline} onChange={set('headline')} placeholder="Python & AI educator" />
      </Field>
      <Field label="Short bio"><textarea value={f.bio} onChange={set('bio')} /></Field>
      <Field label="Years of experience">
        <input value={f.yearsExp} onChange={set('yearsExp')} inputMode="numeric" />
      </Field>

      <h3 style={{ marginTop: 14 }}>Courses</h3>
      <div className="sub" style={{ marginBottom: 10 }}>They see these and nothing else</div>
      {courses.map(c => (
        <label className="unit" key={c.id} style={{ cursor: 'pointer', marginBottom: 7 }}>
          <div className="num">
            <input type="checkbox" checked={picked.includes(c.id)}
              onChange={() => setPicked(p => p.includes(c.id) ? p.filter(x => x !== c.id) : [...p, c.id])} />
          </div>
          <div className="body"><div className="t">{c.title}</div><div className="m">{c.enrolments} students</div></div>
        </label>
      ))}
      {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
      <div className="row" style={{ marginTop: 14 }}>
        <Action label="Create teacher account" onClick={async () => {
          setErr('')
          try {
            const r = await client.post('/admin/teachers', {
              ...f, yearsExp: Number(f.yearsExp), courseIds: picked,
            })
            onDone({ ...r, fullName: f.fullName })
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost stack" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

function Students() {
  const { toast } = useSession()
  const [search, setSearch] = useState('')
  const q = useLoad(() => client.get(`/admin/students${search ? `?q=${encodeURIComponent(search)}` : ''}`), [search])
  const [term, setTerm] = useState('')

  return (
    <>
      <Head title="Students" sub="Direct Brolly Juniors customers" />
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Field label="Search by name or email">
              <input value={term} onChange={e => setTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setSearch(term) }} />
            </Field>
          </div>
          <div style={{ paddingBottom: 14 }}>
            <button className="btn gold" onClick={() => setSearch(term)}>Search</button>
          </div>
        </div>
      </div>
      <Page q={q}>
        {(d: any) => (
          <>
            <Table head={['Student', 'Courses', 'Completed', 'Spent', 'Joined', 'Last seen', '']}>
              {d.students.map((s: any) => (
                <tr key={s.id}>
                  <td><strong>{s.full_name}</strong><div className="tiny muted mono">{s.email}</div></td>
                  <td className="mono">{s.courses}</td>
                  <td className="mono">{s.completed}</td>
                  <td className="mono">{price(Number(s.spent_minor))}</td>
                  <td className="small muted">{fmtDate(s.created_at)}</td>
                  <td className="small muted">{fmtAgo(s.last_seen)}</td>
                  <td>
                    <Action small kind="ghost" label={s.status === 'active' ? 'Deactivate' : 'Reactivate'}
                      onClick={async () => {
                        await client.post(`/admin/users/${s.id}/status`,
                          { status: s.status === 'active' ? 'disabled' : 'active' })
                        toast('Updated'); q.reload()
                      }} />
                  </td>
                </tr>
              ))}
            </Table>
            {d.students.length >= 200
              ? <p className="tiny muted" style={{ marginTop: 10 }}>Showing the first 200. Search to narrow it.</p>
              : null}
          </>
        )}
      </Page>
    </>
  )
}

// ---------------------------------------------------------------------------

function Live() {
  const { toast } = useSession()
  const q = useLoad(() => client.get('/admin/live'))
  const [scheduling, setScheduling] = useState(false)

  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Live classes" sub="Scheduled centrally, hosted by a teacher"
            right={<button className="btn gold" onClick={() => setScheduling(true)}>Schedule a class</button>} />
          <Table head={['Class', 'Course', 'Teacher', 'When', 'Registered', 'Attended', 'Status']}>
            {d.sessions.map((s: any) => (
              <tr key={s.id}>
                <td><strong>{s.title}</strong></td>
                <td className="small">{s.course}</td>
                <td className="small">{s.teacher}</td>
                <td className="small">{fmtDateTime(s.starts_at)}</td>
                <td className="mono">{s.registered}</td>
                <td className="mono">{s.attended || '—'}</td>
                <td>{s.status === 'live' ? <Pill tone="bad">Live</Pill>
                  : s.status === 'ended' ? <Pill tone="mute">Ended</Pill>
                    : <Pill tone="wait">Scheduled</Pill>}</td>
              </tr>
            ))}
          </Table>
          <Note>
            <strong>The meeting provider is a column, not a dependency.</strong> Zoom, Meet or Daily plugs in as
            an adapter; nothing in the schema or the screens changes.
          </Note>

          {scheduling && (
            <ScheduleClass courses={d.courses} teachers={d.teachers} onClose={() => setScheduling(false)}
              onDone={n => { setScheduling(false); toast(`Scheduled for ${n} enrolled students`); q.reload() }} />
          )}
        </>
      )}
    </Page>
  )
}

function ScheduleClass({ courses, teachers, onClose, onDone }: {
  courses: any[]; teachers: any[]; onClose: () => void; onDone: (n: number) => void
}) {
  const tomorrow = new Date(Date.now() + 864e5)
  const [f, setF] = useState({
    courseId: courses[0]?.id ?? '', teacherId: teachers[0]?.id ?? '', title: '', description: '',
    date: tomorrow.toISOString().slice(0, 10), time: '18:00', durationMinutes: '60',
  })
  const [err, setErr] = useState('')
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })

  return (
    <Modal title="Schedule a live class" onClose={onClose}>
      <Field label="Title"><input value={f.title} onChange={set('title')} placeholder="Week 4 — lists in practice" /></Field>
      <Field label="Description"><textarea value={f.description} onChange={set('description')} /></Field>
      <div className="grid g2" style={{ gap: 10 }}>
        <Field label="Course">
          <select value={f.courseId} onChange={set('courseId')}>
            {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
        <Field label="Teacher" help="Must already be assigned to that course.">
          <select value={f.teacherId} onChange={set('teacherId')}>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid g3" style={{ gap: 10 }}>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Start time"><input type="time" value={f.time} onChange={set('time')} /></Field>
        <Field label="Length">
          <select value={f.durationMinutes} onChange={set('durationMinutes')}>
            <option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option>
          </select>
        </Field>
      </div>
      {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}
      <div className="row" style={{ marginTop: 8 }}>
        <Action label="Schedule it" onClick={async () => {
          setErr('')
          try {
            const r = await client.post('/admin/live', {
              courseId: f.courseId, teacherId: f.teacherId, title: f.title, description: f.description,
              startsAt: new Date(`${f.date}T${f.time}:00`).toISOString(),
              durationMinutes: Number(f.durationMinutes),
            })
            onDone(r.enrolled)
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost stack" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

function Orders() {
  const q = useLoad(() => client.get('/admin/orders'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Orders" sub="Every purchase. No card details are stored anywhere." />
          <div className="grid g4">
            <Stat k="Revenue" v={price(Number(d.summary.revenue_minor))} d={`${d.summary.paid} paid`} />
            <Stat small k="Paid" v={d.summary.paid} />
            <Stat small k="Pending" v={d.summary.pending} d="Started, not completed" />
            <Stat small k="Failed" v={d.summary.failed} d="Declined at the provider" />
          </div>
          <Head title="Recent orders" />
          <Table head={['Student', 'Course', 'Amount', 'Status', 'Provider reference', 'When']}>
            {d.orders.map((o: any) => (
              <tr key={o.id}>
                <td><strong>{o.student}</strong><div className="tiny muted mono">{o.email}</div></td>
                <td className="small">{o.course}</td>
                <td className="mono">{price(o.amount_minor)}</td>
                <td>{o.status === 'paid' ? <Pill tone="ok">Paid</Pill>
                  : o.status === 'failed' ? <Pill tone="bad">Failed</Pill> : <Pill tone="wait">Pending</Pill>}</td>
                <td className="tiny mono muted">{o.provider}/{o.provider_ref}</td>
                <td className="small muted">{fmtAgo(o.created_at)}</td>
              </tr>
            ))}
          </Table>
          <Note>
            <strong>The provider reference is the only link to a payment.</strong> No card number, expiry or
            CVV reaches this application, so none of it can be in this table or in the audit log.
          </Note>
        </>
      )}
    </Page>
  )
}

function Audit() {
  const q = useLoad(() => client.get('/admin/audit'))
  return (
    <Page q={q}>
      {(d: any) => (
        <>
          <Head title="Activity log" sub="Every action worth being able to explain later" />
          <Table head={['When', 'Who', 'Role', 'Action', 'What']}>
            {d.entries.map((e: any) => (
              <tr key={e.id}>
                <td className="tiny mono muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.occurred_at)}</td>
                <td className="small">{e.actor ?? '—'}</td>
                <td className="tiny muted">{e.actor_role}</td>
                <td><span className="mono tiny">{e.action}</span></td>
                <td className="small">{e.summary}</td>
              </tr>
            ))}
          </Table>
          <Note>
            <strong>Redaction is a whitelist.</strong> Only fields explicitly marked auditable are written here,
            so a column added tomorrow cannot start leaking into the log — which is exactly how blacklists fail.
          </Note>
        </>
      )}
    </Page>
  )
}

function Profile() {
  const { me, toast, reload } = useSession()
  const [name, setName] = useState(me.user.fullName)
  return (
    <>
      <Head title="My profile" sub={me.brand.legalName} />
      <div className="grid g2">
        <div className="card">
          <h3>Your details</h3>
          <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Email"><input value={me.user.email} readOnly /></Field>
          <Action label="Save" onClick={async () => {
            await client.patch('/me', { fullName: name }); toast('Saved'); await reload()
          }} />
        </div>
        <div className="card">
          <h3>Brand configuration</h3>
          <div className="sub" style={{ marginBottom: 12 }}>
            One brand today. It is read from configuration rather than written into components, which is what
            makes a second one a data change later.
          </div>
          {[['Name', me.brand.name], ['Legal name', me.brand.legalName], ['Support', me.brand.supportEmail],
            ['City', me.brand.city], ['Currency', me.brand.currency]].map(([k, v]: any) => (
            <div key={k} style={{ display: 'flex', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="small muted" style={{ flex: 1 }}>{k}</div>
              <div className="small" style={{ fontWeight: 600 }}>{v}</div>
            </div>
          ))}
          <div className="row tight" style={{ marginTop: 12 }}>
            <span className="chip" style={{ background: me.brand.primaryColor, color: 'var(--cta-text)' }}>
              {me.brand.primaryColor}
            </span>
            <span className="chip" style={{ background: me.brand.secondaryColor, color: '#fff' }}>
              {me.brand.secondaryColor}
            </span>
          </div>
        </div>
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
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
