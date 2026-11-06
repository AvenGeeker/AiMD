#!/usr/bin/env bash
#
# Local development: Postgres (Docker) + API server (tsx watch) + Vite dev server.
#
#   ./scripts/dev.sh          # everything
#   ./scripts/dev.sh api      # only the API server
#   ./scripts/dev.sh web      # only Vite
#
# The desktop shell is started separately with `pnpm --filter @aimarkdown/desktop dev`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${1:-all}"
DEV_DB_PORT="${DEV_DB_PORT:-5433}"

ensure_db() {
  echo "==> starting Postgres on :${DEV_DB_PORT}"
  docker compose -f deploy/docker-compose.dev.yml up -d postgres
  for _ in $(seq 1 30); do
    if docker exec aimarkdown-dev-postgres pg_isready -U aimarkdown >/dev/null 2>&1; then
      echo "  ✓ postgres ready"
      return 0
    fi
    sleep 1
  done
  echo "  ✗ postgres did not become ready" >&2
  exit 1
}

run_api() {
  echo "==> API server (http://127.0.0.1:3000)"
  cd apps/server
  set -a
  export NODE_ENV=development
  export HOST=127.0.0.1
  export REST_PORT=3000
  export COLLAB_PORT=1234
  export DATABASE_URL="postgres://aimarkdown:aimarkdown_dev@127.0.0.1:${DEV_DB_PORT}/aimarkdown"
  export JWT_SECRET="${JWT_SECRET:-dev-secret-0123456789abcdef0123456789abcdef}"
  export UPLOAD_DIR="./data/dev-uploads"
  # Public links must point at the Vite-served UI in development. The API origin (:3000) has no
  # SPA bundle, so a share URL built from it would open a JSON 404.
  export PUBLIC_URL="http://127.0.0.1:5173"
  export CORS_ORIGIN="http://127.0.0.1:5173,http://localhost:5173"
  export WEB_DIST_DIR=""
  # Vite proxies /collab to the Hocuspocus port, so the browser can stay same-origin in dev.
  export COLLAB_PUBLIC_URL=""
  export LOG_LEVEL=info
  set +a
  exec pnpm dev
}

run_web() {
  echo "==> Vite dev server (http://127.0.0.1:5173)"
  cd apps/web
  exec pnpm dev
}

case "$TARGET" in
  api) ensure_db; run_api ;;
  web) run_web ;;
  all)
    ensure_db
    # concurrently is a root devDependency; fall back to background jobs if it is missing.
    if command -v pnpm >/dev/null 2>&1 && [[ -d node_modules/.pnpm ]]; then
      trap 'kill 0' EXIT
      ( run_api ) &
      ( run_web ) &
      wait
    else
      run_api
    fi
    ;;
  *) echo "usage: $0 [all|api|web]" >&2; exit 2 ;;
esac
