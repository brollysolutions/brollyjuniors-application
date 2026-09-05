# 09 — Roadmap, Risks & Open Decisions

## 9.1 Open decisions — these need your answer

Ordered by how much rework a late answer causes. **D1–D6 change the database schema or the stack
and should be answered before Phase 2 starts.** The rest can be answered during the phase noted.

| # | Decision | Options | My recommendation | Blocks |
|---|---|---|---|---|
| **D1** | Backend language/framework | (a) TypeScript + NestJS (b) Python + Django/DRF | **(a)** if the team is comfortable with TS — one language, shared contracts. **(b)** if the team is Python-first; it is a genuinely good fit and a fluent team beats a "better" stack. | Phase 2 |
| **D1b** | Auth: build or buy | (a) In-house (b) Keycloak / Auth0 / WorkOS with organisations | **(a) in-house.** Per-tenant roles + platform scope + student accounts without email are awkward and expensive on managed providers. Revisit if enterprise SSO becomes a sales blocker. | Phase 3 |
| **D2** | Cloud + CDN | (a) AWS (S3 + CloudFront + RDS) (b) Cloudflare R2 + Cloudflare (c) GCP/Azure | **(a) AWS** for maturity of signed URLs and RDS; **cost R2 seriously** if video volume is high — egress dominates the bill. Decide before infra work, it changes the signing code. | Phase 2/5 |
| **D3** | Email uniqueness | (a) Globally unique (b) Unique per tenant | **(a)**, with the per-tenant unique index also present so we can relax later without a migration. Confirm: can one person be a teacher at two schools with one email? | Phase 2 |
| **D4** | B2C tenancy | (a) One `Brolly Direct` tenant for all consumers (b) A tenant per consumer | **(a)** — see 02 §2.3. | Phase 2 |
| **D5** | Student identity | (a) Email required (b) Username within tenant, email optional | **(b)** — many young students have no email, and requiring one creates a child-data liability. Email optional for guardians. | Phase 2 |
| **D6** | Content locale | (a) Ignore for now (b) `locale` on `content_version` from day 1 | **(b)** — one nullable column now versus a painful migration later. Multi-language is on your own future list (§41). | Phase 2 |
| **D7** | Python execution for graded work | (a) Pyodide only (b) Pyodide + server sandbox (gVisor/Firecracker) for graded runs | **(a) for v1, (b) by Phase 8** if auto-graded assessment matters. Client-side execution is trivially tamperable, so it cannot back a grade that counts. **This is a whole subsystem the brief did not mention — please confirm the requirement.** | Phase 8 |
| **D8** | Video protection level | (a) Signed URLs (b) HLS + segment tokens (c) DRM (Widevine/FairPlay) | **(a)** for v1. (c) is expensive and only justified if the content is the business's primary defensible asset. | Phase 5 |
| **D9** | Subdomains in v1 | (a) Shared host only (b) `*.brollyjuniors.com` from launch | **(b) wildcard subdomains** — it is cheap now (one wildcard cert), it makes the login-tenant problem disappear, and it is what schools expect to see. Custom apex domains stay deferred. | Phase 4/9 |
| **D10** | Tenant-authored curriculum | (a) Consume master only (b) Tenants may add their own lessons/chapters | **(a)** for v1. (b) roughly doubles the content model (tenant overlays, merge order, per-tenant releases). If a school has already asked for it, tell me now — it changes 04 and 05. | Phase 4 |
| **D11** | Data retention periods | Business/legal input needed | Propose: submissions & progress kept for the enrolment + 3 years; audit 7 years; deleted accounts purged in 30 days. | Phase 3 |
| **D12** | Column-level encryption for DOB / guardian contact | (a) Rely on at-rest encryption (b) Application-level encryption | **(b)** for DOB and guardian contact only. Modest cost, materially better story in a school's due-diligence questionnaire. | Phase 2 |
| **D13** | SLA / RPO / RTO | Business input | Propose 99.9% uptime, RPO 5 min (PITR), RTO 1 hour. Drives replica and backup spend. | Phase 5 |
| **D14** | School SSO (Google Workspace for Education / Microsoft / LTI 1.3) | (a) Defer (b) Google SSO in v1 | **(a) defer, but reserve the schema** (`user.external_idp`, `external_id`). Google SSO is the single most-requested school integration; expect it by year 1. | Phase 6 |
| **D15** | Year-1 scale targets | Business input | Needed to size RDS/Redis/CDN. Give me expected tenants, students per tenant, concurrent readers at peak, GB of video. | Phase 5 |
| **D16** | Payments provider for B2C | Razorpay / Stripe | Deferred, but the entitlement model already anticipates it (`tenant_entitlement.source = 'purchase'`). | Post-v1 |

