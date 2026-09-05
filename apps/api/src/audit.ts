import type { Conn } from '@brolly/db'

/**
 * Redaction is a WHITELIST, not a blacklist. Only fields named here are ever
 * serialised into an audit row, so adding a `password_reset_token` column
 * tomorrow cannot silently start leaking it into the log — which is exactly how
 * blacklists fail.
 */
const AUDITABLE_FIELDS = new Set([
  'id', 'name', 'title', 'full_name', 'email', 'username', 'roll_no', 'status',
  'seats', 'levels', 'valid_until', 'school_code', 'area', 'board',
  'class_id', 'course_id', 'role_id', 'score', 'marks_awarded', 'feedback',
  'starts_at', 'duration_minutes', 'due_at', 'display_name', 'primary_color',
  'secondary_color', 'welcome_message', 'enabled', 'feature_key', 'release_no',
])

function redact(obj: Record<string, any> | null | undefined) {
  if (!obj) return null
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) if (AUDITABLE_FIELDS.has(k)) out[k] = v
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
  who: { tenantId: string | null; userId: string | null; scope: 'tenant' | 'platform'; ip?: string; ua?: string; requestId?: string },
  entry: AuditEntry,
) {
  await c.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, actor_scope, action, entity_type, entity_id, summary,
        before_data, after_data, ip, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [who.tenantId, who.userId, who.scope, entry.action, entry.entityType ?? '', entry.entityId ?? null,
      entry.summary, JSON.stringify(redact(entry.before)), JSON.stringify(redact(entry.after)),
      who.ip ?? '', (who.ua ?? '').slice(0, 250), who.requestId ?? ''])
}
