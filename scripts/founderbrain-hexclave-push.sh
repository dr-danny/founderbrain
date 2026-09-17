#!/usr/bin/env bash
# Pull Hexclave project config, diff against repo hexclave.config.ts, push on confirmation.
# Requires: HEXCLAVE_PROJECT_ID, and an authenticated `npx @hexclave/cli` session.
# Usage:
#   ./scripts/founderbrain-hexclave-push.sh           # interactive confirm before push
#   ./scripts/founderbrain-hexclave-push.sh --yes      # push after showing diff (CI/operator)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

YES=0
if [[ "${1:-}" == "--yes" ]]; then YES=1; fi

if [[ -z "${HEXCLAVE_PROJECT_ID:-}" ]]; then
  echo "HEXCLAVE_PROJECT_ID (project UUID) is required." >&2
  exit 1
fi
if [[ ! -f hexclave.config.ts ]]; then
  echo "hexclave.config.ts missing at repo root." >&2
  exit 1
fi

REVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fb-hexclave-XXXXXX")"
cleanup() { rm -rf "$REVIEW_DIR"; }
trap cleanup EXIT

echo "Pulling live config for project $HEXCLAVE_PROJECT_ID into a scratch dir…"
npx --yes @hexclave/cli config pull \
  --cloud-project-id "$HEXCLAVE_PROJECT_ID" \
  --config-file "$REVIEW_DIR/current.ts"

echo "Diff (empty means identical):"
set +e
diff -u "$REVIEW_DIR/current.ts" hexclave.config.ts
DIFF_STATUS=$?
set -e
if [[ "$DIFF_STATUS" -gt 1 ]]; then
  echo "diff failed" >&2
  exit "$DIFF_STATUS"
fi

if [[ "$DIFF_STATUS" -eq 0 ]]; then
  echo "Remote already matches hexclave.config.ts; nothing to push."
  exit 0
fi

if [[ "$YES" -ne 1 ]]; then
  printf "Push repo hexclave.config.ts to project %s? [y/N] " "$HEXCLAVE_PROJECT_ID"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

npx --yes @hexclave/cli config push \
  --cloud-project-id "$HEXCLAVE_PROJECT_ID" \
  --config-file hexclave.config.ts

echo "Pushed. Add the approved APP_ORIGIN as a trusted domain in the Hexclave dashboard when #15 binds it."
echo "Create pilot users with createUser({ primaryEmail, primaryEmailVerified: true, primaryEmailAuthEnabled: true, otpAuthEnabled: true })."
