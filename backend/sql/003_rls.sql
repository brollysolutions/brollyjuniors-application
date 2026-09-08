-- ===========================================================================
-- Row-level security — entitlement enforced by the database.
--
-- The B2B product's problem was "School A must not read School B". B2C has a
-- different one, stated in requirement 24:
--
--   "A student should not be able to access a course merely because they know
--    the course ID or URL."
--
-- That is an ENTITLEMENT rule, and it is enforced here rather than only in the
-- API, so a carelessly written endpoint added next year still returns nothing.
--
-- The dividing line is deliberate and matches how people buy courses:
--
--   STRUCTURE is public   — course, module, lesson titles, teacher names.
--                           A shopper must be able to read the curriculum
--                           before paying for it.
--   SUBSTANCE is entitled — lesson bodies, textbook sections, recordings,
--                           materials, exercises, quiz questions.
--
-- Three settings are pinned per request by packages/db/src/client.ts:
--   app.user_id   who is acting  ('' when nobody is signed in)
--   app.role      BROLLY_ADMIN | TEACHER | STUDENT | ANON
-- ===========================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brolly_app') THEN
    CREATE ROLE brolly_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO brolly_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brolly_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brolly_app;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'ANON') $$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT app_role() = 'BROLLY_ADMIN' $$;

/** Does the current user teach this course? The student/teacher link, derived. */
CREATE OR REPLACE FUNCTION teaches(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM course_teacher ct
     WHERE ct.course_id = cid AND ct.user_id = app_user_id())
$$;

/** Does the current user hold a live enrolment in this course? */
CREATE OR REPLACE FUNCTION entitled(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM enrollment e
     WHERE e.course_id = cid
       AND e.user_id = app_user_id()
       AND e.status = 'active'
       AND (e.expires_on IS NULL OR e.expires_on >= current_date))
$$;

