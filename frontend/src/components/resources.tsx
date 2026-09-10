'use client'

/**
 * The shared resource library.
 *
 * Brolly Admin chooses which teachers and students can read each resource.
 * Both views live here because the difference between them is the whole point
 * of the feature, and it is easier to see when they are a screen apart.
 *
 * Notes are stored as the same validated block document the rest of the
 * product uses — never HTML. The admin types plain text and `toBlocks` turns
 * it into blocks on the way in, so nobody has to write JSON to add a paragraph
 * and there is still nowhere for a script to live.
 */

import React, { useState } from 'react'
import type { Block } from '@/lib/types'
import * as client from '@/lib/api'
import {
  Action, Empty, Field, Head, Modal, Note, Page, Pill, Stat, Table,
  fmtDate, useLoad, useSession,
} from '@/components/ui'
import { Blocks } from '@/components/blocks'

type ResourceFile = {
  fileName: string; mimeType: string; bytes: number; kind: string; url: string
}
type Resource = {
  id: string; title: string; description: string; category: string
  recipientIds?: string[]
  status: 'published' | 'hidden'; body: Block[]; externalUrl: string
  courseId: string | null; course: string | null; mediaAssetId: string | null
  createdAt: string; updatedAt: string; file: ResourceFile | null
}

const CATEGORY_LABEL: Record<string, string> = {
  syllabus: 'Syllabus', textbook: 'Textbook', recording: 'Recording', notes: 'Notes', handout: 'Handout',
  policy: 'Policy', link: 'Link', other: 'Other',
}
type Recipient = { id: string; name: string; email: string; role: string; status: string }

const label = (c: string) => CATEGORY_LABEL[c] ?? c

const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

// ---------------------------------------------------------------------------
// Plain text <-> blocks
// ---------------------------------------------------------------------------

/**
 * A deliberately small subset: a line starting with `# ` is a heading, a run of
 * `- ` lines is a list, anything else is a paragraph. Enough to write readable
 * notes, and small enough that the round trip back to text is lossless.
 */
export function toBlocks(text: string): Block[] {
  const out: Block[] = []
  for (const chunk of text.split(/\n{2,}/)) {
    const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) continue
    if (lines.every(l => l.startsWith('- '))) {
      out.push({ type: 'list', items: lines.map(l => l.slice(2).trim()) })
    } else if (lines.length === 1 && lines[0].startsWith('# ')) {
      out.push({ type: 'heading', level: 3, text: lines[0].slice(2).trim() })
    } else {
      out.push({ type: 'paragraph', text: lines.join(' ') })
    }
  }
  return out
}

export function toText(blocks: Block[] | null | undefined): string {
  return (blocks ?? []).map(b =>
    b.type === 'heading' ? `# ${b.text}`
      : b.type === 'list' ? b.items.map(i => `- ${i}`).join('\n')
        : b.type === 'paragraph' ? b.text
          : '',
  ).filter(Boolean).join('\n\n')
}

// ---------------------------------------------------------------------------
// What a teacher or a student sees
// ---------------------------------------------------------------------------

