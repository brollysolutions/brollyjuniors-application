# 04 — Data Model

Conventions used throughout:

- **Primary keys**: `uuid` v7 (time-ordered, so index locality is good and there is no hot-page
  contention from random v4 inserts). Never auto-increment integers — they leak volume and invite
  enumeration.
- **Tenant-owned tables**: `tenant_id uuid NOT NULL`, `PRIMARY KEY (id)` plus
  `UNIQUE (tenant_id, id)` so children can use composite FKs (02 §2.5, layer 4).
- **Every table**: `created_at`, `updated_at` (`timestamptz`), and `created_by`/`updated_by` where
  a human acts.
- **Soft delete**: `deleted_at timestamptz NULL` on user-facing entities; partial indexes exclude
  deleted rows. Hard delete only for GDPR/DPDP erasure and tenant purge.
- **Enums**: Postgres native enums for closed sets that rarely change (`tenant_status`), lookup
  tables where tenants may extend.
- **Money**: not in v1; when it arrives, integer minor units + ISO currency code, never float.

---

## 4.1 ER diagram — Tenancy, identity & access

```mermaid
erDiagram
    TENANT ||--o{ TENANT_DOMAIN : "resolves from"
    TENANT ||--|| TENANT_BRANDING : has
    TENANT ||--o{ TENANT_SETTING : has
    TENANT ||--o{ TENANT_FEATURE : toggles
    TENANT ||--o{ TENANT_ENTITLEMENT : "is granted"
    TENANT ||--o{ USER : contains
    TENANT ||--o{ ROLE : "may define custom"
    TENANT ||--o{ AUDIT_LOG : records

    USER ||--o{ USER_ROLE : has
    ROLE ||--o{ USER_ROLE : "granted via"
    ROLE ||--o{ ROLE_PERMISSION : bundles
    PERMISSION ||--o{ ROLE_PERMISSION : "included in"

    USER ||--o| STUDENT_PROFILE : "may have"
    USER ||--o| TEACHER_PROFILE : "may have"
    USER ||--o{ SESSION : owns

    TENANT {
        uuid id PK
        text slug UK
        text name
        enum tenant_type "B2B | B2C | INTERNAL"
        enum status "provisioning|active|suspended|archived"
        bool is_platform
        text timezone
        text locale
        jsonb contact
        text shard_key "future"
    }
    TENANT_DOMAIN {
        uuid id PK
        uuid tenant_id FK
        text hostname UK
        bool is_primary
        enum verification_status
    }
    TENANT_BRANDING {
        uuid tenant_id PK_FK
        text display_name
        text logo_media_id FK
        text favicon_media_id FK
        text primary_color
        text secondary_color
        text welcome_message
        jsonb theme_tokens
    }
    TENANT_FEATURE {
        uuid tenant_id PK_FK
        text feature_key PK
        bool enabled
        jsonb config
    }
    USER {
        uuid id PK
        uuid tenant_id FK
        citext email
        text username "unique per tenant"
        text password_hash
        text full_name
        enum status "invited|active|disabled"
        int perm_version
        bool mfa_enabled
        timestamptz last_login_at
    }
    ROLE {
        uuid id PK
        uuid tenant_id FK "NULL = system template"
        text key
        text name
        int level "for escalation guard"
        bool is_system
    }
    PERMISSION {
        text key PK "domain:action:scope"
        text description
        text feature_key FK "governing feature"
    }
    USER_ROLE {
        uuid tenant_id PK_FK
        uuid user_id PK_FK
        uuid role_id PK_FK
        timestamptz granted_at
        uuid granted_by
    }
    STUDENT_PROFILE {
        uuid tenant_id FK
        uuid user_id PK_FK
        text grade_level
        date date_of_birth
        jsonb guardian_contact
        enum consent_status
    }
    TEACHER_PROFILE {
        uuid tenant_id FK
        uuid user_id PK_FK
        text employee_code
        text[] subjects
    }
```

---

## 4.2 ER diagram — Platform curriculum & Content Hub

**No `tenant_id` appears anywhere in this section.** That is the whole point.

