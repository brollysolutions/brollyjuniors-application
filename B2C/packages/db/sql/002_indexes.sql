-- ===========================================================================
-- Indexes.
--
-- In B2C the hot paths are "everything for one student" and "everyone on one
-- course", so user_id and course_id lead almost every index.
-- ===========================================================================

CREATE INDEX user_role_role_idx        ON user_role (role_id);
CREATE INDEX session_user_idx          ON session (user_id) WHERE revoked_at IS NULL;
CREATE INDEX session_family_idx        ON session (family_id);

CREATE INDEX course_status_idx         ON course (status, published_at DESC);
CREATE INDEX course_subject_idx        ON course (subject_id);
CREATE INDEX course_teacher_user_idx   ON course_teacher (user_id);

CREATE INDEX module_course_idx         ON module (course_id, position);
CREATE INDEX lesson_module_idx         ON lesson (module_id, position);
CREATE INDEX topic_lesson_idx          ON topic (lesson_id, position);

CREATE INDEX chapter_textbook_idx      ON chapter (textbook_id, position);
CREATE INDEX section_chapter_idx       ON section (chapter_id, position);
CREATE INDEX textbook_course_idx       ON textbook (course_id);

CREATE INDEX content_version_item_idx  ON content_version (content_item_id, version_no DESC);
CREATE INDEX content_release_scope_idx ON content_release (scope, scope_id, release_no DESC);

CREATE INDEX exercise_lesson_idx       ON exercise (lesson_id, position);
CREATE INDEX quiz_course_idx           ON quiz (course_id);
CREATE INDEX question_quiz_idx         ON question (quiz_id, position);
CREATE INDEX material_course_idx       ON learning_material (course_id, position);
CREATE INDEX material_lesson_idx       ON learning_material (lesson_id) WHERE lesson_id IS NOT NULL;

CREATE INDEX live_course_time_idx      ON live_session (course_id, starts_at);
CREATE INDEX live_teacher_time_idx     ON live_session (teacher_id, starts_at);
CREATE INDEX live_upcoming_idx         ON live_session (starts_at) WHERE status = 'scheduled';
CREATE INDEX attendance_user_idx       ON session_attendance (user_id);

CREATE INDEX recording_course_idx      ON recording (course_id, position);
CREATE INDEX recording_lesson_idx      ON recording (lesson_id) WHERE lesson_id IS NOT NULL;

CREATE INDEX enrollment_user_idx       ON enrollment (user_id, status);
CREATE INDEX enrollment_course_idx     ON enrollment (course_id, status);
CREATE INDEX order_user_idx            ON course_order (user_id, created_at DESC);
CREATE INDEX order_status_idx          ON course_order (status, created_at DESC);

CREATE INDEX progress_user_course_idx  ON progress (user_id, course_id);
CREATE INDEX progress_node_idx         ON progress (node_type, node_id);
CREATE INDEX progress_activity_idx     ON progress (last_activity_at DESC);

CREATE INDEX exercise_attempt_user_idx ON exercise_attempt (user_id, exercise_id, created_at DESC);
CREATE INDEX assignment_course_idx     ON assignment (course_id, due_at DESC);
CREATE INDEX submission_assignment_idx ON submission (assignment_id, status);
CREATE INDEX submission_user_idx       ON submission (user_id, submitted_at DESC);
CREATE INDEX submission_pending_idx    ON submission (assignment_id) WHERE status = 'submitted';

CREATE INDEX quiz_attempt_user_idx     ON quiz_attempt (user_id, quiz_id);
CREATE INDEX quiz_answer_attempt_idx   ON quiz_answer (attempt_id);

CREATE INDEX certificate_user_idx      ON certificate (user_id);
CREATE INDEX achievement_user_idx      ON achievement (user_id);
CREATE INDEX notification_user_idx     ON notification (user_id, created_at DESC);
CREATE INDEX notification_unread_idx   ON notification (user_id) WHERE read_at IS NULL;

CREATE INDEX audit_time_idx            ON audit_log (occurred_at DESC);
CREATE INDEX audit_actor_idx           ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX audit_entity_idx          ON audit_log (entity_type, entity_id);