export function ResourceLibrary() {
  const q = useLoad(() => client.get('/resources'))
  const [filter, setFilter] = useState('')

  return (
    <Page q={q} what="Loading the library">
      {(d: { resources: Resource[]; categories: string[] }) => {
        const shown = filter ? d.resources.filter(r => r.category === filter) : d.resources
        const used = d.categories.filter(c => d.resources.some(r => r.category === c))
        return (
          <>
            <Head title="Library"
              sub="Syllabus, textbooks, recordings and notes shared with you" />

            {d.resources.length === 0 ? (
              <Empty title="Nothing here yet"
                detail="Resources appear here when Brolly shares them with you." />
            ) : (
              <>
                {used.length > 1 ? (
                  <div className="filters">
                    <button className={!filter ? 'on' : ''} onClick={() => setFilter('')}>
                      All <span className="mono">{d.resources.length}</span>
                    </button>
                    {used.map(c => (
                      <button key={c} className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>
                        {label(c)}{' '}
                        <span className="mono">{d.resources.filter(r => r.category === c).length}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="grid g2">
                  {shown.map(r => <ResourceCard key={r.id} r={r} />)}
                </div>
              </>
            )}
          </>
        )
      }}
    </Page>
  )
}

function ResourceCard({ r }: { r: Resource }) {
  const [open, setOpen] = useState(false)
  const [fileError, setFileError] = useState('')
  const hasNotes = (r.body ?? []).length > 0

  return (
    <div className="card">
      <div className="row tight">
        <span className="tchip mat">{label(r.category)}</span>
        {r.course ? <Pill tone="mute">{r.course}</Pill> : null}
      </div>
      <h3 style={{ marginTop: 7 }}>{r.title}</h3>
      {r.description ? <div className="sub">{r.description}</div> : null}
      <div className="tiny muted" style={{ marginTop: 6 }}>Updated {fmtDate(r.updatedAt)}</div>

      {hasNotes && open ? (
        <div className="doc" style={{ boxShadow: 'none', padding: 0, marginTop: 12, maxWidth: 'none' }}>
          <Blocks blocks={r.body} />
        </div>
      ) : null}

      <div className="row tight" style={{ marginTop: 12 }}>
        {hasNotes ? (
          <button className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? 'Hide notes' : 'Read notes'}
          </button>
        ) : null}
        {r.file ? (
          <Action small label={`Open ${kb(r.file.bytes)}`} working="Opening" onClick={async () => {
            setFileError('')
            try { await client.openResourceFile(r.file!.url, r.file!.fileName) }
            catch (error: any) { setFileError(error.message) }
          }} />
        ) : null}
        {r.externalUrl ? (
          <a className="btn ghost sm" href={r.externalUrl} target="_blank" rel="noopener noreferrer">
            Open link
          </a>
        ) : null}
      </div>
      {fileError ? <Note tone="rose">{fileError}</Note> : null}
      {r.file ? <div className="tiny muted mono" style={{ marginTop: 8 }}>{r.file.fileName}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// What Brolly Admin sees
// ---------------------------------------------------------------------------

export function AdminResources() {
  const { toast } = useSession()
  const q = useLoad(() => client.get('/admin/resources'))
  const [editing, setEditing] = useState<Resource | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <Page q={q} what="Loading the library">
      {(d: any) => {
        const live = d.resources.filter((r: Resource) => r.status === 'published')
        const reach = new Set(live.flatMap((r: Resource) => r.recipientIds ?? [])).size
        return (
          <>
            <Head title="Shared library"
              sub="Share syllabus, textbooks, recordings and notes with selected people"
              right={<button className="btn gold" onClick={() => setAdding(true)}>Add a resource</button>} />

            <Note tone="teal">
              <strong>Share with a course or selected people.</strong> Select a course to share with its enrolled students and assigned teachers,
              or choose individuals when no course is selected.
              Hide a resource to remove it from recipients&apos; libraries.
            </Note>

            <div className="grid g4" style={{ marginTop: 18 }}>
              <Stat k="On the shelf" v={live.length} d="Visible right now" />
              <Stat small k="Hidden" v={d.resources.length - live.length} d="Kept, not shown" />
              <Stat small k="People with access" v={reach} d="Across published resources" />
              <Stat small k="With a file" v={d.resources.filter((r: Resource) => r.file).length} />
            </div>

            {d.resources.length === 0 ? (
              <Empty title="The shelf is empty"
                detail="Add a syllabus, textbook, recording or notes, then choose who can see it."
                action={<button className="btn gold" onClick={() => setAdding(true)}>Add a resource</button>} />
            ) : (
              <Table head={['Resource', 'Kind', 'Course', 'File', 'Updated', 'Visible', '']}>
                {d.resources.map((r: Resource) => (
                  <tr key={r.id}>
                    <td><strong>{r.title}</strong>
                      {r.description ? <div className="tiny muted">{r.description}</div> : null}</td>
                    <td><Pill>{label(r.category)}</Pill></td>
                    <td className="small">{r.course ?? '—'}</td>
                    <td className="tiny mono muted">
                      {r.file ? `${r.file.fileName} · ${kb(r.file.bytes)}`
                        : r.externalUrl ? 'link' : '—'}
                    </td>
                    <td className="small muted">{fmtDate(r.updatedAt)}</td>
                    <td>{r.status === 'published'
                      ? <Pill tone="ok">{r.courseId ? `Course members (${r.recipientIds?.length ?? 0})` : r.recipientIds?.length ? `${r.recipientIds.length} selected` : 'Admins only'}</Pill> : <Pill tone="mute">Hidden</Pill>}</td>
                    <td className="row tight">
                      <button className="btn ghost sm" onClick={() => setEditing(r)}>Edit</button>
                      <Action small kind={r.status === 'published' ? 'ghost' : 'gold'}
                        label={r.status === 'published' ? 'Hide' : 'Publish'}
                        onClick={async () => {
                          await client.post(`/admin/resources/${r.id}/status`, {
                            status: r.status === 'published' ? 'hidden' : 'published',
                          })
                          toast(r.status === 'published'
                            ? 'Taken off the shelf' : 'Published for its recipients')
                          q.reload()
                        }} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            {adding && (
              <ResourceForm courses={d.courses} categories={d.categories} recipients={d.recipients}
                onClose={() => setAdding(false)}
                onDone={n => {
                  setAdding(false)
                  toast(n ? `Added - shared with ${n} people` : 'Added - visible to admins only')
                  q.reload()
                }} />
            )}
            {editing && (
              <ResourceForm resource={editing} courses={d.courses} categories={d.categories} recipients={d.recipients}
                onClose={() => setEditing(null)}
                onDone={() => { setEditing(null); toast('Saved'); q.reload() }}
                onDelete={async () => {
                  await client.del(`/admin/resources/${editing.id}`)
                  setEditing(null); toast('Removed from the library'); q.reload()
                }} />
            )}
          </>
        )
      }}
    </Page>
  )
}

function ResourceForm({ resource, courses, categories, recipients, onClose, onDone, onDelete }: {
  resource?: Resource
  courses: Array<{ id: string; title: string; recipientIds: string[] }>
  categories: string[]
  recipients: Recipient[]
  onClose: () => void
  onDone: (visibleTo: number) => void
  onDelete?: () => Promise<void>
}) {
  const [f, setF] = useState({
    title: resource?.title ?? '',
    description: resource?.description ?? '',
    category: resource?.category ?? 'notes',
    courseId: resource?.courseId ?? '',
    externalUrl: resource?.externalUrl ?? '',
    notes: toText(resource?.body),
  })
  // The id is what the API stores; the rest is only there to describe the file
  // on screen. Kept separate so "edit the title" re-sends the id it came with
  // rather than dropping the attachment.
  const [recipientIds, setRecipientIds] = useState<string[]>(resource?.courseId ? [] : resource?.recipientIds ?? [])
  const selectedCourse = courses.find(course => course.id === f.courseId)
  const [recipientSearch, setRecipientSearch] = useState('')
  const people = Array.from(new Map(recipients.map(person => [person.id, person])).values())
  const matching = people.filter(person =>
    `${person.name} ${person.email} ${person.role}`.toLowerCase().includes(recipientSearch.toLowerCase()))
  const [assetId, setAssetId] = useState<string | null>(resource?.mediaAssetId ?? null)
  const [file, setFile] = useState<ResourceFile | null>(resource?.file ?? null)
  const [err, setErr] = useState('')
  const [uploading, setUploading] = useState('')
  const [confirming, setConfirming] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })

  return (
    <Modal title={resource ? `Edit ${resource.title}` : 'Add a resource'} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Select a course to share with its members automatically, or select individual people. Admins can manage all resources.
      </p>

      <Field label="Title">
        <input value={f.title} onChange={set('title')} placeholder="Python Foundations — syllabus 2026" />
      </Field>
      <Field label="One-line summary" help="Shown under the title for selected recipients.">
        <input value={f.description} onChange={set('description')} />
      </Field>

      <div className="grid g2" style={{ gap: 10 }}>
        <Field label="Kind">
          <select value={f.category} onChange={set('category')}>
            {categories.map(c => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </Field>
        <Field label="About a course (optional)"
          help="Automatically share with students enrolled in this course and its assigned teachers.">
          <select value={f.courseId} onChange={e => {
            setF({ ...f, courseId: e.target.value })
            setRecipientIds([])
          }}>
            <option value="">Not course-specific</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
      </div>

      {f.courseId ? (
        <Note tone="teal">
          <strong>Share with {selectedCourse?.title ?? 'this course'}.</strong>{' '}
          All enrolled students with active course access and assigned teachers will see this resource
          after you save. Currently {selectedCourse?.recipientIds.length ?? 0} people.
          Access updates automatically when course membership changes.
        </Note>
      ) : (
        <fieldset className="resource-recipients">
          <legend>Share with</legend>
          <p className="small muted">{recipientIds.length} selected. No selection means admins only.</p>
          <Field label="Find teachers or students">
            <input type="search" value={recipientSearch} onChange={e => setRecipientSearch(e.target.value)}
              placeholder="Search name, email or role" />
          </Field>
          <div className="resource-recipient-list" role="group" aria-label="Recipients">
            {matching.map(person => (
              <label className="resource-recipient" key={person.id}>
                <input type="checkbox" checked={recipientIds.includes(person.id)}
                  disabled={person.status !== 'active' && !recipientIds.includes(person.id)}
                  onChange={e => setRecipientIds(ids => e.target.checked
                    ? [...ids, person.id] : ids.filter(id => id !== person.id))} />
                <span className="break"><strong>{person.name}</strong>
                  <span className="small muted">{person.role === 'TEACHER' ? 'Teacher' : 'Student'} &middot; {person.email}
                    {person.status !== 'active' ? ' - Inactive' : ''}</span>
                </span>
              </label>
            ))}
            {!matching.length ? <p className="small muted">No matching people.</p> : null}
          </div>
          {recipientIds.length > 0 ? (
            <button className="btn ghost sm" onClick={() => setRecipientIds([])}>Clear selection</button>
          ) : null}
        </fieldset>
      )}

      <Field label="Notes"
        help="Plain text. A line starting with # is a heading, lines starting with - become a list.">
        <textarea value={f.notes} onChange={set('notes')} style={{ minHeight: 140 }}
          placeholder={'# Term 1\n\n- Variables and types\n- Loops\n\nBring a notebook to every live class.'} />
      </Field>

      <Field label="Attach a file" help="PDF, image, Office document, text, mp4 or mp3. Up to 25 MB.">
        <input type="file" onChange={async e => {
          const picked = e.target.files?.[0]
          if (!picked) return
          setErr(''); setUploading(picked.name)
          try {
            const r = await client.upload('/admin/media/upload', picked)
            setAssetId(r.id)
            setFile({ fileName: r.fileName, mimeType: r.mimeType, bytes: r.bytes, kind: r.kind, url: '' })
          } catch (e: any) { setErr(e.message) } finally { setUploading('') }
        }} />
      </Field>
      {uploading ? (
        <div className="loading" style={{ padding: '6px 0' }} role="status">
          <span className="spinner dark" /> Uploading {uploading}…
        </div>
      ) : file ? (
        <div className="unit" style={{ marginBottom: 10 }}>
          <div className="num" aria-hidden="true">▤</div>
          <div className="body">
            <div className="t small">{file.fileName}</div>
            <div className="m">{kb(file.bytes)} · {file.mimeType}</div>
          </div>
          <button className="btn ghost sm" onClick={() => { setFile(null); setAssetId(null) }}>
            Remove
          </button>
        </div>
      ) : null}

      <Field label="Or link to something (optional)"
        help="Anything hosted elsewhere. Must start with http:// or https://">
        <input value={f.externalUrl} onChange={set('externalUrl')} placeholder="https://…" />
      </Field>

      {err ? <Note tone="rose"><strong>{err}</strong></Note> : null}

      <div className="row" style={{ marginTop: 14 }}>
        <Action label={resource ? 'Save changes' : 'Add to the library'} disabled={!!uploading} onClick={async () => {
          setErr('')
          const payload = {
            title: f.title, description: f.description, category: f.category,
            courseId: f.courseId || null, externalUrl: f.externalUrl,
            body: toBlocks(f.notes),
            mediaAssetId: assetId, recipientIds: f.courseId ? [] : recipientIds,
          }
          try {
            if (resource) {
              await client.patch(`/admin/resources/${resource.id}`, payload)
              onDone(0)
            } else {
              const r = await client.post('/admin/resources', payload)
              onDone(r.visibleTo)
            }
          } catch (e: any) { setErr(e.message) }
        }} />
        <button className="btn ghost stack" onClick={onClose}>Cancel</button>
        {onDelete ? (
          // Two taps, not one. Deleting is the only thing on this screen that
          // cannot be undone — Hide takes a resource off the shelf and keeps
          // it — so a stray click on a button sitting beside Save must not be
          // enough to destroy someone's notes.
          confirming ? (
            <Action kind="ghost" label="Yes, delete it" working="Deleting" onClick={async () => {
              setErr('')
              try { await onDelete() } catch (e: any) { setErr(e.message); setConfirming(false) }
            }} />
          ) : (
            <button className="btn ghost stack" onClick={() => setConfirming(true)}>Delete</button>
          )
        ) : null}
      </div>
      {confirming ? (
        <Note tone="rose">
          <strong>Delete &ldquo;{resource?.title}&rdquo; for good?</strong> It disappears for every teacher
          and student, and it cannot be brought back.{' '}
          <button className="btn ghost sm" onClick={() => setConfirming(false)}>Keep it</button>
        </Note>
      ) : null}
    </Modal>
  )
}
