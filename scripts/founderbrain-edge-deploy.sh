#!/usr/bin/env bash
# Cloudflare Worker dry-run / upload / optional route bind for FounderBrain.
# Usage:
#   ./scripts/founderbrain-edge-deploy.sh dry-run
#   API_ORIGIN=https://… ORIGIN_SECRET=… ./scripts/founderbrain-edge-deploy.sh upload
#   WORKER_ROUTE='host.example.com/*' ./scripts/founderbrain-edge-deploy.sh bind-route
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-}"
if [[ -z "$MODE" ]]; then
  echo "Usage: $0 dry-run|upload|bind-route" >&2
  exit 1
fi

is_bare_https_origin() {
  local value="$1"
  [[ "$value" =~ ^https://[^/]+$ ]] || return 1
  [[ "$value" != *\?* && "$value" != *\#* && "$value" != *@* ]] || return 1
  return 0
}

case "$MODE" in
  dry-run)
    npm run fb:build
    npx wrangler deploy --dry-run --outdir dist/edge-dry-run
    echo "Dry-run OK. No Worker uploaded; no route bound."
    ;;
  upload)
    if [[ -z "${API_ORIGIN:-}" ]]; then
      echo "API_ORIGIN is required (exact HTTPS Railway API origin)." >&2
      exit 1
    fi
    if ! is_bare_https_origin "$API_ORIGIN"; then
      echo "API_ORIGIN must be a bare https://host origin (no path/query)." >&2
      exit 1
    fi
    if [[ "$API_ORIGIN" == *.invalid ]]; then
      echo "API_ORIGIN still looks like the placeholder (.invalid)." >&2
      exit 1
    fi
    if [[ -z "${ORIGIN_SECRET:-}" || ${#ORIGIN_SECRET} -lt 32 ]]; then
      echo "ORIGIN_SECRET is required (>= 32 chars); will be set via wrangler secret put." >&2
      exit 1
    fi
    HEXCLAVE_API_URL="${HEXCLAVE_API_URL:-https://api.hexclave.com}"
    if ! is_bare_https_origin "$HEXCLAVE_API_URL"; then
      echo "HEXCLAVE_API_URL must be a bare HTTPS origin." >&2
      exit 1
    fi

    npm run fb:build

    # Patch vars for this deploy without committing placeholders back incorrectly:
    # wrangler accepts --var for overrides on deploy.
    echo "Uploading Worker version (workers_dev remains false in wrangler.jsonc; no route unless you run bind-route)…"
    printf '%s' "$ORIGIN_SECRET" | npx wrangler secret put ORIGIN_SECRET
    npx wrangler deploy \
      --var "API_ORIGIN:${API_ORIGIN}" \
      --var "HEXCLAVE_API_URL:${HEXCLAVE_API_URL}"

    echo "Upload requested. Binding a hostname is a separate step: $0 bind-route"
    echo "Then set Railway APP_ORIGIN to the bound HTTPS origin and trust it in Hexclave (#14)."
    ;;
  bind-route)
    if [[ -z "${WORKER_ROUTE:-}" ]]; then
      echo "WORKER_ROUTE is required, e.g. staging.example.com/*" >&2
      exit 1
    fi
    echo "Route binding must be done with an approved hostname."
    echo "Recommended: set routes in the Cloudflare dashboard for Worker 'founderbrain',"
    echo "or temporarily add to wrangler.jsonc after review:"
    echo "  \"routes\": [{ \"pattern\": \"$WORKER_ROUTE\" }]"
    echo "This script refuses to rewrite wrangler.jsonc automatically so an unapproved"
    echo "pattern cannot land in git. Apply the route in the dashboard, then update"
    echo "Railway APP_ORIGIN and Hexclave trusted domains to the exact HTTPS origin."
    exit 0
    ;;
  *)
    echo "Unknown mode: $MODE (expected dry-run|upload|bind-route)" >&2
    exit 1
    ;;
esac