/** The single question every protected read asks. */
CREATE OR REPLACE FUNCTION can_reach(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT is_admin() OR teaches(cid) OR entitled(cid) $$;

-- ---------------------------------------------------------------------------
-- Access-control vocabulary: readable by all, writable by nobody at runtime.
-- ---------------------------------------------------------------------------

ALTER TABLE permission ENABLE ROW LEVEL SECURITY; ALTER TABLE permission FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON permission FOR SELECT USING (true);
CREATE POLICY w ON permission FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE role ENABLE ROW LEVEL SECURITY; ALTER TABLE role FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON role FOR SELECT USING (true);
CREATE POLICY w ON role FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE role_permission ENABLE ROW LEVEL SECURITY; ALTER TABLE role_permission FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON role_permission FOR SELECT USING (true);
CREATE POLICY w ON role_permission FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY; ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
-- You see yourself; an admin sees everyone; a teacher sees the students on the
-- courses they teach, and nobody else's account.
CREATE POLICY r ON app_user FOR SELECT USING (
  id = app_user_id()
  OR is_admin()
  OR EXISTS (
    SELECT 1 FROM course_teacher ct
      JOIN enrollment e ON e.course_id = ct.course_id AND e.status = 'active'
     WHERE ct.user_id = app_user_id() AND e.user_id = app_user.id)
  -- a course's teachers are public, so the catalogue can name them
  OR EXISTS (
    SELECT 1 FROM course_teacher ct
      JOIN course c ON c.id = ct.course_id AND c.status = 'published'
     WHERE ct.user_id = app_user.id)
);
CREATE POLICY u ON app_user FOR UPDATE USING (id = app_user_id() OR is_admin())
  WITH CHECK (id = app_user_id() OR is_admin());
CREATE POLICY w ON app_user FOR INSERT WITH CHECK (is_admin());
CREATE POLICY d ON app_user FOR DELETE USING (is_admin());

ALTER TABLE user_role ENABLE ROW LEVEL SECURITY; ALTER TABLE user_role FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON user_role FOR SELECT USING (user_id = app_user_id() OR is_admin());
CREATE POLICY w ON user_role FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE teacher_profile ENABLE ROW LEVEL SECURITY; ALTER TABLE teacher_profile FORCE ROW LEVEL SECURITY;
-- Public: a shopper needs to see who teaches the course.
CREATE POLICY r ON teacher_profile FOR SELECT USING (true);
CREATE POLICY w ON teacher_profile FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

ALTER TABLE student_profile ENABLE ROW LEVEL SECURITY; ALTER TABLE student_profile FORCE ROW LEVEL SECURITY;
-- Private. A teacher can see that a student is on their course (app_user), but
-- not their date of birth or their guardian's phone number.
CREATE POLICY r ON student_profile FOR SELECT USING (user_id = app_user_id() OR is_admin());
CREATE POLICY w ON student_profile FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

ALTER TABLE session ENABLE ROW LEVEL SECURITY; ALTER TABLE session FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON session FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

-- ---------------------------------------------------------------------------
-- Catalogue: STRUCTURE is public so people can shop.
-- ---------------------------------------------------------------------------

ALTER TABLE subject ENABLE ROW LEVEL SECURITY; ALTER TABLE subject FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON subject FOR SELECT USING (true);
CREATE POLICY w ON subject FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE course ENABLE ROW LEVEL SECURITY; ALTER TABLE course FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON course FOR SELECT USING (status = 'published' OR is_admin() OR teaches(id));
CREATE POLICY w ON course FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE course_teacher ENABLE ROW LEVEL SECURITY; ALTER TABLE course_teacher FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON course_teacher FOR SELECT USING (true);
CREATE POLICY w ON course_teacher FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE module ENABLE ROW LEVEL SECURITY; ALTER TABLE module FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON module FOR SELECT USING (
  is_admin() OR EXISTS (SELECT 1 FROM course c WHERE c.id = module.course_id AND c.status = 'published'));
CREATE POLICY w ON module FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE lesson ENABLE ROW LEVEL SECURITY; ALTER TABLE lesson FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON lesson FOR SELECT USING (
  is_admin() OR EXISTS (
    SELECT 1 FROM module m JOIN course c ON c.id = m.course_id
     WHERE m.id = lesson.module_id AND c.status = 'published'));
CREATE POLICY w ON lesson FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ---------------------------------------------------------------------------
-- Substance: entitlement required. Knowing an id gets you nothing.
-- ---------------------------------------------------------------------------

ALTER TABLE topic ENABLE ROW LEVEL SECURITY; ALTER TABLE topic FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON topic FOR SELECT USING (
  is_admin() OR EXISTS (
    SELECT 1 FROM lesson l JOIN module m ON m.id = l.module_id
     WHERE l.id = topic.lesson_id AND can_reach(m.course_id)));
CREATE POLICY w ON topic FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE content_item ENABLE ROW LEVEL SECURITY; ALTER TABLE content_item FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON content_item FOR SELECT USING (
  is_admin() OR course_id IS NULL OR can_reach(course_id));
CREATE POLICY w ON content_item FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE content_version ENABLE ROW LEVEL SECURITY; ALTER TABLE content_version FORCE ROW LEVEL SECURITY;
-- Only published versions, and only to someone entitled to the course.
-- Drafts and content in review are visible to Brolly Admin alone.
CREATE POLICY r ON content_version FOR SELECT USING (
  is_admin() OR (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM content_item ci
       WHERE ci.id = content_version.content_item_id
         AND (ci.course_id IS NULL OR can_reach(ci.course_id)))));
CREATE POLICY w ON content_version FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE content_release ENABLE ROW LEVEL SECURITY; ALTER TABLE content_release FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON content_release FOR SELECT USING (true);
CREATE POLICY w ON content_release FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE media_asset ENABLE ROW LEVEL SECURITY; ALTER TABLE media_asset FORCE ROW LEVEL SECURITY;
-- Metadata only — no URL is ever in a row. A usable link is a short-lived
-- signature minted by the API after an entitlement check (see media.ts).
CREATE POLICY r ON media_asset FOR SELECT USING (true);
CREATE POLICY w ON media_asset FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE textbook ENABLE ROW LEVEL SECURITY; ALTER TABLE textbook FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON textbook FOR SELECT USING (is_admin() OR can_reach(course_id));
CREATE POLICY w ON textbook FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE chapter ENABLE ROW LEVEL SECURITY; ALTER TABLE chapter FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON chapter FOR SELECT USING (
  is_admin() OR EXISTS (
    SELECT 1 FROM textbook t WHERE t.id = chapter.textbook_id AND can_reach(t.course_id)));
