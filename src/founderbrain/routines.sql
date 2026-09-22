-- FounderBrain routines: scheduled, draft-only digests (Monday plan, content
-- top-up, readiness digest). One row per generated draft; UNIQUE(founder_id,
-- kind, period_key) makes the sweep idempotent. Draft-only: rows are founder
-- work product, never published, never sent. Tenant RLS with the same
-- fb_worker dispatch exception as fb_job_dispatch (the sweep runs on the
-- dedicated worker role, never the request pool).
CREATE TABLE IF NOT EXISTS fb_routine_draft (
  id text PRIMARY KEY,
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('monday_plan','content_top_up','readiness','sequence_health','what_worked')),
  period_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','read','dismissed')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(founder_id, kind, period_key)
);
ALTER TABLE fb_routine_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_routine_draft FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_routine_draft_tenant ON fb_routine_draft;
CREATE POLICY fb_routine_draft_tenant ON fb_routine_draft
  USING (founder_id = current_setting('app.founder_id', true) OR current_user = 'fb_worker')
  WITH CHECK (founder_id = current_setting('app.founder_id', true) OR current_user = 'fb_worker');

-- Per-founder routine preferences. Created by the web app on sign-in (captures
-- the browser timezone) so the sweep only processes founders who opened the
-- app since routines shipped.
CREATE TABLE IF NOT EXISTS fb_routine_state (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT '',
  monday_plan boolean NOT NULL DEFAULT true,
  content_top_up boolean NOT NULL DEFAULT true,
  readiness_digest boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fb_routine_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_routine_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fb_routine_state_tenant ON fb_routine_state;
CREATE POLICY fb_routine_state_tenant ON fb_routine_state
  USING (founder_id = current_setting('app.founder_id', true) OR current_user = 'fb_worker')
  WITH CHECK (founder_id = current_setting('app.founder_id', true) OR current_user = 'fb_worker');

-- Maintenance reads (2026-09): sequence health (B2B, Apollo) and what worked
-- (both tracks, GoHighLevel Social Planner). Both draft-only like the others.
-- Columns are added idempotently so existing workspaces migrate in place.
ALTER TABLE fb_routine_state ADD COLUMN IF NOT EXISTS sequence_health boolean NOT NULL DEFAULT true;
ALTER TABLE fb_routine_state ADD COLUMN IF NOT EXISTS what_worked boolean NOT NULL DEFAULT true;
-- Widen the draft kind check: fresh installs get the five-kind constraint from
-- the CREATE above; existing databases drop the three-kind one and re-add.
ALTER TABLE fb_routine_draft DROP CONSTRAINT IF EXISTS fb_routine_draft_kind_check;
ALTER TABLE fb_routine_draft ADD CONSTRAINT fb_routine_draft_kind_check
  CHECK (kind IN ('monday_plan','content_top_up','readiness','sequence_health','what_worked'));
