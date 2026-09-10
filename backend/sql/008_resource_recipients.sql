-- Library resources are private until an admin explicitly selects recipients.
-- Existing resources get no implicit recipients. Admins can still manage them.
CREATE TABLE resource_recipient (
  resource_id uuid NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, user_id)
);
CREATE INDEX resource_recipient_user_idx ON resource_recipient (user_id, resource_id);
ALTER TABLE resource_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_recipient FORCE ROW LEVEL SECURITY;
CREATE POLICY r ON resource_recipient FOR SELECT USING (is_admin() OR user_id = app_user_id());
CREATE POLICY w ON resource_recipient FOR ALL USING (is_admin()) WITH CHECK (is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_recipient TO brolly_app;

DROP POLICY r ON resource;
CREATE POLICY r ON resource FOR SELECT USING (
  is_admin() OR (
    status = 'published' AND app_role() IN ('TEACHER', 'STUDENT')
    AND EXISTS (SELECT 1 FROM resource_recipient rr
                 WHERE rr.resource_id = resource.id AND rr.user_id = app_user_id())
  )
);

-- Keep this marker after a resource/attachment is removed: old signed links
-- must never bypass recipient checks or become usable again after deletion.
ALTER TABLE media_asset ADD COLUMN library_only boolean NOT NULL DEFAULT false;
UPDATE media_asset SET library_only = true, visibility = 'protected'
 WHERE id IN (SELECT media_asset_id FROM resource WHERE media_asset_id IS NOT NULL);