CREATE POLICY w ON chapter FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE section ENABLE ROW LEVEL SECURITY; ALTER TABLE section FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON section FOR SELECT USING (
  is_admin() OR EXISTS (
    SELECT 1 FROM chapter ch JOIN textbook t ON t.id = ch.textbook_id
     WHERE ch.id = section.chapter_id AND can_reach(t.course_id)));
CREATE POLICY w ON section FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE exercise ENABLE ROW LEVEL SECURITY; ALTER TABLE exercise FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON exercise FOR SELECT USING (
  is_admin() OR EXISTS (
    SELECT 1 FROM lesson l JOIN module m ON m.id = l.module_id
     WHERE l.id = exercise.lesson_id AND can_reach(m.course_id)));
CREATE POLICY w ON exercise FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE quiz ENABLE ROW LEVEL SECURITY; ALTER TABLE quiz FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON quiz FOR SELECT USING (can_reach(course_id));
CREATE POLICY w ON quiz FOR ALL USING (is_admin() OR teaches(course_id))
  WITH CHECK (is_admin() OR teaches(course_id));

ALTER TABLE question ENABLE ROW LEVEL SECURITY; ALTER TABLE question FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON question FOR SELECT USING (
  EXISTS (SELECT 1 FROM quiz q WHERE q.id = question.quiz_id AND can_reach(q.course_id)));
CREATE POLICY w ON question FOR ALL USING (
  is_admin() OR EXISTS (SELECT 1 FROM quiz q WHERE q.id = question.quiz_id AND teaches(q.course_id)))
  WITH CHECK (
  is_admin() OR EXISTS (SELECT 1 FROM quiz q WHERE q.id = question.quiz_id AND teaches(q.course_id)));

ALTER TABLE learning_material ENABLE ROW LEVEL SECURITY; ALTER TABLE learning_material FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON learning_material FOR SELECT USING (
  can_reach(course_id) AND (status = 'published' OR is_admin() OR teaches(course_id)));
CREATE POLICY w ON learning_material FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE recording ENABLE ROW LEVEL SECURITY; ALTER TABLE recording FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON recording FOR SELECT USING (
  can_reach(course_id) AND (status = 'published' OR is_admin() OR teaches(course_id)));
CREATE POLICY w ON recording FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ---------------------------------------------------------------------------
-- Live teaching
-- ---------------------------------------------------------------------------

ALTER TABLE live_session ENABLE ROW LEVEL SECURITY; ALTER TABLE live_session FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON live_session FOR SELECT USING (can_reach(course_id));
CREATE POLICY w ON live_session FOR ALL USING (is_admin()) WITH CHECK (is_admin());
-- The assigned teacher may update their own session's status (start / end it).
CREATE POLICY t ON live_session FOR UPDATE USING (teacher_id = app_user_id())
  WITH CHECK (teacher_id = app_user_id());

ALTER TABLE session_attendance ENABLE ROW LEVEL SECURITY; ALTER TABLE session_attendance FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON session_attendance FOR ALL USING (
  user_id = app_user_id() OR is_admin()
  OR EXISTS (SELECT 1 FROM live_session s WHERE s.id = live_session_id AND s.teacher_id = app_user_id()))
  WITH CHECK (
  user_id = app_user_id() OR is_admin()
  OR EXISTS (SELECT 1 FROM live_session s WHERE s.id = live_session_id AND s.teacher_id = app_user_id()));

-- ---------------------------------------------------------------------------
-- Commerce and enrolment — a student's own business
-- ---------------------------------------------------------------------------