```mermaid
erDiagram
    SUBJECT ||--o{ COURSE : groups
    COURSE ||--o{ MODULE : contains
    MODULE ||--o{ LESSON : contains
    LESSON ||--o{ TOPIC : contains
    LESSON ||--o{ EXERCISE : has
    LESSON ||--o{ QUIZ : has
    QUIZ ||--o{ QUIZ_QUESTION : contains

    COURSE ||--o| TEXTBOOK : "may pair with"
    TEXTBOOK ||--o{ CHAPTER : contains
    CHAPTER ||--o{ SECTION : contains
    SECTION ||--o{ TOPIC : "renders"

    CONTENT_ITEM ||--o{ CONTENT_VERSION : "has versions"
    TOPIC ||--o| CONTENT_ITEM : "body is"
    SECTION ||--o| CONTENT_ITEM : "body is"
    CONTENT_VERSION }o--o{ MEDIA_ASSET : references

    CONTENT_RELEASE ||--o{ CONTENT_RELEASE_ITEM : pins
    CONTENT_VERSION ||--o{ CONTENT_RELEASE_ITEM : "pinned as"
    TEXTBOOK ||--o{ CONTENT_RELEASE : "released as"
    COURSE ||--o{ CONTENT_RELEASE : "released as"

    PLAN ||--o{ PLAN_ENTITLEMENT : grants
    COURSE ||--o{ PLAN_ENTITLEMENT : "granted by"

    SUBJECT {
        uuid id PK
        text key "python | ai | ..."
        text name
    }
    COURSE {
        uuid id PK
        uuid subject_id FK
        text slug UK
        text title
        text level
        int duration_hours
        enum status "draft|published|retired"
    }
    MODULE {
        uuid id PK
        uuid course_id FK
        int position
        text title
    }
    LESSON {
        uuid id PK
        uuid module_id FK
        int position
        text title
        int est_minutes
    }
    TOPIC {
        uuid id PK
        uuid lesson_id FK
        uuid section_id FK "nullable"
        int position
        text title
        uuid content_item_id FK
    }
    TEXTBOOK {
        uuid id PK
        uuid course_id FK
        text slug UK
        text title
        text edition
        text locale
    }
    CHAPTER {
        uuid id PK
        uuid textbook_id FK
        int position
        text title
    }
    SECTION {
        uuid id PK
        uuid chapter_id FK
        int position
        text title
        uuid content_item_id FK
    }
    CONTENT_ITEM {
        uuid id PK
        text key UK
        enum content_type "lesson|section|topic|exercise|quiz|asset_group"
        uuid current_published_version_id FK
        uuid draft_version_id FK
    }
    CONTENT_VERSION {
        uuid id PK
        uuid content_item_id FK
        int version_no
        text locale
        enum status "draft|in_review|approved|published|archived"
        jsonb body "block document"
        text body_hash
        uuid created_by
        timestamptz published_at
        text changelog
    }
    MEDIA_ASSET {
        uuid id PK
        text sha256 UK
        text storage_key "content-addressed"
        enum kind "image|video|pdf|audio|code|font"
        text mime_type
        bigint bytes
        int width
        int height
        int duration_ms
        enum visibility "public|protected"
        jsonb derivatives
        uuid uploaded_by
    }
    CONTENT_RELEASE {
        uuid id PK
        enum scope "textbook|course"
        uuid scope_id
        int release_no
        enum status "building|published|superseded|rolled_back"
        text manifest_key "immutable object key"
        text manifest_etag
        timestamptz published_at
        uuid published_by
    }
    CONTENT_RELEASE_ITEM {
        uuid release_id PK_FK
        uuid content_item_id PK_FK
        uuid content_version_id FK
    }
    PLAN {
        uuid id PK
        text key
        text name
    }
    PLAN_ENTITLEMENT {
        uuid plan_id PK_FK
        enum resource_type "course|textbook|subject"
        uuid resource_id PK
    }
```

### Why `content_item` sits between the structure and the body

`chapter → section` is *structure*; it changes rarely and everyone agrees on it. The *body* of a
section changes constantly and must be versioned. Separating them means:

- versioning logic exists once, for one table, instead of once per content-bearing entity;
- a release can pin "section X at version 7" without duplicating the structural tree;
- a future entity that needs versioned prose (a course intro, a glossary) reuses the same machinery.

---

## 4.3 ER diagram — Tenant learning: classes, enrolment, assessment, progress

Every table here carries `tenant_id` (omitted from the boxes for readability, present in all).

