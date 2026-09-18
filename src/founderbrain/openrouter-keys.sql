-- Per-founder OpenRouter API key metadata. Plaintext key material lives only in
-- ge_blob (encrypted). Never expose key_hash lookups or ciphertext to the browser.
CREATE TABLE IF NOT EXISTS fb_openrouter_key (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  key_name text NOT NULL,
  key_blob_sha char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  lifetime_limit_usd numeric(10,2) NOT NULL DEFAULT 20 CHECK (lifetime_limit_usd > 0),
  spent_microusd bigint NOT NULL DEFAULT 0 CHECK (spent_microusd >= 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (founder_id, key_blob_sha) REFERENCES ge_blob(founder_id, sha)
);
CREATE UNIQUE INDEX IF NOT EXISTS fb_openrouter_key_hash_uidx ON fb_openrouter_key(key_hash);
ALTER TABLE fb_openrouter_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_openrouter_key FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_openrouter_key_tenant ON fb_openrouter_key;
CREATE POLICY fb_openrouter_key_tenant ON fb_openrouter_key
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));
