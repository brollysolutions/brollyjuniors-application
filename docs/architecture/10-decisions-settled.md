# 10 — Decisions settled by the prototype, and what was built

The end-to-end prototype answered several of the open questions from
[09](./09-roadmap-risks-decisions.md) outright. This records what changed, what
was built against it, and what is still open — so nobody has to reconstruct the
reasoning from the code.

## What the prototype settled

| # | Question | Answer, from the prototype | Effect on the build |
|---|---|---|---|
| **D1** | Backend stack | Not stated; TypeScript chosen so contracts, permissions and feature flags are defined once and imported by both sides | `packages/shared` is imported by the API *and* the web app. A permission string cannot drift. |
| **D3** | Email uniqueness | Staff sign in by email, students by school code + roll number | `UNIQUE (lower(email))` globally for staff; `UNIQUE (tenant_id, lower(username))` for students. Both indexes exist, so relaxing either later needs no migration. |
| **D5** | Student identity | **Username, not email.** “Most students do not have an email address.” | `app_user.email` is nullable. Credential slips are printed and handed out; students change the password at first sign-in. |
| **D9** | Tenant resolution | School code typed at sign-in, not a subdomain | `tenant_domain` still exists, so subdomains remain a data change. The login page brands itself from the school code alone, before anyone authenticates. |
| **D10** | Tenant-authored content | **Yes — teachers write their own material** and order it around the Brolly syllabus | `teacher_material`, `teacher_material_class`, `curriculum_plan`, `curriculum_item`. The Hub feed is one-way by construction: no code path writes to `hub_change` from a tenant. |
| **D7** | Python execution | Students run code and see hidden tests pass or fail | Pyodide in the browser. **Source rules are re-checked server-side**; output matching is not. Recorded as the standing limitation. |

## What the prototype added that the architecture had not modelled

| Concept | Why it matters | Where it lives |
|---|---|---|
| **Licence and seats** | The commercial control. A school is blocked, not warned, at the cap. | `licence`; `assertSeatsAvailable()`; the import endpoint refuses the whole batch |
| **Practice vs graded labs** | Practice is unlimited and never marked; a graded lab goes in the practical file and is graded once | `practice_lab` / `practice_attempt` vs `graded_lab` / `lab_submission` |
| **The practical file** | 15 programs are a CBSE board requirement, not a nice-to-have | `graded_lab.program_no`; `/student/practical-file` unlocks the PDF at 15 approved |
| **Uploaded lab work** | Half the work happens on a school lab machine, not in the app | `lab_submission.mode` — both kinds carry the same marks and the same rubric |
| **Content Hub as a separate system** | The Hub is a different product; this app *pulls* from it | `hub_change` + `hub_sync_state` with a cursor, and a visible sync panel |
| **Rubric shown before starting** | No hidden goalposts | `graded_lab.rubric`, returned to the student on the lab screen |
| **Announcements, not messaging** | A one-way class post is safe by design; there is no private teacher-to-student channel a parent cannot see | `announcement`, class-scoped, no reply path |
| **Parents share the student login** | So there is no second account to provision or secure | No parent role; `student_profile.guardian_*` is contact detail only |

## One decision made during the build

**Brolly admin's access is restricted at the database, not the UI.** The
prototype's boundary chip promises “counts and rates, never a student's work”.
Rather than trust the API to honour that, platform scope has *no RLS policy* on
`lab_submission`, `exam_answer`, `exam_question`, `video_note`,
`practice_attempt`, `student_profile`, `announcement` or `teacher_material`. A
future endpoint written carelessly still returns nothing. Eight tests assert it.

The trade-off: a genuine support case ("a student says their submission
vanished") cannot be investigated from the platform console. That is deliberate
— it needs `withPlatformInTenant()`, which drops platform scope, pins the tenant,
and is audited as an impersonation. The capability exists; using it leaves a
trail.

## Still open

Unchanged from [09](./09-roadmap-risks-decisions.md), and none of them block use
of what is built:

- **D2** cloud and CDN — media is metadata-only until this is chosen
- **D7 (part two)** server-side sandbox, if auto-graded scores are to carry weight
- **D8** video protection level
- **D11** data retention periods — needs a business and legal answer
- **D12** column encryption for date of birth and guardian contact
- **D13** SLA, RPO, RTO
- **D14** Google Workspace / LTI single sign-on — schema reserved, not built
- **D15** year-one scale targets — needed to size infrastructure
- **D16** payments, when B2C selling begins

## Phase status

| Phase | Status |
|---|---|
| 1 · Architecture | Done — `docs/architecture/` |
| 2 · Foundation & database | Done — 40 tables, RLS, composite FKs, seeds |
| 3 · Auth, RBAC & isolation | Done — including the abuse suite |
| 4 · Brolly Admin & Content Hub | Done — tenants, licences, content, publishing |
| 5 · Content delivery | Partly — versioning, releases and propagation work; S3 + CDN signing is not wired |
| 6 · B2B | Done — school admin, teacher, student |
| 7 · B2C | Not started. The model supports it (`tenant_type`, `enrollment.source`, feature flags); no self-signup screen exists. |
| 8 · Learning depth | Done — practice, graded labs, exams, badges, practical file |
| 9 · Branding & configuration | Done — colours, names, welcome message, feature-gated navigation |
| 10 · Hardening | Not started — see the pre-launch gate in [07](./07-security-and-audit.md) |
