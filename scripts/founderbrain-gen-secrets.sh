#!/usr/bin/env bash
# Generate FounderBrain staging secrets into a directory. Prints paths only — never values.
# Usage: ./scripts/founderbrain-gen-secrets.sh [output-dir]
set -euo pipefail

OUT="${1:-/tmp/founderbrain-secrets-$$}"
umask 077
mkdir -p "$OUT"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required" >&2
  exit 1
fi

openssl rand -base64 32 >"$OUT/GE_MASTER_KEY"
openssl rand -hex 32 >"$OUT/ORIGIN_SECRET"
openssl rand -base64 24 | tr -d '\n' >"$OUT/FB_RUNTIME_PASSWORD"
echo >>"$OUT/FB_RUNTIME_PASSWORD"
openssl rand -base64 24 | tr -d '\n' >"$OUT/FB_WORKER_PASSWORD"
echo >>"$OUT/FB_WORKER_PASSWORD"

cat >"$OUT/README.txt" <<EOF
FounderBrain secret files (mode 600 directory contents).
Load into a password manager, then into Railway / Wrangler secrets.
Do not commit this directory. Do not paste values into GitHub or chat.

Files:
  GE_MASTER_KEY          -> Railway API (and escrow offline)
  ORIGIN_SECRET          -> Railway API + wrangler secret put ORIGIN_SECRET
  FB_RUNTIME_PASSWORD    -> Postgres role fb_runtime / DATABASE_URL user
  FB_WORKER_PASSWORD     -> Postgres role fb_worker / worker DATABASE_URL user

Next: scripts/founderbrain-create-db-roles.sh with MIGRATION_DATABASE_URL set.
EOF

chmod 600 "$OUT"/* || true
echo "Wrote secret files under: $OUT"
echo "Contents (names only):"
ls -1 "$OUT"
