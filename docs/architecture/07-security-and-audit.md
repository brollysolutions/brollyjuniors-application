# 07 — Security Architecture & Audit

## 7.1 Threat model — what actually goes wrong in a multi-tenant EdTech platform

Ranked by likelihood × impact for *this* system, not by generic OWASP ordering.

| # | Threat | Why it is realistic here | Primary control |
|---|---|---|---|
| T1 | **Cross-tenant data access** | One missing `WHERE tenant_id` in one query, forever | 4 independent layers (02 §2.5) + adversarial CI suite |
| T2 | **Broken object-level authorization (IDOR)** | Students are curious and ids are in URLs | Per-resource policy functions (03 §3.6); UUIDv7 ids; 404 not 403 |
| T3 | **Privilege escalation** | A School Admin granting themselves platform rights | Role-level subset rule; platform scope only accepted on `/platform/*` |
| T4 | **Unauthorized content access** | Paying schools next to non-paying ones on one platform | Entitlement check before URL signing (05 §5.8) |
| T5 | **Media URL leakage** | Signed URLs are bearer capabilities | 15-min expiry, unguessable keys, rate-limited issuance, key rotation as break-glass |
| T6 | **Stored XSS via authored content** | Rich content authored by humans, rendered to children | Block documents, not HTML (05 §5.2); no `dangerouslySetInnerHTML`; strict CSP |
| T7 | **Malicious file upload** | Teachers/authors upload PDFs, images, student code | Magic-byte sniffing, size caps, separate no-execute origin, AV scan, `Content-Disposition: attachment` for PDFs |
| T8 | **Credential stuffing on student accounts** | Weak, reused, school-issued passwords | Breached-password check, per-IP+account backoff, MFA for staff |
| T9 | **Token theft / replay** | Shared school computers | 10-min access tokens, HttpOnly refresh, rotation with reuse detection, session listing |
| T10 | **Children's data exposure** | Regulatory *and* reputational catastrophe | Data minimisation, consent tracking, encryption, retention limits (7.7) |
| T11 | **Noisy neighbour / resource exhaustion** | One tenant's bulk import starving others | Per-tenant rate limits, queue quotas, statement timeouts |
| T12 | **Insider / support over-reach** | Impersonation for support | Explicit `act_as` tokens, always audited, time-boxed, never silent |

## 7.2 Controls by layer

**Edge** — TLS 1.2+ (HSTS with preload), WAF with managed OWASP rules, per-IP and per-tenant rate
limiting, request size caps, bot rules on `/auth/*`.

**Transport & headers** — `Content-Security-Policy` with no `unsafe-inline` for scripts (nonces for
the branding style tag), `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` denying camera/mic/geolocation, `X-Content-Type-Options: nosniff`, CORS
allow-listed to known tenant hosts only (never `*`, never reflected).

**Application** — deny-by-default guards (03 §3.6); Zod validation on every input; DTO allow-lists
against mass assignment; output DTOs so a row is never serialised wholesale (`password_hash` cannot
leak because it is never in a response type); `Idempotency-Key` on mutating posts.

**Injection** — Prisma parameterises everything; raw SQL is confined to a reviewed directory and
must use parameter binding, enforced by lint; user input never reaches a dynamic `ORDER BY` except
through an allow-list of column names.

**CSRF** — the access token lives in memory and is sent as a header, so ordinary API routes are not
CSRF-eligible. The refresh endpoint, which does use a cookie, is protected by `SameSite=Lax` plus a
double-submit token, and accepts only `POST`.

**Database** — application connects as a non-superuser without `BYPASSRLS`; separate read-only role
for reporting/replica; `statement_timeout` (5 s app, 60 s reports); encryption at rest; credentials
from a secrets manager, rotated; no production data in non-production environments (masked seeds
only).

**Storage** — private buckets, no public policy, CDN Origin Access Control, versioning on, delete
protection, lifecycle rules, server-side encryption.

**Secrets** — none in the repo. `.env.example` documents names only. CI enforces secret scanning
(gitleaks) on every push. JWT signing keys live in KMS/secrets manager with `kid`-based rotation.

**Dependencies** — lockfiles committed, Dependabot/Renovate, `npm audit`/OSV in CI, SBOM per
release, pinned base images.

## 7.3 Input and output hardening for content

Content is the highest-risk data in this system because it is authored rich text rendered to
thousands of children:

- Block documents are schema-validated on write **and** on render.
- Every URL inside a block is scheme-checked (`https:` only; no `javascript:`, no `data:` except
  allow-listed image types).
- Code blocks are rendered as text with syntax highlighting; they are never evaluated except inside
  the Pyodide worker, which has no network and no DOM access.
- Embedded HTML blocks are **not supported**. If a business need for them appears, they get their
  own sandboxed iframe with a null origin — that is a decision, not a default.

## 7.4 Audit logging

Append-only, monthly-partitioned `audit_log`. Written by a global interceptor for anything that
mutates, plus explicit domain events for things worth recording even when nothing changed (a failed
authorization, an impersonation start).

