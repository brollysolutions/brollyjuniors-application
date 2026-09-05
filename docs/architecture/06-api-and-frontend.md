# 06 — API & Frontend Architecture

## 6.1 Three API surfaces, three trust levels

| Surface | Base path | Token scope | Purpose |
|---|---|---|---|
| **Public** | `/api/v1/public/*` | none | Branding by host, health, certificate verification. Everything here is safe to serve unauthenticated and is rate-limited hard. |
| **Tenant** | `/api/v1/*` | `scope=tenant` | Everything a School Admin, Teacher or Student does. Tenant comes from the token; **it never appears in a path**. |
| **Platform** | `/api/v1/platform/*` | `scope=platform` | Brolly Admin: tenants, curriculum, Content Hub, releases, entitlements, cross-tenant analytics. Requires MFA and step-up for destructive actions. |

The tenant surface deliberately has **no `/tenants/{id}/…` prefix**. If the tenant id is in the
URL, someone will eventually trust it. The only place tenant ids appear in paths is the platform
surface, where cross-tenant access is the actual job.

## 6.2 Endpoint map

```
PUBLIC
  GET    /public/branding                      resolve by Host header
  GET    /public/certificates/{code}/verify
  GET    /health, /ready

AUTH
  POST   /auth/login            /auth/mfa/verify      /auth/refresh
  POST   /auth/logout           /auth/forgot-password /auth/reset-password
  POST   /auth/change-password
  GET    /auth/sessions         DELETE /auth/sessions/{id}

IDENTITY
  GET    /me                    GET /me/bootstrap     PATCH /me
  GET    /me/permissions        GET /me/features

TENANT ADMINISTRATION  (School Admin)
  GET    PATCH /tenant                       profile
  GET    PATCH /tenant/branding
  GET    PATCH /tenant/settings
  GET          /tenant/features              read-only to the tenant
  CRUD         /users                        ?role=teacher|student
  POST         /users/bulk-import            CSV, async job
  GET    POST DELETE /users/{id}/roles

ACADEMIC STRUCTURE
  CRUD   /academic-years
  CRUD   /classes
  GET POST DELETE /classes/{id}/teachers
  GET POST DELETE /classes/{id}/students
  GET POST DELETE /classes/{id}/courses      course_assignment

LEARNING
  GET    /courses                            entitled courses only
  GET    /courses/{id}                       structure, no bodies
  GET    /enrollments                        scope-filtered
  POST   /enrollments
  GET    /progress?userId=&courseId=         scope-enforced
  POST   /progress/events                    idempotent, batched
  CRUD   /assignments
  POST   /assignments/{id}/publish
  GET    /assignments/{id}/submissions
  POST   /assignments/{id}/submissions
  POST   /submissions/{id}/grade
  POST   /quizzes/{id}/attempts
  PATCH  /quiz-attempts/{id}                 answers, submit
  GET    /achievements  /certificates

CONTENT DELIVERY  (read-only, entitlement-checked)
  GET    /content/textbooks                          entitled
  GET    /content/textbooks/{id}/current             the pointer  <-- the only short-TTL response
  GET    /content/releases/{releaseId}/manifest      signed asset URLs
  GET    /content/versions/{id}/body                 or straight from CDN
  GET    /content/media/{id}/url                     single signed URL

REPORTS
  GET    /reports/class/{id}/progress
  GET    /reports/tenant/overview
  GET    /reports/student/{id}

PLATFORM  (Brolly Admin)
  CRUD   /platform/tenants                   + /suspend /activate /archive
  CRUD   /platform/tenants/{id}/entitlements
  PATCH  /platform/tenants/{id}/features
  CRUD   /platform/users                     cross-tenant
  CRUD   /platform/roles  /platform/permissions
  CRUD   /platform/subjects /courses /modules /lessons /topics
  CRUD   /platform/textbooks /chapters /sections
  CRUD   /platform/content-items
  POST   /platform/content-items/{id}/versions
  POST   /platform/content-versions/{id}/submit|approve|reject
  GET    /platform/content-versions/{id}/preview
  POST   /platform/releases                  publish
  POST   /platform/releases/{id}/rollback
  GET    /platform/releases?scope=&scopeId=
  POST   /platform/media/upload-url          pre-signed PUT
  POST   /platform/media/finalise
  GET    /platform/analytics/overview
  GET    /platform/audit-logs
  POST   /platform/impersonate/{userId}      audited, short-lived token
```

