-- Encrypted CRM OAuth tokens (HighLevel). Plaintext never reaches the browser.
CREATE TABLE IF NOT EXISTS fb_crm_connection (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  location_id text NOT NULL,
  token_blob_sha char(64) NOT NULL,
  expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (founder_id, token_blob_sha) REFERENCES ge_blob(founder_id, sha)
);
ALTER TABLE fb_crm_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_crm_connection FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_crm_connection_tenant ON fb_crm_connection;
CREATE POLICY fb_crm_connection_tenant ON fb_crm_connection
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));
