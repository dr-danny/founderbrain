#!/usr/bin/env bash
# Validate AI enablement env before setting AI_ENABLED=true / starting the worker.
# Reads the current environment (or a sourced file). Prints pass/fail only — not secret values.
# Usage: ./scripts/founderbrain-ai-enable-check.sh
set -euo pipefail

fail=0
need() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "MISSING $name"
    fail=1
  else
    echo "OK      $name (set, value withheld)"
  fi
}

# Runner model may be AI_MODEL_RUNNER or legacy AI_MODEL alias.
if [[ -z "${AI_MODEL_RUNNER:-}" && -z "${AI_MODEL:-}" ]]; then
  echo "MISSING AI_MODEL_RUNNER (or AI_MODEL alias)"
  fail=1
else
  echo "OK      AI_MODEL_RUNNER/AI_MODEL (set, value withheld)"
fi

need AI_INPUT_USD_PER_MILLION
need AI_OUTPUT_USD_PER_MILLION
need AI_WORKSPACE_DAILY_MICROUSD
need AI_GLOBAL_DAILY_MICROUSD
need OPENROUTER_MANAGEMENT_KEY

# Numeric sanity without printing values
for name in AI_INPUT_USD_PER_MILLION AI_OUTPUT_USD_PER_MILLION; do
  val="${!name:-}"
  if [[ -n "$val" ]] && ! awk -v v="$val" 'BEGIN{exit !(v+0>0)}'; then
    echo "INVALID $name must be a positive number"
    fail=1
  fi
done
for name in AI_WORKSPACE_DAILY_MICROUSD AI_GLOBAL_DAILY_MICROUSD; do
  val="${!name:-}"
  if [[ -n "$val" ]] && ! [[ "$val" =~ ^[1-9][0-9]*$ ]]; then
    echo "INVALID $name must be a positive integer (microUSD)"
    fail=1
  fi
done

if [[ "${AI_ENABLED:-false}" == "true" ]]; then
  echo "NOTE    AI_ENABLED is already true — confirm API and worker both have matching model/rates/caps."
else
  echo "NOTE    AI_ENABLED is not true yet — set it only after this check passes on both services."
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "OK      DATABASE_URL is set (worker must use fb_worker; API must use fb_runtime — verify outside this script)"
else
  echo "MISSING DATABASE_URL (worker needs fb_worker URL)"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "AI enablement check FAILED. Do not start the worker or set AI_ENABLED=true."
  exit 1
fi

echo "AI enablement check PASSED. Set identical model/rate/cap vars on API + worker,"
echo "OPENROUTER_MANAGEMENT_KEY on API (provision/revoke) and worker can read per-user keys from DB,"
echo "AI_ENABLED=true on both, then start the worker service."
echo "Per-user keys: OneDay-Founderbrain-{email}, \$20 lifetime (no reset), 30-day expiry."
