-- ===========================================================================
-- The shared resource library.
--
-- Everything else in this schema is entitled: a lesson body, a recording, a
-- textbook section all ask can_reach(course_id) before they answer, because a
-- student must not read what they have not bought.
--
-- This table is the deliberate exception, and the only one. Brolly Admin puts
-- a syllabus, a set of notes or a handout on the shelf and every signed-in
-- teacher and student sees it — no enrolment, no course, no sharing step. That
-- is the whole requirement, so it is enforced here rather than left to a
-- handler to remember.
--
-- What it is NOT is public. app_user_id() IS NOT NULL keeps the shelf behind
-- the sign-in wall: the anonymous catalogue reader (app.role = 'ANON') gets
-- nothing, so this cannot become an accidental way to publish to the internet.
-- ===========================================================================

CREATE TABLE resource (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  -- syllabus | notes | handout | policy | link | other. Free text rather than
  -- an enum: a new kind of thing to put on the shelf should not be a migration.
  category       text NOT NULL DEFAULT 'notes',
  -- A LABEL, not a permission. A resource tagged with a course is still
  -- readable by everyone; the tag only says what it is about, so a teacher can
  -- find "the Python Foundations syllabus" among fifty files. ON DELETE SET
  -- NULL because retiring a course must not silently delete its syllabus.
  course_id      uuid REFERENCES course(id) ON DELETE SET NULL,
  -- Authored notes, as the same validated block document the rest of the
  -- product uses. Never HTML, so there is nowhere for a script to live.
  body           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- An uploaded file, and/or a link to something hosted elsewhere. Both are
  -- optional: a resource can be notes alone.
  media_asset_id uuid REFERENCES media_asset(id) ON DELETE SET NULL,
  external_url   text NOT NULL DEFAULT '',
  -- published | hidden. Live the moment it is saved; hidden takes it back off
  -- the shelf without deleting it.
  status         text NOT NULL DEFAULT 'published',
  position       int  NOT NULL DEFAULT 0,
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resource_shelf_idx ON resource (status, category, position, created_at DESC);
CREATE INDEX resource_course_idx ON resource (course_id) WHERE course_id IS NOT NULL;

ALTER TABLE resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource FORCE ROW LEVEL SECURITY;

-- Signed in and published, or admin. Nothing else reads this table.
CREATE POLICY r ON resource FOR SELECT USING (
  is_admin() OR (status = 'published' AND app_user_id() IS NOT NULL));
CREATE POLICY w ON resource FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- 003_rls.sql granted ON ALL TABLES, which only covered the tables that
-- existed then. A table added later needs its own grant or the app role cannot
-- touch it at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON resource TO brolly_app;

-- ---------------------------------------------------------------------------
-- The permissions behind it.
--
-- app/shared/access.py carries the same two entries, so a freshly seeded
-- database gets them from there. This block is for databases that already
-- exist: without it the routes would be unreachable until someone re-seeded,
-- which is destructive and therefore never going to happen in production.
-- ---------------------------------------------------------------------------

INSERT INTO permission (key, description, feature_key) VALUES
  ('resource:read',   'Read the shared resource library', NULL),
  ('resource:manage', 'Add and remove shared resources',  NULL)
ON CONFLICT (key) DO NOTHING;

-- Every role reads the shelf; only Brolly Admin fills it.
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'resource:read' FROM role r
 WHERE r.key IN ('BROLLY_ADMIN', 'TEACHER', 'STUDENT')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'resource:manage' FROM role r WHERE r.key = 'BROLLY_ADMIN'
ON CONFLICT DO NOTHING;

-- Nobody's authority changed in a way that invalidates a token, but every
-- signed-in account has a new permission. Bumping perm_version would sign the
-- whole platform out; the access cache in app/access.py expires on its own
-- within seconds, so the new permission simply appears.
