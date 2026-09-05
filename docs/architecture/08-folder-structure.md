# 08 — Project Folder Structure

A monorepo, because "one core application" has to be structurally true, not just an intention.
Shared logic lives in `packages/` and is *imported* by every app, so there is no place for a B2B
copy and a B2C copy to drift apart.

```
brolly-juniors/
├── apps/
│   ├── api/                        # NestJS — tenant API + platform API + content delivery
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── guards/         # TenantResolution, Auth, Permission, Feature
│   │   │   │   ├── interceptors/   # Audit, Transaction+SET LOCAL, Logging, Idempotency
│   │   │   │   ├── decorators/     # @RequirePermission @RequireFeature @Public @CurrentUser
│   │   │   │   ├── filters/        # problem+json exception filter
│   │   │   │   └── pipes/          # Zod validation pipe
│   │   │   ├── modules/
│   │   │   │   ├── auth/           # login, mfa, tokens, sessions, password
│   │   │   │   ├── tenancy/        # tenant resolution, config, branding, features
│   │   │   │   ├── users/          # users, profiles, bulk import
│   │   │   │   ├── rbac/           # roles, permissions, assignment rules
│   │   │   │   ├── academics/      # academic years, classes, memberships
│   │   │   │   ├── catalog/        # platform courses/modules/lessons/topics (read)
│   │   │   │   ├── enrollment/     # course assignment -> enrollment materialisation
│   │   │   │   ├── assessment/     # assignments, submissions, quizzes, grading
│   │   │   │   ├── progress/       # progress events, aggregation, achievements
│   │   │   │   ├── certificates/
│   │   │   │   ├── reports/
│   │   │   │   ├── content-hub/    # AUTHORING: items, versions, review, releases
│   │   │   │   ├── content-delivery/  # READ: pointer, manifest, signing, entitlement
│   │   │   │   ├── media/          # upload urls, finalise, derivatives, signing
│   │   │   │   ├── entitlements/
│   │   │   │   ├── audit/
│   │   │   │   └── platform/       # Brolly Admin controllers over the modules above
│   │   │   └── config/
│   │   └── test/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── tenant-isolation/   # the abuse suite (07 §7.6) — never delete
│   │
│   ├── worker/                     # BullMQ processors
│   │   └── src/jobs/
│   │       ├── media-derivatives/  # image sizes, HLS, poster frames, page counts
│   │       ├── content-publish/    # manifest build + pointer flip
│   │       ├── bulk-import/        # CSV users
│   │       ├── reports/
│   │       ├── notifications/      # email/SMS adapters (future)
│   │       └── retention/          # audit archival, data retention sweeps
│   │
│   └── web/                        # Next.js 15 — every role, one app
│       ├── src/app/
│       │   ├── (public)/           # login, forgot-password, verify-certificate
│       │   ├── (app)/              # authenticated shell
│       │   │   ├── layout.tsx      # TenantProvider + branding CSS vars (server)
│       │   │   ├── dashboard/  courses/  textbooks/  assignments/
│       │   │   ├── quizzes/    progress/ classes/    people/
│       │   │   └── reports/    settings/
│       │   └── (platform)/         # Brolly Admin console
│       │       ├── tenants/ content-hub/ releases/ media/ analytics/ audit/
│       ├── src/components/
│       │   ├── dashboards/         # StudentDashboard, TeacherDashboard, ...
│       │   ├── learning/           # CoursePage, LessonPage, QuizPage, AssignmentPage
│       │   ├── reader/             # TextbookReader + block registry
│       │   ├── auth/               # Can, Feature, RequireRole
│       │   └── branding/           # Brand.Name, Brand.Logo, ThemeProvider
│       ├── src/lib/                # generated API client, query keys, hooks
│       └── e2e/                    # Playwright, one spec per role
│
├── packages/
│   ├── db/                         # THE schema — single source of truth
│   │   ├── prisma/schema.prisma
│   │   ├── migrations/
│   │   ├── sql/                    # RLS policies, composite FKs, partial indexes, partitions
│   │   ├── seed/                   # permissions, role templates, features, platform tenant
│   │   └── src/                    # client factory + tenant-scoping extension
│   ├── contracts/                  # Zod DTOs -> OpenAPI -> generated client. Shared FE/BE.
│   ├── auth/                       # token utils, permission keys, policy functions
│   ├── tenancy/                    # TenantContext (AsyncLocalStorage), resolver, types
│   ├── content-kit/                # block schema, validators, renderer components, migrators
│   ├── ui/                         # design system; token-driven, never hard-codes a brand
│   ├── config/                     # feature registry, dashboard compositions, env schema (Zod)
│   ├── observability/              # logger, tracing, metric helpers (tenant-tagged)
│   └── testing/                    # factories, two-tenant fixture, abuse-suite helpers
│
├── infra/
│   ├── terraform/                  # vpc, rds, redis, s3, cloudfront, ecs, kms, waf
│   ├── docker/
│   └── scripts/
│
├── docs/
│   ├── architecture/               # these documents
│   ├── adr/                        # one file per accepted decision (D1..Dn become ADRs)
│   └── runbooks/                   # publish rollback, key rotation, tenant suspend, restore
│
├── .github/workflows/              # lint, typecheck, test, abuse-suite, migrate, deploy
├── turbo.json
├── pnpm-workspace.yaml
└── CLAUDE.md                       # conventions for future contributors (incl. AI assistants)
```

## Boundaries worth defending in review

- **`packages/db` is the only place a Prisma client is constructed.** Everything else receives a
  tenant-scoped client. This is what makes the isolation extension unbypassable.
- **`content-hub` and `content-delivery` never import each other.** They share `packages/db` and
  `packages/content-kit` and nothing else. That is the separation from 05 §5.1, expressed in code.
- **`packages/ui` may not import `packages/config` or anything tenant-aware.** Components take
  props; the app decides. It is the reason the design system stays reusable and cannot grow a
  hidden `if (b2b)`.
- **`apps/web` never imports `packages/db`.** No ORM in the browser bundle, ever.
- **`test/tenant-isolation` runs in CI on every PR**, not nightly. It is the difference between
  a control and a hope.