## 6.3 API conventions

- **Versioned** at `/api/v1`. Breaking changes get `/v2`; additive changes do not.
- **Pagination**: cursor-based (`?cursor=&limit=`), never `OFFSET` — offset pagination degrades and
  double-serves rows under concurrent writes.
- **Errors**: RFC 9457 `application/problem+json`, with a stable machine `code`, a human `detail`,
  and `traceId`.
- **404 over 403 for cross-tenant reads.** A request for another tenant's resource id returns 404,
  not 403 — a 403 confirms the row exists. Within your own tenant, 403 is correct and more useful.
- **Idempotency**: `Idempotency-Key` header required on `POST` for enrolments, submissions, grading
  and publishing. Stored 24 h.
- **Rate limits**: per `(tenant, user, route-class)` in Redis. Auth routes are much tighter, and
  manifest issuance is limited to blunt signed-URL harvesting.
- **Validation**: one Zod schema per DTO, in `packages/contracts`, used by the API for runtime
  validation *and* by the web app for types and form validation. One definition, no drift.
- **OpenAPI** generated from those schemas; the client SDK is generated from the OpenAPI. Nobody
  hand-writes a fetch call.
- **No mass assignment**: DTOs are allow-lists; `tenant_id`, `role`, `status` and `score` are never
  bindable from a request body.

## 6.4 Frontend architecture

**One Next.js application** serves every role and both business models. There is no B2B app and no
B2C app; there is one app whose shell is computed from tenant + role + permissions + features.

```
apps/web/src/app/
  (public)/            login, forgot-password, verify-certificate
  (app)/               authenticated shell: nav, branding provider, guards
    dashboard/         renders the role's dashboard composition
    courses/           [courseId]/ modules/ lessons/[lessonId]
    textbooks/         [textbookId]/[chapterId]/[sectionId]   <- reader
    assignments/       [id], submissions
    quizzes/           [id]/attempt
    progress/
    classes/           [id]  (teacher + school admin)
    people/            teachers, students  (school admin)
    reports/
    settings/          profile; branding + features for school admin
  (platform)/          Brolly Admin console
    tenants/ content-hub/ releases/ media/ analytics/ audit/
```

### The shell is data, not code

`/me/bootstrap` returns `{ user, tenant, branding, roles, permissions, features, navigation }`.
Navigation is **computed on the server** from permissions and features, so the client never renders
a link the user cannot use and never ships the full nav tree of every role.

```tsx
// The only three primitives that express role/tenant difference in the UI.
<Can permission="class:create">        <CreateClassButton /> </Can>
<Feature flag="school_management">     <SchoolNav />         </Feature>
<Brand.Name />                         {/* never a literal school name */}
```

### Branding without a rebuild

The root layout is a server component. It resolves the tenant from the host, fetches branding
(Redis-cached), and emits CSS custom properties:

```tsx
<html data-tenant={tenant.slug}>
  <head><style>{`:root{
      --brand-primary:${b.primaryColor};
      --brand-secondary:${b.secondaryColor};
      --brand-radius:${b.theme.radius};
  }`}</style></head>
```

Every component styles from those tokens. Result: a new tenant's look is a database row. Colour
values are validated and normalised server-side before interpolation (a hex/OKLCH allow-list) so a
branding field can never inject CSS.

