-- Founder voice samples for the Brain's voice capture (original intake Path A/B:
-- 10-20 of their own writing). Content is founder work product: one row per
-- sample, RLS-bound to the founder like every founder table.
CREATE TABLE IF NOT EXISTS fb_voice_sample (
  id text PRIMARY KEY,
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fb_voice_sample ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_voice_sample FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_voice_sample_tenant ON fb_voice_sample;
CREATE POLICY fb_voice_sample_tenant ON fb_voice_sample
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));
