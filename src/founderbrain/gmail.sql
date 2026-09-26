-- FounderBrain Gmail connector. Sensitive values are ge_blob references.
-- Source sent messages and draft content never appear in relational columns.
CREATE TABLE IF NOT EXISTS fb_gmail_guard (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  connection_epoch bigint NOT NULL DEFAULT 0 CHECK (connection_epoch >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fb_gmail_connection (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  token_blob_sha char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  connection_epoch bigint NOT NULL DEFAULT 0 CHECK (connection_epoch >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (founder_id, token_blob_sha) REFERENCES ge_blob(founder_id, sha)
);
ALTER TABLE fb_gmail_connection ADD COLUMN IF NOT EXISTS connection_epoch bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fb_gmail_oauth_state (
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  state_hash char(64) NOT NULL,
  verifier_blob_sha char(64) NOT NULL,
  connection_epoch bigint NOT NULL DEFAULT 0 CHECK (connection_epoch >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (founder_id, state_hash),
  FOREIGN KEY (founder_id, verifier_blob_sha) REFERENCES ge_blob(founder_id, sha)
);
ALTER TABLE fb_gmail_oauth_state ADD COLUMN IF NOT EXISTS connection_epoch bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fb_gmail_voice (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  profile_blob_sha char(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (founder_id, profile_blob_sha) REFERENCES ge_blob(founder_id, sha)
);

CREATE TABLE IF NOT EXISTS fb_gmail_settings (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  settings_blob_sha char(64) NOT NULL,
  policy_revision bigint NOT NULL DEFAULT 0 CHECK (policy_revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (founder_id, settings_blob_sha) REFERENCES ge_blob(founder_id, sha)
);
ALTER TABLE fb_gmail_settings ADD COLUMN IF NOT EXISTS policy_revision bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fb_gmail_consent (
  founder_id text PRIMARY KEY REFERENCES founder(id) ON DELETE CASCADE,
  selected_sent_analysis_at timestamptz,
  auto_send_confirmed_at timestamptz,
  auto_send_policy_revision bigint CHECK (auto_send_policy_revision IS NULL OR auto_send_policy_revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fb_gmail_consent ADD COLUMN IF NOT EXISTS auto_send_policy_revision bigint;

CREATE TABLE IF NOT EXISTS fb_gmail_draft (
  id uuid NOT NULL,
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  payload_blob_sha char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('drafting','draft','saving','saved','sending','sent','uncertain','failed')),
  gmail_draft_id text,
  gmail_message_id text,
  error text,
  auto_sent boolean NOT NULL DEFAULT false,
  auto_send_eligible boolean NOT NULL DEFAULT false,
  auto_send_policy_revision bigint CHECK (auto_send_policy_revision IS NULL OR auto_send_policy_revision >= 0),
  send_reserved boolean NOT NULL DEFAULT false,
  send_day date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (founder_id, id),
  UNIQUE (founder_id, request_id),
  FOREIGN KEY (founder_id, payload_blob_sha) REFERENCES ge_blob(founder_id, sha),
  CHECK ((send_reserved AND send_day IS NOT NULL) OR (NOT send_reserved))
);
ALTER TABLE fb_gmail_draft ADD COLUMN IF NOT EXISTS auto_send_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE fb_gmail_draft ADD COLUMN IF NOT EXISTS auto_send_policy_revision bigint;
CREATE INDEX IF NOT EXISTS fb_gmail_draft_created_idx ON fb_gmail_draft(founder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fb_gmail_send_day (
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  day date NOT NULL,
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  PRIMARY KEY (founder_id, day)
);

-- Metadata-only audit. No addresses, subjects, bodies, tokens, scopes, or provider payloads.
CREATE TABLE IF NOT EXISTS fb_gmail_audit (
  id uuid PRIMARY KEY,
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (length(event) BETWEEN 1 AND 64),
  outcome text NOT NULL CHECK (length(outcome) BETWEEN 1 AND 64),
  draft_id uuid,
  policy_revision bigint,
  automatic boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fb_gmail_audit_founder_created_idx ON fb_gmail_audit(founder_id, created_at DESC);

ALTER TABLE fb_gmail_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_guard FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_connection FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_oauth_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_oauth_state FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_voice ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_voice FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_consent FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_draft FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_send_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_send_day FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_gmail_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fb_gmail_guard_tenant ON fb_gmail_guard;
CREATE POLICY fb_gmail_guard_tenant ON fb_gmail_guard USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));
DROP POLICY IF EXISTS fb_gmail_connection_tenant ON fb_gmail_connection;
CREATE POLICY fb_gmail_connection_tenant ON fb_gmail_connection USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));
DROP POLICY IF EXISTS fb_gmail_oauth_state_tenant ON fb_gmail_oauth_state;
CREATE POLICY fb_gmail_oauth_state_tenant ON fb_gmail_oauth_state USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));
DROP POLICY IF EXISTS fb_gmail_voice_tenant ON fb_gmail_voice;
CREATE POLICY fb_gmail_voice_tenant ON fb_gmail_voice USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));
DROP POLICY IF EXISTS fb_gmail_settings_tenant ON fb_gmail_settings;
CREATE POLICY fb_gmail_settings_tenant ON fb_gmail_settings USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));
DROP POLICY IF EXISTS fb_gmail_consent_tenant ON fb_gmail_consent;
CREATE POLICY fb_gmail_consent_tenant ON fb_gmail_consent USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));
DROP POLICY IF EXISTS fb_gmail_draft_tenant ON fb_gmail_draft;
CREATE POLICY fb_gmail_draft_tenant ON fb_gmail_draft USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));
DROP POLICY IF EXISTS fb_gmail_send_day_tenant ON fb_gmail_send_day;
CREATE POLICY fb_gmail_send_day_tenant ON fb_gmail_send_day USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));
DROP POLICY IF EXISTS fb_gmail_audit_tenant ON fb_gmail_audit;
CREATE POLICY fb_gmail_audit_tenant ON fb_gmail_audit USING (founder_id=current_setting('app.founder_id',true)) WITH CHECK (founder_id=current_setting('app.founder_id',true));

DO $gmail_grants$
BEGIN
  IF to_regrole('fb_runtime') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON fb_gmail_guard, fb_gmail_connection,
      fb_gmail_oauth_state, fb_gmail_voice, fb_gmail_settings, fb_gmail_consent,
      fb_gmail_draft, fb_gmail_send_day, fb_gmail_audit TO fb_runtime;
  END IF;
  IF to_regrole('fb_worker') IS NOT NULL THEN
    REVOKE ALL ON fb_gmail_guard, fb_gmail_connection, fb_gmail_oauth_state,
      fb_gmail_voice, fb_gmail_settings, fb_gmail_consent, fb_gmail_draft, fb_gmail_send_day, fb_gmail_audit FROM fb_worker;
  END IF;
END
$gmail_grants$;
