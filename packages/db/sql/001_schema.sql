-- ===========================================================================
-- Brolly Juniors — schema
--
-- Two halves, and the split is the most important thing in this file:
--   PLATFORM tables have NO tenant_id. One row, shared by every school.
--   TENANT   tables have tenant_id NOT NULL, UNIQUE (tenant_id, id), RLS.
--
-- Every tenant-owned child references its parent by the PAIR (tenant_id, id),
-- so it is structurally impossible to link School A's student to School B's
-- class even with a compromised application tier.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PLATFORM: access control vocabulary
-- ---------------------------------------------------------------------------

CREATE TABLE feature (
  key          text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT ''
);

CREATE TABLE permission (
  key          text PRIMARY KEY,               -- domain:action[:scope]
  description  text NOT NULL DEFAULT '',
  feature_key  text REFERENCES feature(key)    -- the feature that governs it
);

CREATE TABLE role (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid,                           -- NULL = system template
  key          text NOT NULL,
  name         text NOT NULL,
  level        int  NOT NULL DEFAULT 10,       -- higher = more authority
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX role_key_uq ON role (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

CREATE TABLE role_permission (
  role_id        uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permission(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- PLATFORM: the master curriculum. Never copied per tenant.
-- ---------------------------------------------------------------------------

CREATE TABLE subject (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key   text UNIQUE NOT NULL,
  name  text NOT NULL
);

CREATE TABLE course (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   uuid NOT NULL REFERENCES subject(id),
  slug         text UNIQUE NOT NULL,
  title        text NOT NULL,
  level_label  text NOT NULL DEFAULT '',       -- 'Class 9'
  board        text NOT NULL DEFAULT 'CBSE',
  code         text NOT NULL DEFAULT '',       -- '417'
  status       text NOT NULL DEFAULT 'published',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  position     int  NOT NULL,
  code         text NOT NULL,                  -- 'U5'
  title        text NOT NULL,
  hours_label  text NOT NULL DEFAULT '',
  marks        int  NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'published',   -- published | drafting
  UNIQUE (course_id, code)
);

CREATE TABLE media_asset (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256       text UNIQUE NOT NULL,
  storage_key  text NOT NULL,                  -- content-addressed
  kind         text NOT NULL,                  -- image|video|pdf|audio|code
  mime_type    text NOT NULL,
  bytes        bigint NOT NULL DEFAULT 0,
  duration_ms  int,
  visibility   text NOT NULL DEFAULT 'protected',  -- public | protected
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Versioned prose. Structure (unit/chapter) is separate from body, so the
-- versioning machinery exists once rather than once per content-bearing entity.
CREATE TABLE content_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text UNIQUE NOT NULL,
  content_type  text NOT NULL,                 -- material | lesson | section
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id  uuid NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
  version_no       int  NOT NULL,
  locale           text NOT NULL DEFAULT 'en',
  status           text NOT NULL DEFAULT 'draft',  -- draft|in_review|approved|published|archived
  body             jsonb NOT NULL,                 -- block document
  body_hash        text NOT NULL DEFAULT '',
  changelog        text NOT NULL DEFAULT '',
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  UNIQUE (content_item_id, version_no, locale)
);
-- At most one published version per item+locale: "current" is a database fact.
CREATE UNIQUE INDEX content_version_published_uq
  ON content_version (content_item_id, locale) WHERE status = 'published';

CREATE TABLE video (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  position         int  NOT NULL DEFAULT 0,
  title            text NOT NULL,
  duration_seconds int  NOT NULL DEFAULT 0,
  media_asset_id   uuid REFERENCES media_asset(id),
  summary          jsonb NOT NULL DEFAULT '[]'::jsonb   -- "what this covers" bullets
);

CREATE TABLE material (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  position         int  NOT NULL DEFAULT 0,
  title            text NOT NULL,
  kind             text NOT NULL DEFAULT 'Notes',   -- Notes|Worksheet|PDF
  pages            int  NOT NULL DEFAULT 1,
  content_item_id  uuid REFERENCES content_item(id)
);

CREATE TABLE practice_lab (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  position     int  NOT NULL DEFAULT 0,
  title        text NOT NULL,
  level        text NOT NULL DEFAULT 'Easy',        -- Easy|Medium|Hard
  brief        text NOT NULL DEFAULT '',
  starter_code text NOT NULL DEFAULT '',
  hints        jsonb NOT NULL DEFAULT '[]'::jsonb,
  solution     text NOT NULL DEFAULT '',
  test_cases   jsonb NOT NULL DEFAULT '[]'::jsonb   -- [{name, stdin, expect}]
);

CREATE TABLE graded_lab (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  unit_id      uuid REFERENCES unit(id),
  program_no   int  NOT NULL,                       -- 1..15 practical file
  title        text NOT NULL,
  brief        text NOT NULL DEFAULT '',
  mode         text NOT NULL DEFAULT 'either',      -- in_app | uploaded | either
  max_score    int  NOT NULL DEFAULT 10,
  rubric       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{key,label,max}]
  starter_code text NOT NULL DEFAULT '',
  test_cases   jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (course_id, program_no)
);

CREATE TABLE question (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  kind         text NOT NULL,                       -- objective | written
  text         text NOT NULL,
  options      jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_index int,                                 -- objective only
  model_answer text NOT NULL DEFAULT '',
  marks        int  NOT NULL DEFAULT 1,
  topic        text NOT NULL DEFAULT ''
);

CREATE TABLE exam_blueprint (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  title            text NOT NULL,
  duration_minutes int NOT NULL DEFAULT 45,
  objective_marks  int NOT NULL DEFAULT 20,
  written_marks    int NOT NULL DEFAULT 15
);

CREATE TABLE exam_blueprint_question (
  blueprint_id uuid NOT NULL REFERENCES exam_blueprint(id) ON DELETE CASCADE,
  question_id  uuid NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  position     int  NOT NULL,
  PRIMARY KEY (blueprint_id, question_id)
);

-- Atomic publication: a release pins a set of versions; one pointer per scope.
CREATE TABLE content_release (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL,                      -- course | unit
  scope_id      uuid NOT NULL,
  release_no    int  NOT NULL,
  status        text NOT NULL DEFAULT 'building',   -- building|published|superseded|rolled_back
  manifest      jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at  timestamptz,
  published_by  uuid,
  UNIQUE (scope, scope_id, release_no)
);
CREATE UNIQUE INDEX content_release_current_uq
  ON content_release (scope, scope_id) WHERE status = 'published';

-- The simulated Content Hub: an append-only change feed the app pulls with a
-- cursor. Downward only — nothing a teacher writes is ever pushed back up.
CREATE TABLE hub_change (
  seq          bigserial PRIMARY KEY,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  op           text NOT NULL DEFAULT 'upsert',
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub_sync_state (
  id            int PRIMARY KEY DEFAULT 1,
  cursor_seq    bigint NOT NULL DEFAULT 0,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  items_held    int NOT NULL DEFAULT 0,
  failed_runs   int NOT NULL DEFAULT 0,
  CHECK (id = 1)
);

-- ---------------------------------------------------------------------------
-- TENANT: the school itself
-- ---------------------------------------------------------------------------

CREATE TABLE tenant (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_code  text UNIQUE NOT NULL,               -- students type this at login
  name         text NOT NULL,
  area         text NOT NULL DEFAULT '',
  board        text NOT NULL DEFAULT 'CBSE',
  tenant_type  text NOT NULL DEFAULT 'B2B',        -- B2B | B2C | INTERNAL
  status       text NOT NULL DEFAULT 'provisioning',
  is_platform  boolean NOT NULL DEFAULT false,
  timezone     text NOT NULL DEFAULT 'Asia/Kolkata',
  locale       text NOT NULL DEFAULT 'en',
  contact      jsonb NOT NULL DEFAULT '{}'::jsonb,
  joined_on    date NOT NULL DEFAULT current_date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_domain (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  hostname    text UNIQUE NOT NULL,
  is_primary  boolean NOT NULL DEFAULT false
);

CREATE TABLE tenant_branding (
  tenant_id        uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  display_name     text NOT NULL,
  short_name       text NOT NULL DEFAULT '',
  logo_text        text NOT NULL DEFAULT 'B',
  primary_color    text NOT NULL DEFAULT '#FFC93C',
  secondary_color  text NOT NULL DEFAULT '#2B6CB0',
  welcome_message  text NOT NULL DEFAULT '',
  theme            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE tenant_setting (
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE tenant_feature (
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  feature_key  text NOT NULL REFERENCES feature(key),
  enabled      boolean NOT NULL DEFAULT true,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, feature_key)
);

-- The commercial control: a school cannot add a student past its seat cap.
CREATE TABLE licence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  seats        int  NOT NULL DEFAULT 0,
  levels       text NOT NULL DEFAULT '',
  valid_from   date NOT NULL DEFAULT current_date,
  valid_until  date NOT NULL,
  status       text NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE tenant_entitlement (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  resource_type  text NOT NULL,                    -- course | unit
  resource_id    uuid NOT NULL,
  source         text NOT NULL DEFAULT 'licence',  -- licence|manual|trial|purchase
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz,
  status         text NOT NULL DEFAULT 'active',
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, resource_type, resource_id)
);

-- ---------------------------------------------------------------------------
-- TENANT: identity
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email          text,                              -- staff have one; students may not
  username       text,                              -- students: roll number
  password_hash  text NOT NULL,
  full_name      text NOT NULL,
  phone          text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'active',    -- invited|active|disabled
  perm_version   int  NOT NULL DEFAULT 1,           -- bump = revoke live tokens
  mfa_enabled    boolean NOT NULL DEFAULT false,
  must_change_pw boolean NOT NULL DEFAULT false,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX app_user_email_global_uq ON app_user (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX app_user_username_uq ON app_user (tenant_id, lower(username)) WHERE username IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE user_role (
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  role_id     uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid,
  PRIMARY KEY (tenant_id, user_id, role_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE student_profile (
  tenant_id       uuid NOT NULL,
  user_id         uuid NOT NULL,
  roll_no         text NOT NULL,
  grade_level     text NOT NULL DEFAULT '',
  section_label   text NOT NULL DEFAULT '',
  guardian_name   text NOT NULL DEFAULT '',
  guardian_phone  text NOT NULL DEFAULT '',
  consent_status  text NOT NULL DEFAULT 'school_asserted',
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE teacher_profile (
  tenant_id      uuid NOT NULL,
  user_id        uuid NOT NULL,
  employee_code  text NOT NULL DEFAULT '',
  subject        text NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  user_id             uuid NOT NULL,
  refresh_token_hash  text NOT NULL,
  family_id           uuid NOT NULL,
  user_agent          text NOT NULL DEFAULT '',
  ip                  text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  used_at             timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- TENANT: academic structure
-- ---------------------------------------------------------------------------

CREATE TABLE academic_year (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name        text NOT NULL,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id)
);

CREATE TABLE school_class (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  academic_year_id  uuid NOT NULL,
  course_id         uuid NOT NULL REFERENCES course(id),
  name              text NOT NULL,
  grade_level       text NOT NULL DEFAULT '',
  section_label     text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_year(tenant_id, id)
);

CREATE TABLE class_teacher (
  tenant_id     uuid NOT NULL,
  class_id      uuid NOT NULL,
  user_id       uuid NOT NULL,
  role_in_class text NOT NULL DEFAULT 'lead',
  PRIMARY KEY (tenant_id, class_id, user_id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES school_class(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id)  REFERENCES app_user(tenant_id, id)    ON DELETE CASCADE
);

CREATE TABLE class_student (
  tenant_id  uuid NOT NULL,
  class_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  PRIMARY KEY (tenant_id, class_id, user_id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES school_class(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id)  REFERENCES app_user(tenant_id, id)    ON DELETE CASCADE,
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

-- Intent: "9-A does Python this term". Distinct from the per-student fact.
CREATE TABLE course_assignment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  class_id     uuid NOT NULL,
  course_id    uuid NOT NULL REFERENCES course(id),
  assigned_by  uuid,
  starts_on    date,
  ends_on      date,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, class_id, course_id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES school_class(tenant_id, id) ON DELETE CASCADE
);

-- Fact: this student is doing this course. The single junction for B2B and B2C.
CREATE TABLE enrollment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  course_id     uuid NOT NULL REFERENCES course(id),
  class_id      uuid,
  source        text NOT NULL DEFAULT 'class',   -- class|admin|self_purchase|trial
  source_id     uuid,
  status        text NOT NULL DEFAULT 'active',
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id, course_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- TENANT: teaching
-- ---------------------------------------------------------------------------

-- Teacher-authored material. Never leaves the school; never syncs up to the Hub.
CREATE TABLE teacher_material (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL,
  unit_id     uuid REFERENCES unit(id),
  title       text NOT NULL,
  kind        text NOT NULL DEFAULT 'Notes',
  body        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- block document
  status      text NOT NULL DEFAULT 'draft',        -- draft | shared
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE teacher_material_class (
  tenant_id   uuid NOT NULL,
  material_id uuid NOT NULL,
  class_id    uuid NOT NULL,
  PRIMARY KEY (tenant_id, material_id, class_id),
  FOREIGN KEY (tenant_id, material_id) REFERENCES teacher_material(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, class_id)    REFERENCES school_class(tenant_id, id)     ON DELETE CASCADE
);

CREATE TABLE curriculum_plan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL,
  created_by  uuid NOT NULL,
  name        text NOT NULL,
  term        text NOT NULL DEFAULT 'Term 1',
  weeks       int  NOT NULL DEFAULT 12,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES school_class(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE curriculum_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  plan_id        uuid NOT NULL,
  position       int  NOT NULL,
  origin         text NOT NULL DEFAULT 'brolly',   -- brolly | mine
  resource_type  text NOT NULL,                    -- video|material|practice_lab|teacher_material
  resource_id    uuid NOT NULL,
  label          text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES curriculum_plan(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL,
  created_by  uuid NOT NULL,
  title       text NOT NULL,
  due_at      timestamptz,
  status      text NOT NULL DEFAULT 'published',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id)   REFERENCES school_class(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app_user(tenant_id, id)
);

CREATE TABLE assignment_item (
  tenant_id      uuid NOT NULL,
  assignment_id  uuid NOT NULL,
  resource_type  text NOT NULL,   -- video|material|practice_lab|graded_lab|teacher_material
  resource_id    uuid NOT NULL,
  PRIMARY KEY (tenant_id, assignment_id, resource_type, resource_id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES assignment(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE announcement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL,
  created_by  uuid NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES school_class(tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- TENANT: learning records
-- ---------------------------------------------------------------------------

CREATE TABLE progress (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  node_type         text NOT NULL,    -- video|material|practice_lab|unit|course
  node_id           uuid NOT NULL,
  status            text NOT NULL DEFAULT 'in_progress',
  percent           numeric(5,2) NOT NULL DEFAULT 0,
  seconds_spent     int  NOT NULL DEFAULT 0,
  attempts          int  NOT NULL DEFAULT 0,
  score             numeric(6,2),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id, node_type, node_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE video_note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  video_id    uuid NOT NULL REFERENCES video(id) ON DELETE CASCADE,
  body        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id, video_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE practice_attempt (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  practice_lab_id uuid NOT NULL REFERENCES practice_lab(id) ON DELETE CASCADE,
  code            text NOT NULL DEFAULT '',
  stdout          text NOT NULL DEFAULT '',
  passed_count    int  NOT NULL DEFAULT 0,
  total_count     int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE lab_submission (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  class_id       uuid NOT NULL,
  graded_lab_id  uuid NOT NULL REFERENCES graded_lab(id) ON DELETE CASCADE,
  attempt_no     int  NOT NULL DEFAULT 1,
  mode           text NOT NULL DEFAULT 'in_app',   -- in_app | uploaded
  code           text NOT NULL DEFAULT '',
  stdout         text NOT NULL DEFAULT '',
  auto_score     numeric(5,2),
  auto_detail    jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_name      text NOT NULL DEFAULT '',
  file_media_id  uuid REFERENCES media_asset(id),
  student_note   text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'submitted', -- submitted|graded|revision
  rubric_scores  jsonb NOT NULL DEFAULT '{}'::jsonb,
  score          numeric(5,2),
  feedback       text NOT NULL DEFAULT '',
  graded_by      uuid,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  graded_at      timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id, graded_lab_id, attempt_no),
  FOREIGN KEY (tenant_id, user_id)  REFERENCES app_user(tenant_id, id)    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, class_id) REFERENCES school_class(tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- TENANT: examinations
-- ---------------------------------------------------------------------------

CREATE TABLE exam (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  class_id          uuid NOT NULL,
  blueprint_id      uuid NOT NULL REFERENCES exam_blueprint(id),
  title             text NOT NULL,
  starts_at         timestamptz NOT NULL,
  duration_minutes  int  NOT NULL DEFAULT 45,
  status            text NOT NULL DEFAULT 'scheduled', -- scheduled|marking|released
  created_by        uuid NOT NULL,
  released_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES school_class(tenant_id, id) ON DELETE CASCADE
);

-- The paper is snapshotted at schedule time, so editing the bank later cannot
-- change a paper students have already sat.
CREATE TABLE exam_question (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  exam_id      uuid NOT NULL,
  question_id  uuid NOT NULL REFERENCES question(id),
  position     int  NOT NULL,
  kind         text NOT NULL,
  text         text NOT NULL,
  options      jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_index int,
  marks        int  NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, exam_id, position),
  FOREIGN KEY (tenant_id, exam_id) REFERENCES exam(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE exam_attempt (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  exam_id           uuid NOT NULL,
  user_id           uuid NOT NULL,
  status            text NOT NULL DEFAULT 'in_progress', -- in_progress|submitted|marked
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_saved_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz,
  objective_score   numeric(6,2),
  written_score     numeric(6,2),
  total_score       numeric(6,2),
  max_score         numeric(6,2),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, exam_id, user_id),
  FOREIGN KEY (tenant_id, exam_id) REFERENCES exam(tenant_id, id)     ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE exam_answer (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  attempt_id        uuid NOT NULL,
  exam_question_id  uuid NOT NULL,
  choice_index      int,
  text_answer       text NOT NULL DEFAULT '',
  is_correct        boolean,
  marks_awarded     numeric(5,2),
  marked_by         uuid,
  marked_at         timestamptz,
  saved_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, attempt_id, exam_question_id),
  FOREIGN KEY (tenant_id, attempt_id)       REFERENCES exam_attempt(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, exam_question_id) REFERENCES exam_question(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE achievement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  badge_key   text NOT NULL,
  earned_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id, badge_key),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- TENANT: audit. Append-only. Redaction is a whitelist, applied on write.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  actor_user_id uuid,
  actor_scope   text NOT NULL DEFAULT 'tenant',
  action        text NOT NULL,
  entity_type   text NOT NULL DEFAULT '',
  entity_id     uuid,
  summary       text NOT NULL DEFAULT '',
  before_data   jsonb,
  after_data    jsonb,
  ip            text NOT NULL DEFAULT '',
  user_agent    text NOT NULL DEFAULT '',
  request_id    text NOT NULL DEFAULT '',
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
