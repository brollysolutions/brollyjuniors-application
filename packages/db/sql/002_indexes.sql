-- ===========================================================================
-- Indexes.
--
-- The rule for a shared-schema multi-tenant database: tenant_id leads almost
-- every index, because almost every query filters on it and the planner should
-- never walk another school's pages.
-- ===========================================================================

CREATE INDEX app_user_tenant_status_idx    ON app_user (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX user_role_role_idx            ON user_role (tenant_id, role_id);
CREATE INDEX session_user_idx              ON session (tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX session_family_idx            ON session (family_id);

CREATE INDEX school_class_year_idx         ON school_class (tenant_id, academic_year_id);
CREATE INDEX class_student_user_idx        ON class_student (tenant_id, user_id) WHERE left_at IS NULL;
CREATE INDEX class_teacher_user_idx        ON class_teacher (tenant_id, user_id);

CREATE INDEX enrollment_user_idx           ON enrollment (tenant_id, user_id, status);
CREATE INDEX enrollment_course_idx         ON enrollment (tenant_id, course_id);

CREATE INDEX progress_user_idx             ON progress (tenant_id, user_id, node_type);
CREATE INDEX progress_activity_idx         ON progress (tenant_id, last_activity_at DESC);

CREATE INDEX lab_submission_class_idx      ON lab_submission (tenant_id, class_id, status);
CREATE INDEX lab_submission_user_idx       ON lab_submission (tenant_id, user_id);
CREATE INDEX lab_submission_pending_idx    ON lab_submission (tenant_id, class_id) WHERE status = 'submitted';

CREATE INDEX practice_attempt_user_idx     ON practice_attempt (tenant_id, user_id, practice_lab_id);

CREATE INDEX exam_class_idx                ON exam (tenant_id, class_id, starts_at DESC);
CREATE INDEX exam_question_exam_idx        ON exam_question (tenant_id, exam_id, position);
CREATE INDEX exam_attempt_exam_idx         ON exam_attempt (tenant_id, exam_id, status);
CREATE INDEX exam_attempt_user_idx         ON exam_attempt (tenant_id, user_id);
CREATE INDEX exam_answer_attempt_idx       ON exam_answer (tenant_id, attempt_id);

CREATE INDEX assignment_class_idx          ON assignment (tenant_id, class_id, due_at DESC);
CREATE INDEX announcement_class_idx        ON announcement (tenant_id, class_id, created_at DESC);
CREATE INDEX teacher_material_creator_idx  ON teacher_material (tenant_id, created_by, status);

CREATE INDEX entitlement_lookup_idx        ON tenant_entitlement (tenant_id, resource_type, resource_id) WHERE status = 'active';
CREATE INDEX licence_tenant_idx            ON licence (tenant_id, status);

CREATE INDEX audit_tenant_time_idx         ON audit_log (tenant_id, occurred_at DESC);
CREATE INDEX audit_entity_idx              ON audit_log (tenant_id, entity_type, entity_id);
CREATE INDEX audit_action_idx              ON audit_log (action, occurred_at DESC);

-- platform curriculum
CREATE INDEX unit_course_idx               ON unit (course_id, position);
CREATE INDEX video_unit_idx                ON video (unit_id, position);
CREATE INDEX material_unit_idx             ON material (unit_id, position);
CREATE INDEX practice_lab_unit_idx         ON practice_lab (unit_id, position);
CREATE INDEX graded_lab_course_idx         ON graded_lab (course_id, program_no);
CREATE INDEX question_unit_kind_idx        ON question (unit_id, kind);
CREATE INDEX content_version_item_idx      ON content_version (content_item_id, version_no DESC);
CREATE INDEX hub_change_seq_idx            ON hub_change (seq);