Recorded actions — the brief's list, made concrete:

```
auth.login.success        auth.login.failed        auth.logout
auth.mfa.enabled          auth.password.changed    auth.password.reset
auth.session.revoked      auth.refresh.reuse_detected
tenant.created            tenant.updated           tenant.suspended
tenant.branding.updated   tenant.feature.updated   tenant.entitlement.granted/revoked
user.created              user.updated             user.deactivated
role.assigned             role.revoked             role.permission.changed
class.created/updated     class.teacher.assigned   class.student.assigned
course.assigned           enrollment.created       enrollment.revoked
assignment.created        assignment.published     submission.graded
grade.changed
content.item.created      content.version.created  content.version.approved
content.release.published content.release.rolled_back
media.uploaded            media.deleted
settings.changed          impersonation.started    impersonation.ended
authz.denied
```

Each row: `occurred_at, tenant_id, actor_user_id, actor_scope, action, entity_type, entity_id,
before_redacted, after_redacted, ip, user_agent, request_id`.

**Redaction is a whitelist, not a blacklist.** The diff writer serialises only fields explicitly
marked auditable on each entity. This means a newly added `password_reset_token` column cannot
accidentally start appearing in audit rows — the failure mode of blacklists.

Never logged: passwords, hashes, tokens, MFA secrets or recovery codes, signed URL signatures, full
payment details.

`grade.changed` deserves emphasis: grade disputes are the most common integrity question a school
will ask, and a before/after trail with an actor answers it in seconds.

Retention: hot in Postgres 90 days → Parquet in object storage (WORM, 7 years) → queryable on
demand. Tenant admins can read their own tenant's log (`audit:read`); Brolly Admin can read all.

## 7.5 Monitoring and alerting

Alert on, at minimum: `authz.denied` rate spike per user or tenant (probing), any cross-tenant
mismatch rejection (should be exactly zero in production — one occurrence is an incident),
`auth.refresh.reuse_detected` (token theft), 401/403 ratio per tenant, manifest issuance rate per
user (URL harvesting), publish failures, replica lag, queue depth.

Every log line and trace carries `tenant_id`, `user_id`, `request_id`, `release_no` where relevant.

## 7.6 The cross-tenant abuse suite

A permanent, first-class test suite — not a one-off Phase 3 exercise. It provisions two full
tenants with overlapping-shaped data and then attempts, exhaustively, to cross the boundary.

| Category | Examples |
|---|---|
| Token/host | A-token on B-host; platform token on a tenant route; tenant token on `/platform/*` |
| Direct object reference | Every tenant-scoped `GET/PATCH/DELETE /:id` route is enumerated by reflection and called with the other tenant's id. **A new route is automatically covered.** |
| Nested references | Enrol B's student into A's class; assign A's teacher to B's class; grade B's submission from A |
| Ownership within a tenant | Student reads another student's progress/submission; teacher reads a class they do not teach |
| Escalation | School Admin grants a platform role; School Admin publishes content |
| Entitlement | Unentitled tenant requests a manifest; expired entitlement; revoked mid-session |
| Media | Reuse a signed URL after expiry; forge a signature; fetch the S3 URL directly |
| Database | Query a tenant table with `app.current_tenant_id` unset (expect 0 rows) and with the wrong value |
| Meta | Assert every table has `tenant_id` + an RLS policy, or is on the platform allow-list; assert every route has a permission or `@Public()` |

The two **meta** tests are the highest-leverage tests in the codebase: they fail when someone adds
a table or route incorrectly, which is how this class of bug actually enters a system.

## 7.7 Children's data and compliance

Not optional, and cheaper to design in than to retrofit.

- **Minimisation.** Collect date of birth only if genuinely needed for age-gating; prefer grade
  level. No home address, no photographs by default.
- **Consent.** `student_profile.consent_status` and guardian contact; for B2C, guardian-verified
  signup below the applicable age. For B2B, the school is typically the consent-gathering party —
  which must be stated in the contract, and the platform records who asserted it.
- **Erasure & export.** Per-user export and delete, including media, honoured within the statutory
  window. Tenant-level export on offboarding (02 §2.7).
- **Retention.** Default retention per entity type; progress and submissions purged N years after a
  student leaves (**D11** — N is a business/legal decision).
- **No third-party ad or analytics trackers in student-facing pages.** First-party analytics only.
- **Regional residency.** Single region by default; the shard escape hatch (02 §2.1) is the answer
  if a customer contractually requires their own region.
- **Encryption.** TLS in transit, at rest everywhere; guardian contact and DOB are candidates for
  application-level column encryption (**D12**).

## 7.8 Pre-launch security gate

Before the first real tenant: cross-tenant suite green; automated dependency and secret scanning
green; SAST clean; an external penetration test focused on tenant isolation and content
entitlement; incident response runbook (including signing-key rotation and tenant suspension);
verified backup restore; documented RPO/RTO (**D13**).
