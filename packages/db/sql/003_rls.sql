-- ===========================================================================
-- Row-Level Security — isolation layer 3.
--
-- The application connects (or SET ROLEs) as brolly_app, which is NOT a
-- superuser and does NOT have BYPASSRLS. Every request opens a transaction and
-- sets three settings:
--
--   app.tenant_id   the school this request belongs to
--   app.user_id     who is acting
--   app.scope       'tenant' or 'platform'
--
-- Two deliberate asymmetries are encoded here rather than in application code:
--
--  1. Platform scope (Brolly admin) can manage schools, licences and logins,
--     and can READ the tables needed for counts and rates. It has NO policy at
--     all on lab_submission, exam_answer, exam_question, video_note,
--     practice_attempt, student_profile, announcements or teacher material.
--     "Brolly cannot open a student's answer sheet" is therefore a property of
--     the database, not a choice the UI makes.
--
--  2. Master curriculum is readable by every session and writable only under
--     platform scope. "A school cannot edit Brolly content" is likewise a
--     database fact.
-- ===========================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brolly_app') THEN
    CREATE ROLE brolly_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO brolly_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brolly_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brolly_app;

CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('app.scope', true), ''), 'tenant') = 'platform' $$;

-- ---------------------------------------------------------------------------
-- Master curriculum: everyone reads, only platform scope writes.
-- ---------------------------------------------------------------------------

ALTER TABLE subject                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject                 FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON subject  FOR SELECT USING (true);
CREATE POLICY write ON subject  FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE course                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE course                  FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON course   FOR SELECT USING (true);
CREATE POLICY write ON course   FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE unit                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit                    FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON unit     FOR SELECT USING (true);
CREATE POLICY write ON unit     FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE video                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE video                   FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON video    FOR SELECT USING (true);
CREATE POLICY write ON video    FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE material                ENABLE ROW LEVEL SECURITY;
ALTER TABLE material                FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON material FOR SELECT USING (true);
CREATE POLICY write ON material FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE practice_lab            ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_lab            FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON practice_lab FOR SELECT USING (true);
CREATE POLICY write ON practice_lab FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE graded_lab              ENABLE ROW LEVEL SECURITY;
ALTER TABLE graded_lab              FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON graded_lab FOR SELECT USING (true);
CREATE POLICY write ON graded_lab FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE question                ENABLE ROW LEVEL SECURITY;
ALTER TABLE question                FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON question FOR SELECT USING (true);
CREATE POLICY write ON question FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE exam_blueprint          ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_blueprint          FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON exam_blueprint FOR SELECT USING (true);
CREATE POLICY write ON exam_blueprint FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE exam_blueprint_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_blueprint_question FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON exam_blueprint_question FOR SELECT USING (true);
CREATE POLICY write ON exam_blueprint_question FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE content_item            ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_item            FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON content_item FOR SELECT USING (true);
CREATE POLICY write ON content_item FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE content_version         ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_version         FORCE  ROW LEVEL SECURITY;
-- schools only ever see published versions; drafts are platform-only
CREATE POLICY read  ON content_version FOR SELECT USING (status = 'published' OR app_is_platform());
CREATE POLICY write ON content_version FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE media_asset             ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_asset             FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON media_asset FOR SELECT USING (true);
CREATE POLICY write ON media_asset FOR ALL USING (true) WITH CHECK (true);  -- lab uploads create rows

ALTER TABLE content_release         ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_release         FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON content_release FOR SELECT USING (true);
CREATE POLICY write ON content_release FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE hub_change              ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_change              FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON hub_change FOR SELECT USING (app_is_platform());
CREATE POLICY write ON hub_change FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE hub_sync_state          ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_sync_state          FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON hub_sync_state FOR SELECT USING (app_is_platform());
CREATE POLICY write ON hub_sync_state FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE feature                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature                 FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON feature FOR SELECT USING (true);
CREATE POLICY write ON feature FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE permission              ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission              FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON permission FOR SELECT USING (true);
CREATE POLICY write ON permission FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE role                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE role                    FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON role FOR SELECT USING (tenant_id IS NULL OR tenant_id = app_tenant() OR app_is_platform());
CREATE POLICY write ON role FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE role_permission         ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permission         FORCE  ROW LEVEL SECURITY;
CREATE POLICY read  ON role_permission FOR SELECT USING (true);
CREATE POLICY write ON role_permission FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

