-- FounderBrain adds identity bindings and write receipts without duplicating the
-- existing encrypted founder/ge storage. Run through runFounderBrainMigrations
-- with a migration/admin role, then run the application with a non-BYPASSRLS role.

CREATE TABLE IF NOT EXISTS fb_user (
  subject text PRIMARY KEY,
  founder_id text NOT NULL UNIQUE REFERENCES founder(id) ON DELETE RESTRICT,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fb_member (
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  subject text NOT NULL REFERENCES fb_user(subject) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'owner' CHECK (role = 'owner'),
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (founder_id, subject)
);

CREATE TABLE IF NOT EXISTS fb_receipt (
  founder_id text NOT NULL REFERENCES founder(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  result_version bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (founder_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS fb_receipt_founder_version_idx ON fb_receipt(founder_id, result_version);

ALTER TABLE fb_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_user FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_member FORCE ROW LEVEL SECURITY;
ALTER TABLE fb_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_receipt FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fb_user_subject_rows ON fb_user;
DROP POLICY IF EXISTS fb_member_subject_rows ON fb_member;
DROP POLICY IF EXISTS fb_receipt_founder_rows ON fb_receipt;

-- Identity binding is scoped only by the authenticated stable issuer+sub value.
CREATE POLICY fb_user_subject_rows ON fb_user
  USING (subject = current_setting('app.subject', true))
  WITH CHECK (subject = current_setting('app.subject', true));

-- Membership resolution never trusts a route-provided founder id.
CREATE POLICY fb_member_subject_rows ON fb_member
  USING (subject = current_setting('app.subject', true))
  WITH CHECK (subject = current_setting('app.subject', true));

-- Receipts contain mutation payload hashes and are scoped only by the storage tenant.
CREATE POLICY fb_receipt_founder_rows ON fb_receipt
  USING (founder_id = current_setting('app.founder_id', true))
  WITH CHECK (founder_id = current_setting('app.founder_id', true));
