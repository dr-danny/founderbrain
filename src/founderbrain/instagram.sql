-- Sealed Instagram Login token. Plaintext never reaches the browser.
-- Read-only: instagram_business_basic. Nothing is published from this row.
CREATE TABLE IF NOT EXISTS fb_instagram_connection (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  ig_user_id text NOT NULL,
  username text NOT NULL,
  token_blob_sha char(64) NOT NULL,
  expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (founder_id, token_blob_sha) REFERENCES ge_blob(founder_id, sha)
);
ALTER TABLE fb_instagram_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_instagram_connection FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_instagram_connection_tenant ON fb_instagram_connection;
CREATE POLICY fb_instagram_connection_tenant ON fb_instagram_connection
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));

-- Existing installs created fb_media before Instagram was a source.
ALTER TABLE fb_media DROP CONSTRAINT IF EXISTS fb_media_source_check;
ALTER TABLE fb_media ADD CONSTRAINT fb_media_source_check
  CHECK (source IN ('upload', 'higgsfield', 'instagram'));
