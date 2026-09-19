-- Actual usage ledger: one row per metered AI or Firecrawl action.
-- cost_microusd is what the provider charged us; price_microusd is what the
-- founder pays, computed at record time from PRICE_* config. Neither is
-- derived later, so rate changes only affect future events.
CREATE TABLE IF NOT EXISTS fb_usage_event (
  id text PRIMARY KEY,
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ai_tokens', 'ai_extract', 'firecrawl_scrape', 'voice_transcribe')),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  credits bigint CHECK (credits IS NULL OR credits >= 0),
  cost_microusd bigint NOT NULL DEFAULT 0 CHECK (cost_microusd >= 0),
  price_microusd bigint NOT NULL DEFAULT 0 CHECK (price_microusd >= 0),
  job_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fb_usage_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_usage_event FORCE ROW LEVEL SECURITY;
-- Widen the kind check in place for existing installs (2026-09-19: voice_transcribe).
ALTER TABLE fb_usage_event DROP CONSTRAINT IF EXISTS fb_usage_event_kind_check;
ALTER TABLE fb_usage_event ADD CONSTRAINT fb_usage_event_kind_check
  CHECK (kind IN ('ai_tokens', 'ai_extract', 'firecrawl_scrape', 'voice_transcribe'));
DROP POLICY IF EXISTS fb_usage_tenant ON fb_usage_event;
CREATE POLICY fb_usage_tenant ON fb_usage_event
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));