## 9.2 Risks and their mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| **R1** | A single missed tenant filter leaks data across schools | Existential — one incident ends B2B sales | Four enforcement layers (02 §2.5) + meta-tests that fail when a new table or route is added wrongly. Deliberate redundancy: any one layer alone would suffice. |
| **R2** | Signed media URLs are shareable within their TTL | Content piracy, moderate | Short TTL, unguessable keys, issuance rate limits, key rotation as break-glass. Accepted, documented (05 §5.7). Escalate to D8 only if the business requires it. |
| **R3** | Shared database noisy-neighbour | Latency spikes for all tenants | Per-tenant rate limits and queue quotas, `statement_timeout`, connection caps, slow-query alerting. Shard escape hatch if a tenant outgrows the cluster. |
| **R4** | **Prisma/RLS + connection pooling friction** | Real engineering cost, discovered late if ignored | `SET LOCAL` is transaction-scoped ⇒ every tenant-scoped request runs in a transaction, and PgBouncer must be in *transaction* mode. **Prototype this in the first week of Phase 2**, before the schema is large. If it proves unworkable, the fallback is application-layer scoping (layers 1, 2, 4) with RLS on a separate read path — weaker, and we should know early. |
| **R5** | Content model too rigid for real textbooks | Authors blocked; ad-hoc HTML creeps back in | Sit with a real Python chapter during Phase 4 and enumerate the block types it actually needs before freezing the schema. `schemaVersion` + unknown-block fallback allow additions without a breaking change. |
| **R6** | CDN egress cost for video | Budget surprise | Model cost early (D2/D15); adaptive bitrate rather than single high-bitrate MP4; consider R2. |
| **R7** | Children's-data compliance gap | Regulatory and reputational | 07 §7.7 designed in, not retrofitted; legal review before the first B2C signup. |
| **R8** | Scope creep from the "future requirements" list (§41) | Nothing ships | The list is explicitly deferred. Each item becomes an ADR when it is scheduled. The architecture is judged on whether it *permits* them, not on whether it implements them. |
| **R9** | Publishing bug serves partial content to students | Trust damage, hard to notice | Release-level atomicity + one-transaction pointer flip + partial unique index (05 §5.4); a smoke test that reads the manifest after every publish; instant rollback. |
| **R10** | Reporting queries on the primary degrade learning traffic | Slow app during the school day | Reports read the replica from day 1; heavy analytics move to a columnar store when volume demands. |
| **R11** | Two divergent B2B/B2C code paths appear anyway | The original problem, reintroduced | Lint rule banning `tenant_type` outside provisioning (06 §6.7); code review treats any new `isB2B` as a defect. |

## 9.3 Delivery roadmap

Estimates assume 2–3 engineers. They are relative sizes for sequencing, not commitments.

| Phase | Scope | Exit criteria | Rough size |
|---|---|---|---|
| **1. Architecture** | These documents | You approve; D1–D6 answered; ADRs written | done, pending review |
| **2. Foundation & database** | Monorepo, CI, Prisma schema, RLS + composite FKs + partitions, seeds, local Docker stack, **R4 spike in week 1** | `pnpm migrate && pnpm seed` produces a working two-tenant database; the RLS proof test passes | 2 weeks |
| **3. Auth, RBAC & isolation** | Login, MFA, refresh rotation, tenant resolution, guards, policies, `/me/bootstrap`, **cross-tenant abuse suite** | Every test in 07 §7.6 passes and runs on every PR | 2–3 weeks |
| **4. Brolly Admin & Content Hub** | Tenant CRUD, branding, features, entitlements, curriculum CRUD, content items/versions, review workflow, media upload | A tenant can be created and a textbook authored entirely through the UI, with no SQL | 3–4 weeks |
| **5. Content delivery** | Releases, manifest build, pointer, CDN + signing, entitlement checks, caching, rollback, TextbookReader | The §44 scenario passes end to end: publish v2, students see it in ≤60 s, rollback in seconds, **zero deploys** | 2–3 weeks |
| **6. B2B** | School Admin (users, classes, course assignment, reports), Teacher (classes, assignments, grading, progress), Student | A pilot school runs a real class for a week | 4 weeks |
| **7. B2C** | Self-signup with guardian consent, self-enrolment, the same reader and dashboards | Zero new learning components written — reuse is the acceptance criterion | 1–2 weeks |
| **8. Learning depth** | Quizzes, exercises, Pyodide runner, achievements, certificates, richer progress | Students complete a full course with graded work | 3 weeks |
| **9. Branding & configuration polish** | Theming, tenant navigation, dashboard composition, settings | Two visibly different tenants from one deployment, configured by data only | 1–2 weeks |
| **10. Hardening & launch** | Load test, pen test, runbooks, backup restore drill, observability | The pre-launch gate in 07 §7.8 is green | 2 weeks |

Phases 6 and 7 can overlap once Phase 5 lands. Phase 7 is deliberately tiny — **if B2C takes longer
than two weeks, the multi-tenant architecture has failed**, and that is the cleanest single test of
whether this design worked.

## 9.4 What I would build first if you want proof early

If you would like evidence before committing to the full plan, the highest-signal vertical slice is
roughly three weeks and proves the two claims the whole platform rests on:

1. Two tenants, two brandings, one deployment, one login page that changes appearance by host.
2. One Python chapter, published from the Content Hub, read by a student in each tenant, edited,
   republished, and seen updated — with the deploy pipeline provably untouched throughout.

Everything else in this architecture is ordinary CRUD by comparison. Those two are the parts worth
de-risking first.