```mermaid
erDiagram
    TENANT ||--o{ ACADEMIC_YEAR : has
    ACADEMIC_YEAR ||--o{ CLASS : contains
    CLASS ||--o{ CLASS_TEACHER : "taught by"
    CLASS ||--o{ CLASS_STUDENT : enrols
    USER ||--o{ CLASS_TEACHER : teaches
    USER ||--o{ CLASS_STUDENT : "member of"

    CLASS ||--o{ COURSE_ASSIGNMENT : "is assigned"
    COURSE_ASSIGNMENT }o--|| COURSE : references
    COURSE_ASSIGNMENT ||--o{ ENROLLMENT : "materialises"
    USER ||--o{ ENROLLMENT : has
    ENROLLMENT ||--o{ PROGRESS : tracks

    CLASS ||--o{ ASSIGNMENT : "receives"
    ASSIGNMENT ||--o{ ASSIGNMENT_TARGET : "targets"
    ASSIGNMENT ||--o{ SUBMISSION : collects
    USER ||--o{ SUBMISSION : submits

    QUIZ ||--o{ QUIZ_ATTEMPT : "attempted in"
    USER ||--o{ QUIZ_ATTEMPT : takes
    QUIZ_ATTEMPT ||--o{ QUIZ_ANSWER : contains

    USER ||--o{ ACHIEVEMENT : earns
    ENROLLMENT ||--o| CERTIFICATE : "may yield"

    TENANT ||--o{ TENANT_ENTITLEMENT : holds

    ACADEMIC_YEAR {
        uuid id PK
        text name "2026-27"
        date starts_on
        date ends_on
        bool is_current
    }
    CLASS {
        uuid id PK
        uuid academic_year_id FK
        text name "Grade 7 - B"
        text grade_level
        text section_label
        enum status
    }
    CLASS_TEACHER {
        uuid class_id PK_FK
        uuid user_id PK_FK
        enum role_in_class "lead|assistant"
    }
    CLASS_STUDENT {
        uuid class_id PK_FK
        uuid user_id PK_FK
        timestamptz joined_at
        timestamptz left_at
    }
    COURSE_ASSIGNMENT {
        uuid id PK
        uuid course_id FK "platform course"
        uuid class_id FK "nullable - null = whole tenant"
        uuid assigned_by
        date starts_on
        date ends_on
    }
    ENROLLMENT {
        uuid id PK
        uuid user_id FK
        uuid course_id FK
        uuid source_id "course_assignment or purchase"
        enum source "class|admin|self_purchase|trial"
        enum status "active|completed|expired|revoked"
        timestamptz enrolled_at
        timestamptz completed_at
    }
    PROGRESS {
        uuid id PK
        uuid enrollment_id FK
        uuid user_id FK
        enum node_type "course|module|lesson|topic|exercise"
        uuid node_id
        enum status "not_started|in_progress|completed"
        numeric percent
        int time_spent_seconds
        int attempts
        numeric score
        timestamptz last_activity_at
    }
    ASSIGNMENT {
        uuid id PK
        uuid class_id FK
        uuid created_by FK
        text title
        jsonb instructions
        uuid source_exercise_id "nullable platform ref"
        timestamptz due_at
        numeric max_score
        enum status "draft|published|closed"
    }
    ASSIGNMENT_TARGET {
        uuid assignment_id PK_FK
        uuid user_id PK_FK
    }
    SUBMISSION {
        uuid id PK
        uuid assignment_id FK
        uuid user_id FK
        int attempt_no
        jsonb payload "code, text, media refs"
        enum status "draft|submitted|graded|returned"
        numeric score
        text feedback
        uuid graded_by
        timestamptz submitted_at
        timestamptz graded_at
    }
    QUIZ_ATTEMPT {
        uuid id PK
        uuid quiz_id FK "platform quiz"
        uuid user_id FK
        int attempt_no
        numeric score
        numeric max_score
        enum status "in_progress|submitted|graded"
        timestamptz started_at
        timestamptz submitted_at
    }
    QUIZ_ANSWER {
        uuid id PK
        uuid attempt_id FK
        uuid question_id FK
        jsonb response
        bool is_correct
        numeric points
    }
    ACHIEVEMENT {
        uuid id PK
        uuid user_id FK
        text badge_key
        jsonb context
        timestamptz earned_at
    }
    CERTIFICATE {
        uuid id PK
        uuid enrollment_id FK
        uuid user_id FK
        text serial UK
        text verification_code UK
        uuid pdf_media_id
        timestamptz issued_at
    }
    TENANT_ENTITLEMENT {
        uuid id PK
        enum resource_type "course|textbook|subject"
        uuid resource_id
        enum source "plan|manual|trial|purchase"
        uuid plan_id FK
        timestamptz valid_from
        timestamptz valid_until
        int seat_limit
        enum status
    }
    AUDIT_LOG {
        uuid id PK
        uuid tenant_id
        uuid actor_user_id
        text actor_scope
        text action
        text entity_type
        uuid entity_id
        jsonb before_redacted
        jsonb after_redacted
        inet ip
        text user_agent
        uuid request_id
        timestamptz occurred_at
    }
```

### Notes on the modelling choices that matter

