-- ===========================================================================
-- Brolly Juniors — B2C schema
--
-- Three roles and no school. There is no organisation table, no tenant column
-- and no School Admin, because inventing one for a business model that does not
-- exist yet is the expensive kind of future-proofing.
--
-- What IS prepared for B2B: nothing in here assumes a single organisation.
-- Adding one later is one migration (an `organization` table plus a nullable
-- `org_id` on `app_user`, `course` and `enrollment`) plus one clause in each
-- policy — see docs/04-security-scale-and-b2b.md. It is not free, and the
-- document says so honestly rather than pretending a hook makes it free.
--
-- The student/teacher relationship is deliberately NOT stored. It is derived:
--   teacher --< course_teacher >-- course --< enrollment >-- student
-- so a teacher reaches a student only through a course they actually teach.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

CREATE TABLE permission (
  key          text PRIMARY KEY,
  description  text NOT NULL DEFAULT '',
  feature_key  text
);

CREATE TABLE role (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,
  name        text NOT NULL,
  level       int  NOT NULL DEFAULT 10,
  is_system   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permission (
  role_id        uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permission(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  password_hash   text NOT NULL,
  full_name       text NOT NULL,
  phone           text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'active',   -- active | disabled
  perm_version    int  NOT NULL DEFAULT 1,          -- bump = revoke live tokens
  must_change_pw  boolean NOT NULL DEFAULT false,
  email_verified  boolean NOT NULL DEFAULT false,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX app_user_email_uq ON app_user (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE user_role (
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE teacher_profile (
  user_id     uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  headline    text NOT NULL DEFAULT '',
  bio         text NOT NULL DEFAULT '',
  expertise   text[] NOT NULL DEFAULT '{}',
  years_exp   int NOT NULL DEFAULT 0,
  avatar_media_id uuid
);

CREATE TABLE student_profile (
  user_id        uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  grade_level    text NOT NULL DEFAULT '',
  date_of_birth  date,
  guardian_name  text NOT NULL DEFAULT '',
  guardian_email text NOT NULL DEFAULT '',
  guardian_phone text NOT NULL DEFAULT '',
  -- Students may be minors. Consent is recorded, not assumed.
  consent_status text NOT NULL DEFAULT 'pending',   -- pending | guardian_given | adult
  timezone       text NOT NULL DEFAULT 'Asia/Kolkata'
);

CREATE TABLE session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  refresh_token_hash  text NOT NULL,
  family_id           uuid NOT NULL,
  user_agent          text NOT NULL DEFAULT '',
  ip                  text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  used_at             timestamptz,
  revoked_at          timestamptz
);

-- ---------------------------------------------------------------------------
-- Catalogue and curriculum
-- ---------------------------------------------------------------------------

CREATE TABLE subject (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key   text UNIQUE NOT NULL,
  name  text NOT NULL,
  blurb text NOT NULL DEFAULT ''
);

CREATE TABLE course (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      uuid NOT NULL REFERENCES subject(id),
  slug            text UNIQUE NOT NULL,
  title           text NOT NULL,
  subtitle        text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  outcomes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirements    jsonb NOT NULL DEFAULT '[]'::jsonb,
  level           text NOT NULL DEFAULT 'Beginner',
  age_range       text NOT NULL DEFAULT '11–16',
  duration_hours  int  NOT NULL DEFAULT 0,
  price_minor     int  NOT NULL DEFAULT 0,          -- integer paise. never a float.
  currency        text NOT NULL DEFAULT 'INR',
  status          text NOT NULL DEFAULT 'draft',    -- draft | published | retired
  hero_media_id   uuid,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A course has one or more teachers; a teacher has one or more courses.
-- This join IS the student/teacher relationship, one hop removed.
CREATE TABLE course_teacher (
  course_id  uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'lead',          -- lead | assistant
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE module (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  position   int  NOT NULL,
  title      text NOT NULL,
  summary    text NOT NULL DEFAULT '',
  UNIQUE (course_id, position)
);

CREATE TABLE lesson (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id        uuid NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  position         int  NOT NULL,
  title            text NOT NULL,
  est_minutes      int  NOT NULL DEFAULT 10,
  content_item_id  uuid,
  UNIQUE (module_id, position)
);

CREATE TABLE topic (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id        uuid NOT NULL REFERENCES lesson(id) ON DELETE CASCADE,
  position         int  NOT NULL,
  title            text NOT NULL,
  content_item_id  uuid,
  UNIQUE (lesson_id, position)
);

-- ---------------------------------------------------------------------------
-- Content Hub: versioned bodies, kept separate from structure
-- ---------------------------------------------------------------------------

CREATE TABLE content_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text UNIQUE NOT NULL,
  content_type  text NOT NULL,        -- lesson | topic | section | material
  title         text NOT NULL DEFAULT '',
  -- Denormalised so the entitlement policy on content_version is a single
  -- indexed comparison rather than a four-table walk on every row read.
  course_id     uuid REFERENCES course(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id  uuid NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
  version_no       int  NOT NULL,
  locale           text NOT NULL DEFAULT 'en',
  status           text NOT NULL DEFAULT 'draft',  -- draft|review|published|archived
  body             jsonb NOT NULL,
  body_hash        text NOT NULL DEFAULT '',
  changelog        text NOT NULL DEFAULT '',
  created_by       uuid,
  reviewed_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  UNIQUE (content_item_id, version_no, locale)
);
-- Exactly one published version per item and locale. "Current" is a database
-- fact, not an application convention — and a published row is never edited.
CREATE UNIQUE INDEX content_version_published_uq
  ON content_version (content_item_id, locale) WHERE status = 'published';

CREATE TABLE content_release (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL,        -- course | textbook
  scope_id      uuid NOT NULL,
  release_no    int  NOT NULL,
  status        text NOT NULL DEFAULT 'published', -- published|superseded|rolled_back
  manifest      jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_by  uuid,
  published_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_id, release_no)
);
CREATE UNIQUE INDEX content_release_current_uq
  ON content_release (scope, scope_id) WHERE status = 'published';

-- Metadata only. The bytes live in object storage under a content-addressed
-- key, so a URL can never go stale and every asset caches for a year.
CREATE TABLE media_asset (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256        text UNIQUE NOT NULL,
  storage_key   text NOT NULL,
  file_name     text NOT NULL DEFAULT '',
  kind          text NOT NULL,        -- image|video|pdf|audio|code|doc
  mime_type     text NOT NULL,
  bytes         bigint NOT NULL DEFAULT 0,
  width         int,
  height        int,
  duration_ms   int,
  visibility    text NOT NULL DEFAULT 'protected',  -- public | protected
  derivatives   jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Textbooks
-- ---------------------------------------------------------------------------

CREATE TABLE textbook (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  slug       text UNIQUE NOT NULL,
  title      text NOT NULL,
  edition    text NOT NULL DEFAULT '1st edition',
  locale     text NOT NULL DEFAULT 'en'
);

CREATE TABLE chapter (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id  uuid NOT NULL REFERENCES textbook(id) ON DELETE CASCADE,
  position     int  NOT NULL,
  title        text NOT NULL,
  UNIQUE (textbook_id, position)
);

CREATE TABLE section (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id       uuid NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  position         int  NOT NULL,
  title            text NOT NULL,
  content_item_id  uuid REFERENCES content_item(id),
  UNIQUE (chapter_id, position)
);

-- ---------------------------------------------------------------------------
-- Practice, assessment, materials
-- ---------------------------------------------------------------------------

CREATE TABLE exercise (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     uuid NOT NULL REFERENCES lesson(id) ON DELETE CASCADE,
  position      int  NOT NULL DEFAULT 0,
  title         text NOT NULL,
  level         text NOT NULL DEFAULT 'Easy',
  brief         text NOT NULL DEFAULT '',
  starter_code  text NOT NULL DEFAULT '',
  hints         jsonb NOT NULL DEFAULT '[]'::jsonb,
  solution      text NOT NULL DEFAULT '',
  test_cases    jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE quiz (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  module_id      uuid REFERENCES module(id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  pass_mark_pct  int  NOT NULL DEFAULT 60,
  time_limit_min int,
  max_attempts   int  NOT NULL DEFAULT 3,
  status         text NOT NULL DEFAULT 'published'
);

CREATE TABLE question (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       uuid NOT NULL REFERENCES quiz(id) ON DELETE CASCADE,
  position      int  NOT NULL,
  kind          text NOT NULL DEFAULT 'mcq',    -- mcq | multi | code | short
  text          text NOT NULL,
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_index  int,
  explanation   text NOT NULL DEFAULT '',
  marks         int  NOT NULL DEFAULT 1,
  topic         text NOT NULL DEFAULT '',
  UNIQUE (quiz_id, position)
);

CREATE TABLE learning_material (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  module_id      uuid REFERENCES module(id) ON DELETE CASCADE,
  lesson_id      uuid REFERENCES lesson(id) ON DELETE CASCADE,
  position       int  NOT NULL DEFAULT 0,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  kind           text NOT NULL DEFAULT 'pdf',   -- pdf|worksheet|code|slides|link
  media_asset_id uuid REFERENCES media_asset(id),
  external_url   text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'published',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Live and recorded teaching
-- ---------------------------------------------------------------------------

CREATE TABLE live_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  module_id     uuid REFERENCES module(id),
  teacher_id    uuid NOT NULL REFERENCES app_user(id),
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  -- Provider-agnostic on purpose: Zoom, Meet or Daily is a column value plus an
  -- adapter, not a schema change.
  provider      text NOT NULL DEFAULT 'manual',
  meeting_url   text NOT NULL DEFAULT '',
  capacity      int,
  status        text NOT NULL DEFAULT 'scheduled', -- scheduled|live|ended|cancelled
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE session_attendance (
  live_session_id uuid NOT NULL REFERENCES live_session(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'registered', -- registered|attended|absent
  joined_at       timestamptz,
  left_at         timestamptz,
  PRIMARY KEY (live_session_id, user_id)
);

CREATE TABLE recording (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  module_id       uuid REFERENCES module(id) ON DELETE CASCADE,
  lesson_id       uuid REFERENCES lesson(id) ON DELETE CASCADE,
  live_session_id uuid REFERENCES live_session(id) ON DELETE SET NULL,
  position        int  NOT NULL DEFAULT 0,
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  duration_seconds int NOT NULL DEFAULT 0,
  media_asset_id  uuid REFERENCES media_asset(id),
  status          text NOT NULL DEFAULT 'published',  -- draft | published
  recorded_on     date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Commerce and enrolment
-- ---------------------------------------------------------------------------

CREATE TABLE course_order (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES course(id),
  amount_minor   int  NOT NULL,
  currency       text NOT NULL DEFAULT 'INR',
  status         text NOT NULL DEFAULT 'pending',  -- pending|paid|failed|refunded
  provider       text NOT NULL DEFAULT 'mock',
  provider_ref   text NOT NULL DEFAULT '',
  -- No card data is ever stored. The provider reference is the only link.
  idempotency_key text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz
);
CREATE UNIQUE INDEX course_order_idem_uq ON course_order (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE enrollment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  course_id       uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'active',   -- active|completed|cancelled|expired
  source          text NOT NULL DEFAULT 'purchase', -- purchase|free|admin|trial
  order_id        uuid REFERENCES course_order(id),
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  starts_on       date,
  expires_on      date,
  completed_at    timestamptz,
  UNIQUE (user_id, course_id)
);

-- ---------------------------------------------------------------------------
-- Learning records — owned by one student
-- ---------------------------------------------------------------------------

CREATE TABLE progress (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  course_id         uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  node_type         text NOT NULL,      -- lesson|topic|exercise|recording|material|quiz
  node_id           uuid NOT NULL,
  status            text NOT NULL DEFAULT 'in_progress',
  percent           numeric(5,2) NOT NULL DEFAULT 0,
  seconds_spent     int  NOT NULL DEFAULT 0,
  attempts          int  NOT NULL DEFAULT 0,
  score             numeric(6,2),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, node_type, node_id)
);

CREATE TABLE exercise_attempt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  exercise_id  uuid NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
  code         text NOT NULL DEFAULT '',
  stdout       text NOT NULL DEFAULT '',
  passed_count int  NOT NULL DEFAULT 0,
  total_count  int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assignment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  module_id     uuid REFERENCES module(id) ON DELETE CASCADE,
  lesson_id     uuid REFERENCES lesson(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES app_user(id),
  title         text NOT NULL,
  instructions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  rubric        jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_score     int  NOT NULL DEFAULT 10,
  due_at        timestamptz,
  allow_resubmit boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'published',   -- draft | published | closed
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE submission (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  attempt_no     int  NOT NULL DEFAULT 1,
  body           text NOT NULL DEFAULT '',
  code           text NOT NULL DEFAULT '',
  file_media_id  uuid REFERENCES media_asset(id),
  file_name      text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'submitted',  -- submitted|graded|returned
  rubric_scores  jsonb NOT NULL DEFAULT '{}'::jsonb,
  score          numeric(5,2),
  feedback       text NOT NULL DEFAULT '',
  graded_by      uuid REFERENCES app_user(id),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  graded_at      timestamptz,
  UNIQUE (assignment_id, user_id, attempt_no)
);

CREATE TABLE quiz_attempt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       uuid NOT NULL REFERENCES quiz(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  attempt_no    int  NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'in_progress', -- in_progress|submitted
  score         numeric(6,2),
  max_score     numeric(6,2),
  passed        boolean,
  started_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  UNIQUE (quiz_id, user_id, attempt_no)
);

CREATE TABLE quiz_answer (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid NOT NULL REFERENCES quiz_attempt(id) ON DELETE CASCADE,
  question_id   uuid NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  choice_index  int,
  text_answer   text NOT NULL DEFAULT '',
  is_correct    boolean,
  marks_awarded numeric(5,2),
  saved_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE TABLE achievement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES course(id) ON DELETE CASCADE,
  badge_key   text NOT NULL,
  earned_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_key, course_id)
);

CREATE TABLE certificate (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  course_id          uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  serial             text UNIQUE NOT NULL,
  verification_code  text UNIQUE NOT NULL,
  final_score        numeric(5,2),
  pdf_media_id       uuid REFERENCES media_asset(id),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

CREATE TABLE notification (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  link_screen text NOT NULL DEFAULT '',
  link_param  text NOT NULL DEFAULT '',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit. Append-only; redaction is applied on write, by whitelist.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_role    text NOT NULL DEFAULT '',
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
