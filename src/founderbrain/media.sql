-- Founder media for the 30 pieces: their own uploads, or images and video made
-- with their own Higgsfield key. Files live in the private R2 bucket; rows hold
-- the object key and status only. RLS-bound to the founder like every founder table.
CREATE TABLE IF NOT EXISTS fb_media (
  id text PRIMARY KEY,
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  piece_n integer CHECK (piece_n IS NULL OR (piece_n >= 1 AND piece_n <= 30)),
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  source text NOT NULL CHECK (source IN ('upload', 'higgsfield')),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  object_key text NOT NULL,
  content_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  prompt text,
  model text,
  provider_request_id text,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fb_media_founder_idx ON fb_media(founder_id, created_at DESC);
ALTER TABLE fb_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_media FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_media_tenant ON fb_media;
CREATE POLICY fb_media_tenant ON fb_media
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));

-- The founder's own Higgsfield key. Key material lives only in ge_blob (sealed with
-- the founder's data key). spent_usd counts estimates of accepted generations so the
-- per-founder cap holds even though Higgsfield bills the founder directly.
CREATE TABLE IF NOT EXISTS fb_higgsfield_key (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  key_blob_sha char(64) NOT NULL,
  key_hint text NOT NULL,
  cap_usd numeric(10,2) NOT NULL DEFAULT 50 CHECK (cap_usd > 0),
  spent_usd numeric(10,4) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (founder_id, key_blob_sha) REFERENCES ge_blob(founder_id, sha)
);
ALTER TABLE fb_higgsfield_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_higgsfield_key FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_higgsfield_key_tenant ON fb_higgsfield_key;
CREATE POLICY fb_higgsfield_key_tenant ON fb_higgsfield_key
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));
