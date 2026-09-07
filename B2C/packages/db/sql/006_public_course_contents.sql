-- ===========================================================================
-- Public course contents.
--
-- The shop window promises "4 recorded tutorials · 3 quizzes · 3 downloadable
-- materials" before anybody pays for the course. Those rows are SUBSTANCE, so
-- the policies on recording, quiz and learning_material admit only a reader who
-- can reach the course — which meant an anonymous shopper counted zero of each
-- and the price box advertised an empty course.
--
-- Same fix as public_learner_count, and for the same reason: a SECURITY DEFINER
-- function that can only ever return NUMBERS. No shape of call gets a title, a
-- body or a link out of it, so the counts are public and the rows behind them
-- stay private.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public_course_contents(cid uuid)
RETURNS TABLE (recordings int, quizzes int, materials int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT count(*)::int FROM recording
           WHERE course_id = cid AND status = 'published'),
         (SELECT count(*)::int FROM quiz WHERE course_id = cid),
         (SELECT count(*)::int FROM learning_material
           WHERE course_id = cid AND status = 'published')
$$;

GRANT EXECUTE ON FUNCTION public_course_contents(uuid) TO brolly_app;
