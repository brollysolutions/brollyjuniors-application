-- ===========================================================================
-- Notifications are emitted by the system, never authored by a user.
--
-- The policy on `notification` says you may only write your own row, which is
-- right: nobody should be able to plant a message in someone else's feed. But
-- it also blocked the legitimate case — a teacher grades a submission and the
-- student needs to be told.
--
-- Loosening the policy to "a teacher may write to their students" would put a
-- join into a WITH CHECK clause and quietly widen it for every other caller.
-- Instead there is ONE entry point, and it is the only way a notification is
-- ever created:
--
--   notify(recipient, kind, title, body, screen, param)
--
-- It is SECURITY DEFINER, it returns nothing useful, and it cannot read or
-- modify anything else. Application code no longer inserts into the table at
-- all, so "who may notify whom" is answered in one place.
-- ===========================================================================

CREATE OR REPLACE FUNCTION notify(
  recipient   uuid,
  kind        text,
  title       text,
  body        text DEFAULT '',
  link_screen text DEFAULT '',
  link_param  text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  -- The recipient must be a real, live account. Silently dropping a
  -- notification is better than failing the action that produced it, but a
  -- notification to nobody is a bug worth refusing.
  IF NOT EXISTS (SELECT 1 FROM app_user WHERE id = recipient AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'notify: no such recipient';
  END IF;

  INSERT INTO notification (user_id, kind, title, body, link_screen, link_param)
  VALUES (recipient, kind, title, coalesce(body, ''), coalesce(link_screen, ''), coalesce(link_param, ''))
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION notify(uuid, text, text, text, text, text) TO brolly_app;

-- Application code inserts through the function from here on, so take the
-- direct write away entirely.
DROP POLICY IF EXISTS r ON notification;
CREATE POLICY read_own ON notification FOR SELECT
  USING (user_id = app_user_id() OR is_admin());
CREATE POLICY update_own ON notification FOR UPDATE
  USING (user_id = app_user_id() OR is_admin())
  WITH CHECK (user_id = app_user_id() OR is_admin());
CREATE POLICY delete_own ON notification FOR DELETE
  USING (user_id = app_user_id() OR is_admin());
-- Note the absence of an INSERT policy: nothing can write this table directly.