ALTER TABLE course_order ENABLE ROW LEVEL SECURITY; ALTER TABLE course_order FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON course_order FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY; ALTER TABLE enrollment FORCE ROW LEVEL SECURITY;
-- A teacher sees who is on their course; a student sees only their own.
CREATE POLICY r ON enrollment FOR SELECT USING (
  user_id = app_user_id() OR is_admin() OR teaches(course_id));
CREATE POLICY w ON enrollment FOR INSERT WITH CHECK (user_id = app_user_id() OR is_admin());
CREATE POLICY u ON enrollment FOR UPDATE USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());
CREATE POLICY d ON enrollment FOR DELETE USING (is_admin());

-- ---------------------------------------------------------------------------
-- Learning records — the student owns them; the teacher of that course may see
-- them; nobody else, ever.
-- ---------------------------------------------------------------------------

ALTER TABLE progress ENABLE ROW LEVEL SECURITY; ALTER TABLE progress FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON progress FOR SELECT USING (
  user_id = app_user_id() OR is_admin() OR teaches(course_id));
CREATE POLICY w ON progress FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

ALTER TABLE exercise_attempt ENABLE ROW LEVEL SECURITY; ALTER TABLE exercise_attempt FORCE ROW LEVEL SECURITY;
-- Practice is nobody else's business, not even the teacher's.
CREATE POLICY r ON exercise_attempt FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

ALTER TABLE assignment ENABLE ROW LEVEL SECURITY; ALTER TABLE assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON assignment FOR SELECT USING (
  can_reach(course_id) AND (status = 'published' OR is_admin() OR teaches(course_id)));
CREATE POLICY w ON assignment FOR ALL USING (is_admin() OR teaches(course_id))
  WITH CHECK (is_admin() OR teaches(course_id));

ALTER TABLE submission ENABLE ROW LEVEL SECURITY; ALTER TABLE submission FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON submission FOR SELECT USING (
  user_id = app_user_id() OR is_admin()
  OR EXISTS (SELECT 1 FROM assignment a WHERE a.id = assignment_id AND teaches(a.course_id)));
CREATE POLICY w ON submission FOR INSERT WITH CHECK (user_id = app_user_id() OR is_admin());
CREATE POLICY u ON submission FOR UPDATE USING (
  user_id = app_user_id() OR is_admin()
  OR EXISTS (SELECT 1 FROM assignment a WHERE a.id = assignment_id AND teaches(a.course_id)))
  WITH CHECK (
  user_id = app_user_id() OR is_admin()
  OR EXISTS (SELECT 1 FROM assignment a WHERE a.id = assignment_id AND teaches(a.course_id)));

ALTER TABLE quiz_attempt ENABLE ROW LEVEL SECURITY; ALTER TABLE quiz_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON quiz_attempt FOR SELECT USING (
  user_id = app_user_id() OR is_admin()
  OR EXISTS (SELECT 1 FROM quiz q WHERE q.id = quiz_id AND teaches(q.course_id)));
CREATE POLICY w ON quiz_attempt FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

ALTER TABLE quiz_answer ENABLE ROW LEVEL SECURITY; ALTER TABLE quiz_answer FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON quiz_answer FOR ALL USING (
  EXISTS (SELECT 1 FROM quiz_attempt a WHERE a.id = attempt_id
            AND (a.user_id = app_user_id() OR is_admin())))
  WITH CHECK (
  EXISTS (SELECT 1 FROM quiz_attempt a WHERE a.id = attempt_id
            AND (a.user_id = app_user_id() OR is_admin())));

ALTER TABLE achievement ENABLE ROW LEVEL SECURITY; ALTER TABLE achievement FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON achievement FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

ALTER TABLE certificate ENABLE ROW LEVEL SECURITY; ALTER TABLE certificate FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON certificate FOR SELECT USING (user_id = app_user_id() OR is_admin());
CREATE POLICY w ON certificate FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE notification ENABLE ROW LEVEL SECURITY; ALTER TABLE notification FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON notification FOR ALL USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON audit_log FOR SELECT USING (is_admin());
CREATE POLICY w ON audit_log FOR INSERT WITH CHECK (true);   -- everyone writes, only admin reads