**`enrollment` is the single junction for B2B and B2C.** A B2B student is enrolled because their
class was assigned a course (`source = 'class'`); a B2C student is enrolled because they bought or
started one (`source = 'self_purchase'`). Everything downstream — progress, certificates,
reporting, the entire learning UI — reads `enrollment` and does not know or care which. That is
what "same learning engine for B2B and B2C" means concretely.

**`course_assignment` vs `enrollment`.** The assignment is the *intent* ("Grade 7B does Python
Basics this term"); the enrolment is the *fact* per student. Keeping both means a student who joins
the class mid-term is enrolled correctly by replaying the assignment, and a student who leaves
keeps their history.

**`progress` is polymorphic over `node_type`/`node_id`** rather than one table per level. The
alternative — `course_progress`, `module_progress`, `lesson_progress` — triples the write paths and
the reporting queries. The trade-off is no FK on `node_id`; acceptable because the node ids are
platform-owned and immutable, and integrity is checked on write.

**`assignment` references a platform `exercise` optionally.** A teacher can assign "Exercise 4.2
from the master curriculum" or write their own. Same table either way.

**`quiz_attempt` has no `enrollment_id`.** A quiz can be taken outside a course context (practice).
It carries `tenant_id` and `user_id`, which is enough.

---

## 4.4 Indexing plan

The rule for a shared-schema multi-tenant database: **`tenant_id` is the leading column of nearly
every index**, because nearly every query filters on it and the planner should never scan another
tenant's pages.

| Table | Index |
|---|---|
| `user` | `(tenant_id, lower(email))` UNIQUE; `(lower(email))` UNIQUE global — see D3; `(tenant_id, status)` |
| `user_role` | PK `(tenant_id, user_id, role_id)`; `(tenant_id, role_id)` |
| `class` | `(tenant_id, academic_year_id)`; `(tenant_id, status)` |
| `class_student` | PK `(tenant_id, class_id, user_id)`; `(tenant_id, user_id)` for "my classes" |
| `enrollment` | `(tenant_id, user_id, status)`; `(tenant_id, course_id)`; UNIQUE `(tenant_id, user_id, course_id)` where `deleted_at IS NULL` |
| `progress` | `(tenant_id, user_id, node_type, node_id)` UNIQUE; `(tenant_id, enrollment_id)`; BRIN on `last_activity_at` |
| `submission` | `(tenant_id, assignment_id, user_id, attempt_no)` UNIQUE; `(tenant_id, user_id)`; `(tenant_id, status)` partial on `submitted` |
| `quiz_attempt` | `(tenant_id, user_id, quiz_id, attempt_no)` UNIQUE |
| `audit_log` | `(tenant_id, occurred_at DESC)`; `(tenant_id, entity_type, entity_id)`; **partitioned monthly** |
| `tenant_entitlement` | `(tenant_id, resource_type, resource_id)`; partial index on `status='active'` |
| `content_version` | `(content_item_id, version_no)` UNIQUE; partial UNIQUE on `status='published'` per `(content_item_id, locale)` |
| `content_release` | `(scope, scope_id, release_no)` UNIQUE; partial UNIQUE on `status='published'` per `(scope, scope_id)` |
| `media_asset` | `(sha256)` UNIQUE |
| `tenant_domain` | `(hostname)` UNIQUE |

`progress`, `submission` and `audit_log` are the tables that will grow without bound. `audit_log`
is partitioned by month from day 1 (cheap now, painful to retrofit). `progress` gets partitioning
by `tenant_id` hash only if and when volume demands it — noted, not built.

## 4.5 Constraints worth calling out

- Partial unique index guaranteeing **at most one published version per `(content_item, locale)`**
  and **at most one published release per `(scope, scope_id)`** — this is what makes "the current
  version" a database fact rather than an application convention.
- `CHECK (tenant_id IS NOT NULL)` on every tenant table; a migration test asserts that every table
  outside an allow-list of platform tables has a `tenant_id` column *and* an RLS policy. This test
  is the guard against someone adding a table and forgetting.
- Composite FKs as described in 02 §2.5 on every tenant-owned relationship.
- `class_student.left_at IS NULL OR left_at >= joined_at`; `assignment.due_at > created_at`;
  `submission.score <= assignment.max_score`.

## 4.6 Migrations

- Prisma Migrate for schema; hand-written SQL migrations for RLS policies, partial indexes,
  composite FKs and partitions (Prisma cannot express these).
- Every migration is forward-only and additive in production: add column → backfill → switch reads
  → drop old. No destructive migration ships in the same release as the code that stops using it.
- Seed data: permissions, system role templates, feature registry, the platform tenant, and the
  `Brolly Direct` B2C tenant. Seeds are idempotent and run in every environment.
