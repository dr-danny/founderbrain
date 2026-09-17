#!/usr/bin/env bash
# Create restricted Postgres roles and run FounderBrain migrations + grants.
# Requires: MIGRATION_DATABASE_URL, FB_RUNTIME_PASSWORD, FB_WORKER_PASSWORD
# Optional: FB_SKIP_CREATE_ROLES=1 if roles already exist.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${MIGRATION_DATABASE_URL:-}" ]]; then
  echo "MIGRATION_DATABASE_URL is required (admin URL; never the API runtime URL)." >&2
  exit 1
fi
if [[ -z "${FB_RUNTIME_PASSWORD:-}" || -z "${FB_WORKER_PASSWORD:-}" ]]; then
  echo "FB_RUNTIME_PASSWORD and FB_WORKER_PASSWORD are required (from founderbrain-gen-secrets.sh)." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required on PATH." >&2
  exit 1
fi

# Reject characters that would break dollar-quoting or role identifiers.
assert_safe_password() {
  local name="$1" pass="$2"
  if [[ "$pass" == *\$* || "$pass" == *$'\n'* || "$pass" == *$'\r'* ]]; then
    echo "$name must not contain \$ or newlines. Re-run founderbrain-gen-secrets.sh." >&2
    exit 1
  fi
}
assert_safe_password FB_RUNTIME_PASSWORD "$FB_RUNTIME_PASSWORD"
assert_safe_password FB_WORKER_PASSWORD "$FB_WORKER_PASSWORD"

create_role() {
  local role="$1"
  local pass="$2"
  local tag="fb$(openssl rand -hex 8)"
  if psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname = '$role'" | grep -qx 1; then
    echo "Role $role already exists; leaving password unchanged."
    return 0
  fi
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE ${role} LOGIN PASSWORD \$${tag}\$${pass}\$${tag}\$ NOSUPERUSER NOBYPASSRLS;"
  echo "Created role $role (NOSUPERUSER NOBYPASSRLS)."
}

if [[ "${FB_SKIP_CREATE_ROLES:-0}" != "1" ]]; then
  create_role fb_runtime "$FB_RUNTIME_PASSWORD"
  create_role fb_worker "$FB_WORKER_PASSWORD"
fi

echo "Running migrations + grants for fb_runtime…"
RUNTIME_DB_ROLE=fb_runtime npm run fb:migrate
echo "Running migrations + grants for fb_worker…"
RUNTIME_DB_ROLE=fb_worker npm run fb:migrate

echo "Verifying role attributes…"
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('fb_runtime','fb_worker') ORDER BY 1;"

echo "Done. Point API DATABASE_URL at fb_runtime and worker DATABASE_URL at fb_worker."
