'use client'

/**
 * The shared resource library.
 *
 * Brolly Admin fills the shelf; every teacher and student reads the same shelf.
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
  status: 'published' | 'hidden'; body: Block[]; externalUrl: string
  courseId: string | null; course: string | null; mediaAssetId: string | null
  createdAt: string; updatedAt: string; file: ResourceFile | null
}

const CATEGORY_LABEL: Record<string, string> = {
  syllabus: 'Syllabus', notes: 'Notes', handout: 'Handout',
  policy: 'Policy', link: 'Link', other: 'Other',
}
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
              sub="Notes, syllabus and handouts shared by Brolly with everyone" />

            {d.resources.length === 0 ? (
              <Empty title="Nothing here yet"
                detail="Brolly adds notes, a syllabus and handouts here. Anything they add shows up on this page straight away." />
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
          <a className="btn gold sm" href={client.mediaUrl(r.file.url)}
            target="_blank" rel="noopener noreferrer">
            Open <span className="tiny" style={{ opacity: .8 }}>{kb(r.file.bytes)}</span>
          </a>
        ) : null}
        {r.externalUrl ? (
          <a className="btn ghost sm" href={r.externalUrl} target="_blank" rel="noopener noreferrer">
            Open link
          </a>
        ) : null}
      </div>
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
        const reach = (d.audience?.teachers ?? 0) + (d.audience?.students ?? 0)
        return (
          <>
            <Head title="Shared library"
              sub="Notes, syllabus and anything else every teacher and student should have"
              right={<button className="btn gold" onClick={() => setAdding(true)}>Add a resource</button>} />

            <Note tone="teal">
              <strong>Everything published here reaches everyone.</strong> No enrolment, no course and no
              sharing step — a teacher or student sees it on their Library screen the next time they open it.
              Hide a resource to take it back off the shelf without deleting it.
            </Note>

            <div className="grid g4" style={{ marginTop: 18 }}>
              <Stat k="On the shelf" v={live.length} d="Visible right now" />
              <Stat small k="Hidden" v={d.resources.length - live.length} d="Kept, not shown" />
              <Stat small k="Reaches" v={reach} d={`${d.audience?.teachers ?? 0} teachers · ${d.audience?.students ?? 0} students`} />
              <Stat small k="With a file" v={d.resources.filter((r: Resource) => r.file).length} />
            </div>

            {d.resources.length === 0 ? (
              <Empty title="The shelf is empty"
                detail="Add a syllabus, a set of notes or a handout. Everyone sees it as soon as you save."
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
                      ? <Pill tone="ok">Everyone</Pill> : <Pill tone="mute">Hidden</Pill>}</td>
                    <td className="row tight">
                      <button className="btn ghost sm" onClick={() => setEditing(r)}>Edit</button>
                      <Action small kind={r.status === 'published' ? 'ghost' : 'gold'}
                        label={r.status === 'published' ? 'Hide' : 'Publish'}
                        onClick={async () => {
                          await client.post(`/admin/resources/${r.id}/status`, {
                            status: r.status === 'published' ? 'hidden' : 'published',
                          })
                          toast(r.status === 'published'
                            ? 'Taken off the shelf' : 'Published — everyone can see it')
                          q.reload()
                        }} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            {adding && (
              <ResourceForm courses={d.courses} categories={d.categories}
                onClose={() => setAdding(false)}
                onDone={n => {
                  setAdding(false)
                  toast(`Added — visible to ${n} teachers and students now`)
                  q.reload()
                }} />
            )}
            {editing && (
              <ResourceForm resource={editing} courses={d.courses} categories={d.categories}
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

function ResourceForm({ resource, courses, categories, onClose, onDone, onDelete }: {
  resource?: Resource
  courses: Array<{ id: string; title: string }>
  categories: string[]
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
  const [assetId, setAssetId] = useState<string | null>(resource?.mediaAssetId ?? null)
  const [file, setFile] = useState<ResourceFile | null>(resource?.file ?? null)
  const [err, setErr] = useState('')
  const [uploading, setUploading] = useState('')
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })

  return (
    <Modal title={resource ? `Edit ${resource.title}` : 'Add a resource'} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Saved straight to the shelf: every teacher and student sees it immediately.
      </p>

      <Field label="Title">
        <input value={f.title} onChange={set('title')} placeholder="Python Foundations — syllabus 2026" />
      </Field>
      <Field label="One-line summary" help="Shown under the title on everyone's Library screen.">
        <input value={f.description} onChange={set('description')} />
      </Field>

      <div className="grid g2" style={{ gap: 10 }}>
        <Field label="Kind">
          <select value={f.category} onChange={set('category')}>
            {categories.map(c => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </Field>
        <Field label="About a course (optional)"
          help="A label to help people find it. It stays visible to everyone either way.">
          <select value={f.courseId} onChange={set('courseId')}>
            <option value="">Not course-specific</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
      </div>

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
        <Action label={resource ? 'Save changes' : 'Add to the library'} onClick={async () => {
          setErr('')
          const payload = {
            title: f.title, description: f.description, category: f.category,
            courseId: f.courseId || null, externalUrl: f.externalUrl,
            body: toBlocks(f.notes),
            mediaAssetId: assetId,
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
          <Action kind="ghost" label="Delete" working="Deleting" onClick={async () => {
            setErr('')
            try { await onDelete() } catch (e: any) { setErr(e.message) }
          }} />
        ) : null}
      </div>
    </Modal>
  )
}
