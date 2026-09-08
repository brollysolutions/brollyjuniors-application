-- ===========================================================================
-- Public aggregates.
--
-- The catalogue wants to say "1,204 learners" as social proof, but enrolment
-- rows are private — the RLS policy shows a student only their own, which is
-- why an anonymous count came back as zero.
--
-- The fix is a narrow, deliberate exception rather than loosening the policy:
-- a SECURITY DEFINER function that can only ever return a NUMBER. There is no
-- shape of call that gets a row out of it, so the aggregate is public and the
-- rows behind it stay private.
--
-- Only this file and 006 step around row-level security, and between them they
-- are four functions long on purpose. Every one of them returns numbers or a
-- yes/no, never a row. entitlement.test.ts asserts the list, so a fifth cannot
-- appear without somebody deciding it should.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public_learner_count(cid uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM enrollment WHERE course_id = cid
$$;

CREATE OR REPLACE FUNCTION public_completion_count(cid uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM enrollment WHERE course_id = cid AND status = 'completed'
$$;

/** Verify a certificate without exposing the certificate table. */
CREATE OR REPLACE FUNCTION public_verify_certificate(vcode text)
RETURNS TABLE (holder text, course text, serial text, issued_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.full_name, co.title, cert.serial, cert.issued_at
    FROM certificate cert
    JOIN app_user u ON u.id = cert.user_id
    JOIN course co ON co.id = cert.course_id
   WHERE cert.verification_code = vcode
$$;

GRANT EXECUTE ON FUNCTION public_learner_count(uuid) TO brolly_app;
GRANT EXECUTE ON FUNCTION public_completion_count(uuid) TO brolly_app;
GRANT EXECUTE ON FUNCTION public_verify_certificate(text) TO brolly_app;
