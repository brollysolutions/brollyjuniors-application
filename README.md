# Brolly Juniors

A multi-tenant Python & AI platform for schools. One application, four logins,
five schools sharing one master curriculum — and no school able to see past its
own line.

Built from [`brolly-app-endtoend-prototype.html`](./brolly-app-endtoend-prototype.html)
on the architecture in [`docs/architecture/`](./docs/architecture/README.md).

---

## Run it

```bash
npm install
npm run db:reset     # creates the database and seeds 5 schools, 694 students
npm run dev          # API on :4000, web on :5173
```

Then open **http://localhost:5173** and sign in as any of the four roles — the
login page has a one-click button for each.

| Role | Sign in with | Password |
|---|---|---|
| Brolly admin | `admin@brollysoftware.com` | `brolly` |
| School admin | `principal@vidyavihar.edu.in` | `brolly` |
| Teacher | `sneha.r@vidyavihar.edu.in` | `brolly` |
| Student | school code `VVHS-KUK`, username `9A-04` | `student` |

Other schools to compare against: `SPS-MYP`, `RGS-SEC`, `NV-GCB`, `CHS-NZM`.
Every school admin is `principal@<schoolname>.edu.in` with password `brolly`.

> **No database to install.** The default driver is
> [PGlite](https://pglite.dev) — real PostgreSQL 16 compiled to WebAssembly,
> running in-process and stored in `.data/`. Row-level security, policies and
> composite foreign keys all behave exactly as they would on a server, which is
> what makes the isolation tests meaningful. Point `DB_DRIVER=pg` and
> `DATABASE_URL` at a real Postgres and nothing else changes.
>
> Stop the API before `npm run db:reset` — it holds the database open.

## Test it

```bash
npm test            # 25 tests: row-level security, composite FKs, schema meta-tests
npm run test:e2e    # 45 assertions: the whole 15-step chain through the real API
npm run test:screens # 51 screens: every portal screen's data loads and renders
npm run typecheck
```

`test` runs against the database with no application code in the way, so it
proves the isolation the app *cannot* switch off. `test:e2e` and `test:screens`
need `npm run dev:api` running.

---

## What is here

```
apps/
  api/          Fastify + TypeScript. Auth, RBAC, four portals' worth of endpoints.
  web/          React + Vite. One application; the shell is computed from the login.
packages/
  db/           SQL schema, RLS policies, migrations, seed, dual Postgres driver.
  shared/       Permissions, features and roles — one definition, used by both sides.
tests/          Isolation suite, end-to-end chain, screen coverage.
docs/           The Phase 1 architecture these were built from.
```

### The three claims the code makes good on

**1. One application, one database, `tenant_id` on every tenant-owned row —
enforced four times over.**

| Layer | Where | What it stops |
|---|---|---|
| 1 · Request context | `apps/api/src/guards.ts` | A handler ever choosing its own tenant |
| 2 · Data access | `packages/db/src/client.ts` | A query running outside a tenant transaction |
| 3 · Row-level security | `packages/db/sql/003_rls.sql` | A missing `WHERE` returning another school's rows |
| 4 · Composite foreign keys | `packages/db/sql/001_schema.sql` | *Linking* to another school's row at all |

Layers 3 and 4 hold even if the application tier is compromised, and
`tests/tenant-isolation.test.ts` proves it against the database directly.

Two of those tests are worth more than the rest put together: they fail when
someone **adds a table** without a `tenant_id` or without a policy — which is how
this class of bug actually gets in.

**2. Curriculum is platform-owned and never copied per school.**

Nothing in `subject`, `course`, `unit`, `video`, `material`, `practice_lab`,
`graded_lab`, `question` or `content_version` carries a `tenant_id`. Five schools
read the same rows. A school reaches them through `tenant_entitlement` and a
student through `enrollment` — and `enrollment` is the *single* junction for B2B
and B2C, which is what "one learning engine" means in practice.

The database also refuses to let a school edit them: the write policy on every
curriculum table requires platform scope, so "Brolly content cannot be edited"
is a property of the schema, not a hidden button.

**3. Publishing content is not a deployment.**

`POST /platform/materials/:id/publish` writes a new immutable `content_version`,
archives the old one, pins a new `content_release` and moves one pointer — all in
one transaction, guarded by a partial unique index that permits exactly one
published version per item. The next request from any entitled school reads the
new text. `npm run test:e2e` does this live and checks a student in a *different*
school sees the change.

### And one the architecture did not anticipate

Brolly admin can read counts and rates — and the database gives it **no policy at
all** on `lab_submission`, `exam_answer`, `exam_question`, `video_note`,
`practice_attempt`, `student_profile`, `announcement` or `teacher_material`. So
"Brolly cannot open a student's answer sheet" is not a promise the UI is making;
it is enforced one layer below anything the application can override. Eight tests
assert it.

---

## Notable behaviour

- **Students sign in without an email address.** School code + roll number +
  password. Most 13-year-olds have no email, and requiring one manufactures a
  child-data liability.
- **Seats are a hard block.** A bulk import that would exceed the licence is
  refused whole, not truncated — and previewed before anything is written.
- **Python runs in the browser** (Pyodide). Source rules — "use a loop", "do not
  use `sum()`" — are re-checked on the server, where a student cannot edit them.
  Output matching is trusted from the client; that is decision **D7**, and it is
  why a server-side sandbox is the hardening step before these scores carry
  weight.
- **Exams are gated server-side.** A locked paper's questions are not in any
  response until the start time. Answers autosave to the server, objective
  questions mark themselves out of a snapshot the browser never sees, and results
  stay hidden until a teacher presses release — so nobody sees half a result.
- **The paper is snapshotted at schedule time**, so editing the question bank
  afterwards cannot change a paper students have already sat.
- **A revision does not consume an attempt.** The point is the student fixing it.
- **Deactivate, never delete.** A teacher who leaves keeps their grading history
  attached to the students they taught.
- **Branding is a database row.** Colours are validated server-side against a
  strict hex pattern before they reach a stylesheet, so a branding field cannot
  become CSS injection. Change one in the School profile and the whole app
  follows.
- **Redaction in the audit log is a whitelist**, so a column added tomorrow
  cannot start leaking into it.

## Production notes

Not done here, and deliberately so:

- **scrypt, not Argon2id.** Node ships scrypt, so the app installs with no native
  build step. Swap `packages/db/src/password.ts`; the stored format is versioned
  for a rehash-on-login migration.
- **Media is metadata-only.** `media_asset` and the content-addressed key scheme
  are in place; S3 + CloudFront signed URLs are section 06 of the architecture and
  are not wired up.
- **No Redis.** Tenant config and permission sets are cached in-process for 15
  seconds. Swap `apps/api/src/access.ts` when there is more than one API node.
- **Rate limiting is in-memory**, so it is per-process. Fine for one node.
- The remaining open decisions are in
  [`docs/architecture/09-roadmap-risks-decisions.md`](./docs/architecture/09-roadmap-risks-decisions.md).