-- ---------------------------------------------------------------------------
-- Tenant tables that platform scope MAY manage (schools, licences, logins).
-- ---------------------------------------------------------------------------

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON tenant FOR ALL
  USING      (id = app_tenant() OR app_is_platform())
  WITH CHECK (id = app_tenant() OR app_is_platform());

ALTER TABLE tenant_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domain FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON tenant_domain FOR ALL
  USING      (tenant_id = app_tenant() OR app_is_platform())
  WITH CHECK (tenant_id = app_tenant() OR app_is_platform());

ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON tenant_branding FOR ALL
  USING      (tenant_id = app_tenant() OR app_is_platform())
  WITH CHECK (tenant_id = app_tenant() OR app_is_platform());

ALTER TABLE tenant_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_setting FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON tenant_setting FOR ALL
  USING      (tenant_id = app_tenant() OR app_is_platform())
  WITH CHECK (tenant_id = app_tenant() OR app_is_platform());

ALTER TABLE tenant_feature ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON tenant_feature FOR ALL
  USING      (tenant_id = app_tenant() OR app_is_platform())
  WITH CHECK (tenant_id = app_tenant() OR app_is_platform());

ALTER TABLE licence ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence FORCE  ROW LEVEL SECURITY;
-- a school reads its own licence but can never change it
CREATE POLICY tenant_read  ON licence FOR SELECT USING (tenant_id = app_tenant() OR app_is_platform());
CREATE POLICY platform_write ON licence FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE tenant_entitlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_entitlement FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_read  ON tenant_entitlement FOR SELECT USING (tenant_id = app_tenant() OR app_is_platform());
CREATE POLICY platform_write ON tenant_entitlement FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON app_user FOR ALL
  USING      (tenant_id = app_tenant() OR app_is_platform())
  WITH CHECK (tenant_id = app_tenant() OR app_is_platform());

ALTER TABLE user_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON user_role FOR ALL
  USING      (tenant_id = app_tenant() OR app_is_platform())
  WITH CHECK (tenant_id = app_tenant() OR app_is_platform());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON audit_log FOR ALL
  USING      (tenant_id = app_tenant() OR app_is_platform())
  WITH CHECK (tenant_id = app_tenant() OR app_is_platform() OR tenant_id IS NULL);

-- ---------------------------------------------------------------------------
-- Tenant tables platform scope may READ (counts and rates) but never write.
-- ---------------------------------------------------------------------------

ALTER TABLE teacher_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_profile FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON teacher_profile FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON teacher_profile FOR SELECT USING (app_is_platform());

ALTER TABLE academic_year ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_year FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON academic_year FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON academic_year FOR SELECT USING (app_is_platform());

ALTER TABLE school_class ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_class FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON school_class FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON school_class FOR SELECT USING (app_is_platform());

ALTER TABLE class_teacher ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_teacher FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON class_teacher FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON class_teacher FOR SELECT USING (app_is_platform());

ALTER TABLE class_student ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_student FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON class_student FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON class_student FOR SELECT USING (app_is_platform());

ALTER TABLE course_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_assignment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON course_assignment FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON course_assignment FOR SELECT USING (app_is_platform());

ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON enrollment FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON enrollment FOR SELECT USING (app_is_platform());

ALTER TABLE progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON progress FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON progress FOR SELECT USING (app_is_platform());

ALTER TABLE exam ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON exam FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON exam FOR SELECT USING (app_is_platform());

ALTER TABLE exam_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempt FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON exam_attempt FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON exam_attempt FOR SELECT USING (app_is_platform());

ALTER TABLE assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso  ON assignment FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY plat_read   ON assignment FOR SELECT USING (app_is_platform());

-- ---------------------------------------------------------------------------
-- A student's own work and personal record.
-- No platform policy exists here. Brolly admin cannot read these rows at all.
-- ---------------------------------------------------------------------------

ALTER TABLE student_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profile FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON student_profile FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE session FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON session FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE video_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_note FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON video_note FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE practice_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_attempt FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON practice_attempt FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE lab_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_submission FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON lab_submission FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE exam_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_question FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON exam_question FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE exam_answer ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answer FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON exam_answer FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE achievement ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON achievement FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE announcement ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON announcement FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE assignment_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON assignment_item FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE teacher_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_material FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON teacher_material FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE teacher_material_class ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_material_class FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON teacher_material_class FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE curriculum_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_plan FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON curriculum_plan FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE curriculum_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON curriculum_item FOR ALL USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
