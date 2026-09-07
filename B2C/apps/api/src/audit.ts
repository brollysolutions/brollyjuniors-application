import type { Conn } from '@brolly/b2c-db'

/**
 * Redaction is a WHITELIST, not a blacklist. Only fields named here are ever
 * serialised into an audit row, so adding a `reset_token` column tomorrow
 * cannot silently start leaking it — which is exactly how blacklists fail.
 *
 * Note what is absent: nothing payment-related beyond a provider reference and
 * an amount. Card data never reaches this process, so it cannot reach this log.
 */
const AUDITABLE = new Set([
  'id', 'title', 'name', 'full_name', 'email', 'status', 'slug', 'level',
  'price_minor', 'currency', 'amount_minor', 'provider', 'provider_ref',
  'course_id', 'module_id', 'lesson_id', 'role', 'role_id', 'score',
  'due_at', 'starts_at', 'ends_at', 'meeting_url', 'version_no', 'release_no',
  'published_at', 'feedback', 'max_score', 'duration_hours',
])

function redact(obj: Record<string, any> | null | undefined) {
  if (!obj) return null
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) if (AUDITABLE.has(k)) out[k] = v
  return Object.keys(out).length ? out : null
}

export type AuditEntry = {
  action: string
  entityType?: string
  entityId?: string | null
  summary: string
  before?: Record<string, any> | null
  after?: Record<string, any> | null
}

export async function audit(
  c: Conn,
  who: { userId: string | null; role: string; ip?: string; ua?: string; requestId?: string },
  entry: AuditEntry,
) {
  await c.query(
    `INSERT INTO audit_log (actor_user_id, actor_role, action, entity_type, entity_id, summary,
                            before_data, after_data, ip, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [who.userId, who.role, entry.action, entry.entityType ?? '', entry.entityId ?? null, entry.summary,
      JSON.stringify(redact(entry.before)), JSON.stringify(redact(entry.after)),
      who.ip ?? '', (who.ua ?? '').slice(0, 250), who.requestId ?? ''])
}