Logos, favicon and welcome message come from the same payload; `next/image` serves the logo from
the public CDN prefix.

### Reusable, role-agnostic components

`StudentDashboard`, `TeacherDashboard`, `CoursePage`, `LessonPage`, `TextbookReader`, `QuizPage`,
`AssignmentPage`, `ProgressPage` are written once. Where a role sees more, it is because a `<Can>`
revealed a section, not because a second component exists.

The dashboards are compositions defined by data:

```ts
// packages/config/dashboards.ts — not a switch statement in a component
STUDENT: ['continue-learning','my-courses','due-assignments','progress-ring','achievements']
TEACHER: ['my-classes','needs-grading','class-progress','recent-activity']
```

A tenant that wants a different dashboard gets a different array, eventually from `tenant_setting`.

### The TextbookReader

The one component that most directly embodies §24:

1. `GET /content/textbooks/{id}/current` → `{releaseNo, manifestUrl}` (60 s TTL, ETag)
2. Fetch the manifest from the CDN (immutable, cached forever)
3. Render the table of contents; lazily fetch section bodies as the reader navigates
4. Render blocks through a **block registry** — `{ heading, paragraph, code, image, video, callout,
   exercise, quiz }` — with an unknown-type fallback
5. Report progress via batched, idempotent `POST /progress/events`

No textbook text exists anywhere in the source tree. Adding a new *kind* of block is the only
content change that ever needs a deploy, and unknown blocks degrade gracefully until it ships.

### Python execution

Runnable code blocks execute in **Pyodide in a Web Worker** — sandboxed by the browser, zero server
cost, no untrusted code on our infrastructure, works offline. Graded auto-assessment that must be
tamper-proof needs a server-side sandbox; see **D7**.

## 6.5 State and data fetching

- Server components for everything that can be rendered on the server (shell, branding, static
  structure). No tenant registry, no permission table and no other tenant's data ever reaches the
  client bundle.
- TanStack Query for client interactions, with query keys prefixed by `tenantId` so a session
  switch can never serve another tenant's cached data.
- Optimistic updates for progress and quiz answers; a durable retry queue so a dropped connection
  in a school computer lab does not lose a submission.

## 6.6 Accessibility and performance targets

WCAG 2.1 AA (children's product, school procurement often requires it): keyboard-navigable reader,
visible focus, 4.5:1 contrast enforced by validating tenant brand colours at save time against the
surfaces they are used on, `prefers-reduced-motion` respected, captions required on video (enforced
at authoring, 5.3). Budgets: LCP < 2.5 s on a mid-range Android over 4G; initial JS < 200 KB gzip;
the reader must work on a 5-year-old school laptop.

## 6.7 How B2B/B2C conditionals are avoided — the rule

There is exactly one place in the codebase allowed to read `tenant.tenant_type`: the seeding /
provisioning service that chooses **default** feature flags and role sets for a new tenant. After
provisioning, nothing reads it for behaviour.

```ts
// packages/config/features.ts — the single registry
export const FEATURES = {
  school_management: { default: { B2B: true,  B2C: false } },
  class_management:  { default: { B2B: true,  B2C: false } },
  teacher_management:{ default: { B2B: true,  B2C: true  } },
  textbook_access:   { default: { B2B: true,  B2C: true  } },
  course_enrollment: { default: { B2B: true,  B2C: true  } },
  course_purchase:   { default: { B2B: false, B2C: true  } },
  reports:           { default: { B2B: true,  B2C: false } },
  certificates:      { default: { B2B: true,  B2C: true  } },
} as const
```

Everywhere else — API guards, navigation, UI — asks `featureEnabled(tenant, 'class_management')`.
The consequence is that a B2B school that wants to buy extra courses directly is a **flag change**,
not a code change, and the B2B/B2C distinction never calcifies into two divergent code paths. A
lint rule bans `tenant_type` / `tenantType` outside the provisioning module.
