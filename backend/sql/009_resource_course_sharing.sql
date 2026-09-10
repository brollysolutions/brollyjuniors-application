-- Selecting a course shares its resources with its current students/teachers.
-- Manual assignments apply only when no course is selected.
DROP POLICY r ON resource;
CREATE POLICY r ON resource FOR SELECT USING (
  is_admin() OR (
    status = 'published' AND (
      (course_id IS NOT NULL AND (
        (app_role() = 'STUDENT' AND entitled(course_id)) OR
        (app_role() = 'TEACHER' AND teaches(course_id))
      )) OR
      (course_id IS NULL AND app_role() IN ('TEACHER', 'STUDENT') AND EXISTS (
        SELECT 1 FROM resource_recipient rr
         WHERE rr.resource_id = resource.id AND rr.user_id = app_user_id()
      ))
    )
  )
);

-- Do not revive old manual recipients if a course is later removed/deleted.
DELETE FROM resource_recipient rr USING resource r
 WHERE rr.resource_id = r.id AND r.course_id IS NOT NULL;
