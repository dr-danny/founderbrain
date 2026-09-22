-- Apollo connection for B2B founders. The API key is sealed in ge_blob; the
-- row carries only its hash and the read verdicts. Plaintext never reaches the
-- browser, a log line or an error. sequences_readable records whether the key
-- could read the campaign search endpoint at Connect time (403 for a
-- non-master key), so the sequence-health run can say what it will and will
-- not see before it reads.
CREATE TABLE IF NOT EXISTS fb_apollo_connection (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  key_blob_sha char(64) NOT NULL,
  sequences_readable boolean,
  checked_at timestamptz NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (founder_id, key_blob_sha) REFERENCES ge_blob(founder_id, sha)
);
ALTER TABLE fb_apollo_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_apollo_connection FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_apollo_connection_tenant ON fb_apollo_connection;
CREATE POLICY fb_apollo_connection_tenant ON fb_apollo_connection
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));