# Brolly Juniors — Phase 1 Architecture

Status: **Draft for review.** No application code is written until this is approved.

## Read in this order

| # | Document | Answers |
|---|---|---|
| 01 | [Overview & Technology Stack](./01-overview-and-stack.md) | What are we building, on what, and why |
| 02 | [Multi-Tenancy & Isolation](./02-multi-tenancy-and-isolation.md) | How tenants are separated; how B2B and B2C share one codebase |
| 03 | [Authentication & RBAC](./03-auth-and-rbac.md) | Login flow, tokens, roles, permissions, feature gating |
| 04 | [Data Model](./04-data-model.md) | ER diagram, tables, keys, indexes, tenant-scoping rules |
| 05 | [Content Hub & Delivery](./05-content-hub-and-delivery.md) | Authoring, versioning, publishing, media, CDN, caching, entitlement |
| 06 | [API & Frontend Architecture](./06-api-and-frontend.md) | API surfaces, contracts, app structure, branding, feature config |
| 07 | [Security & Audit](./07-security-and-audit.md) | Threat model, controls, audit logging |
| 08 | [Project Folder Structure](./08-folder-structure.md) | Monorepo layout |
| 09 | [Roadmap, Risks & Open Decisions](./09-roadmap-risks-decisions.md) | Delivery plan and what needs your sign-off |

## The three sentences that define this architecture

1. **One application, one database, `tenant_id` on every tenant-owned row**, enforced at four independent layers so a single forgotten `WHERE` clause cannot leak data.
2. **Curriculum is platform-owned and never copied per tenant.** Tenants get *entitlements* and *assignments* pointing at one master copy.
3. **Content ships as immutable, versioned data behind a single mutable pointer.** Publishing a textbook edit flips one pointer; no code deploy, no cache-invalidation race.

## Open decisions blocking Phase 2

See [09-roadmap-risks-decisions.md](./09-roadmap-risks-decisions.md). The ones that change the schema (and so must be answered first) are marked **D1–D6** there.
