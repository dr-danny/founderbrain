-- First-login orientation and later Typeform chapter progress.
-- Structured only; never stored in Brain markdown. Fail closed: missing row = incomplete.
CREATE TABLE IF NOT EXISTS fb_orientation (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  first_login_screen smallint NOT NULL DEFAULT 1
    CHECK (first_login_screen BETWEEN 1 AND 4),
  first_login_completed_at timestamptz,
  track text CHECK (track IS NULL OR track IN ('b2b', 'b2c')),
  content_screen smallint NOT NULL DEFAULT 1
    CHECK (content_screen BETWEEN 1 AND 6),
  content_completed_at timestamptz,
  content_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  outreach_screen smallint NOT NULL DEFAULT 1
    CHECK (outreach_screen BETWEEN 1 AND 3),
  outreach_completed_at timestamptz,
  outreach_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ghl_screen smallint NOT NULL DEFAULT 1,
  ghl_completed_at timestamptz,
  ghl_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fb_orientation ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_orientation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_orientation_tenant ON fb_orientation;
CREATE POLICY fb_orientation_tenant ON fb_orientation
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));

ALTER TABLE fb_orientation ADD COLUMN IF NOT EXISTS ghl_screen smallint NOT NULL DEFAULT 1;
ALTER TABLE fb_orientation ADD COLUMN IF NOT EXISTS ghl_completed_at timestamptz;
ALTER TABLE fb_orientation ADD COLUMN IF NOT EXISTS ghl_answers jsonb NOT NULL DEFAULT '{}'::jsonb;
