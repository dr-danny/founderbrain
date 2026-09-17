#!/usr/bin/env bash
# Start disposable Postgres 16 for FounderBrain local tests / fb:dev.
# Mirrors CI: creates fb_runtime + fb_worker, runs migrations twice.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="${FB_LOCAL_PG_NAME:-founderbrain-pg}"
PORT="${FB_LOCAL_PG_PORT:-54329}"
ADMIN_URL="postgresql://postgres:local-dev-only@127.0.0.1:${PORT}/founderbrain"
RUNTIME_URL="postgresql://fb_runtime:local-runtime-only@127.0.0.1:${PORT}/founderbrain"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for scripts/founderbrain-local-db.sh" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    docker start "$NAME" >/dev/null
  else
    docker run -d --name "$NAME" \
      -e POSTGRES_PASSWORD=local-dev-only \
      -e POSTGRES_DB=founderbrain \
      -p "${PORT}:5432" \
      postgres:16 >/dev/null
  fi
fi

echo "Waiting for Postgres on port ${PORT}…"
for _ in $(seq 1 40); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.5
done
docker exec "$NAME" pg_isready -U postgres >/dev/null

docker exec -i "$NAME" psql -U postgres -d founderbrain -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_runtime') THEN
    CREATE ROLE fb_runtime LOGIN PASSWORD 'local-runtime-only' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_worker') THEN
    CREATE ROLE fb_worker LOGIN PASSWORD 'local-worker-only' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
SQL

export MIGRATION_DATABASE_URL="$ADMIN_URL"
RUNTIME_DB_ROLE=fb_runtime npm run fb:migrate
RUNTIME_DB_ROLE=fb_worker npm run fb:migrate

cat <<EOF
Local FounderBrain Postgres is ready.

  MIGRATION_DATABASE_URL=$ADMIN_URL
  FB_TEST_DATABASE_URL=$RUNTIME_URL
  DATABASE_URL=$RUNTIME_URL

Example local demo API:

  export DATABASE_URL='$RUNTIME_URL'
  export FB_TEST_DATABASE_URL='$RUNTIME_URL'
  export GE_MASTER_KEY="\$(openssl rand -base64 32)"
  export APP_ORIGIN=http://127.0.0.1:8080
  export FOUNDERBRAIN_LOCAL_DEMO=true
  export NODE_ENV=development
  export AI_ENABLED=false
  npm run fb:dev

Stop with: docker stop $NAME
EOF
