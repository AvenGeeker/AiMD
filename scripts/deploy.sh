#!/usr/bin/env bash
#
# One-command deployment for aiMarkdown.
#
#   ./scripts/deploy.sh                 # first run: generate .env, build, start, health-check
#   ./scripts/deploy.sh --rebuild       # pull/rebuild images and restart
#   ./scripts/deploy.sh --no-build      # use APP_IMAGE from .env instead of building locally
#
# Safe to re-run: secrets in deploy/.env are preserved, migrations are idempotent and run at
# container start, and volumes are never touched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/deploy"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"
ENV_FILE="${DEPLOY_DIR}/.env"

REBUILD=0
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    --no-build) NO_BUILD=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

info()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[32m  ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m  !\033[0m %s\n' "$*"; }
fail()  { printf '\033[31m  ✗\033[0m %s\n' "$*" >&2; exit 1; }

# Docker Compose v2 is a plugin; v1 is a separate binary.
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  fail "docker compose not found. Install Docker Engine with the Compose v2 plugin."
fi

info "Preflight checks"
command -v docker >/dev/null 2>&1 || fail "docker CLI not found."
docker info >/dev/null 2>&1 || fail "cannot reach the Docker daemon. Is Docker running, and are you in the docker group?"
ok "docker daemon reachable ($(docker version --format '{{.Server.Version}}' 2>/dev/null || echo unknown))"
[[ -f "$COMPOSE_FILE" ]] || fail "missing ${COMPOSE_FILE}"
ok "compose file present"

# Port availability. Only warn: another reverse proxy in front is a legitimate setup, and the
# ports are overridable via HTTP_PORT / HTTPS_PORT in deploy/.env.
for port in "${HTTP_PORT:-80}" "${HTTPS_PORT:-443}"; do
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    warn "port $port is already in use — set HTTP_PORT/HTTPS_PORT in ${ENV_FILE}, or front aiMarkdown with your existing proxy"
  fi
done

# ---------------------------------------------------------------------------
# .env
# ---------------------------------------------------------------------------
rand() { openssl rand -hex "${1:-32}"; }

if [[ ! -f "$ENV_FILE" ]]; then
  info "Creating ${ENV_FILE}"
  cp "${DEPLOY_DIR}/.env.example" "$ENV_FILE"

  # Ask for the hostname unless it was supplied in the environment (CI / scripted installs).
  if [[ -n "${PUBLIC_URL:-}" ]]; then
    HOSTNAME_VALUE="$PUBLIC_URL"
  else
    read -r -p "  Public hostname for this deployment (e.g. notes.example.com): " HOSTNAME_VALUE
    HOSTNAME_VALUE="${HOSTNAME_VALUE:-localhost}"
  fi
  read -r -p "  Email for Let's Encrypt notices (optional): " ACME_EMAIL_VALUE

  JWT_SECRET_VALUE="$(rand 48)"
  POSTGRES_PASSWORD_VALUE="$(rand 24)"

  # Rewrite the placeholders in place; | is used as the sed delimiter because secrets contain /.
  sed -i.bak \
    -e "s|^PUBLIC_URL=.*|PUBLIC_URL=${HOSTNAME_VALUE}|" \
    -e "s|^ACME_EMAIL=.*|ACME_EMAIL=${ACME_EMAIL_VALUE}|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET_VALUE}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD_VALUE}|" \
    "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
  chmod 600 "$ENV_FILE"
  ok "generated JWT_SECRET and POSTGRES_PASSWORD"
  warn "save a copy of ${ENV_FILE} — losing JWT_SECRET signs every user out"
else
  info "Reusing existing ${ENV_FILE}"
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
[[ -n "${JWT_SECRET:-}" ]] || fail "JWT_SECRET is empty in ${ENV_FILE}"
[[ ${#JWT_SECRET} -ge 32 ]] || fail "JWT_SECRET must be at least 32 characters"
[[ -n "${POSTGRES_PASSWORD:-}" ]] || fail "POSTGRES_PASSWORD is empty in ${ENV_FILE}"
[[ -n "${PUBLIC_URL:-}" ]] || fail "PUBLIC_URL is empty in ${ENV_FILE}"
ok "environment validated (PUBLIC_URL=${PUBLIC_URL})"

# ---------------------------------------------------------------------------
# Bring the stack up
# ---------------------------------------------------------------------------
cd "$DEPLOY_DIR"

UP_ARGS=(-d)
if [[ "$REBUILD" == "1" ]]; then UP_ARGS+=(--build --force-recreate); fi
if [[ "$NO_BUILD" == "1" ]]; then
  [[ -n "${APP_IMAGE:-}" ]] || fail "--no-build requires APP_IMAGE in ${ENV_FILE}"
  info "Using prebuilt image ${APP_IMAGE}"
else
  info "Building application image (this can take a few minutes on a small VPS)"
fi

# A pull failure on a mainland-China network is almost always Docker Hub being unreachable.
# Detect it and print the fix instead of a raw stack trace.
set +e
if [[ "$NO_BUILD" == "1" ]]; then
  "${COMPOSE[@]}" --env-file "$ENV_FILE" up "${UP_ARGS[@]}"
else
  "${COMPOSE[@]}" --env-file "$ENV_FILE" up "${UP_ARGS[@]}" --build
fi
UP_STATUS=$?
set -e

if [[ "$UP_STATUS" != "0" ]]; then
  echo
  warn "compose failed. If the error mentions a timeout pulling from docker.io / registry-1.docker.io:"
  warn "  1. merge deploy/daemon.json.mirror's registry-mirrors into /etc/docker/daemon.json"
  warn "  2. sudo systemctl restart docker"
  warn "  3. re-run ./scripts/deploy.sh"
  warn "Or build elsewhere and transfer the image:"
  warn "  docker build -t aimarkdown-app:local . && docker save aimarkdown-app:local | gzip > app.tar.gz"
  warn "  # on the server: gunzip -c app.tar.gz | docker load"
  exit "$UP_STATUS"
fi

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
info "Waiting for the app to become healthy"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"
HEALTHY=0
STATUS=""
HEALTH_BODY=""
for _ in $(seq 1 60); do
  # Probe over HTTP first (works for localhost/self-signed and before a cert is issued), then
  # fall back to HTTPS with the CA check relaxed for a freshly issued Let's Encrypt cert.
  HEALTH_BODY="$(curl -sS --max-time 5 \
    --resolve "${PUBLIC_URL}:${HTTP_PORT}:127.0.0.1" \
    "http://${PUBLIC_URL}:${HTTP_PORT}/api/health" 2>/dev/null || true)"
  if [[ -z "$HEALTH_BODY" && "$HTTPS_PORT" != "$HTTP_PORT" ]]; then
    HEALTH_BODY="$(curl -sSk --max-time 5 \
      --resolve "${PUBLIC_URL}:${HTTPS_PORT}:127.0.0.1" \
      "https://${PUBLIC_URL}:${HTTPS_PORT}/api/health" 2>/dev/null || true)"
  fi
  STATUS="$(printf '%s' "$HEALTH_BODY" | grep -o '"status":"ok"' || true)"
  if [[ -n "$STATUS" ]]; then HEALTHY=1; break; fi
  sleep 2
  printf '.'
done
echo

if [[ "$HEALTHY" != "1" ]]; then
  warn "health probe did not return 200 (last status: ${STATUS:-none})"
  warn "check logs with: docker compose -f ${COMPOSE_FILE} logs --tail=100 app"
  "${COMPOSE[@]}" --env-file "$ENV_FILE" ps || true
  exit 1
fi
ok "healthy — ${HEALTH_BODY}"

echo
info "Deployment complete"
SUFFIX=""
[[ "${HTTPS_PORT:-443}" != "443" ]] && SUFFIX=":${HTTPS_PORT}"
[[ "${HTTP_PORT:-80}" != "80" && -z "$SUFFIX" ]] && SUFFIX=":${HTTP_PORT}"
if [[ "$PUBLIC_URL" == "localhost" || "$PUBLIC_URL" == "127.0.0.1" ]]; then
  echo "  Web app:   http://${PUBLIC_URL}${SUFFIX}/"
else
  echo "  Web app:   https://${PUBLIC_URL}${SUFFIX}/"
fi
echo "  API:       /api   Collaboration WS: /collab"
echo
if [[ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ]]; then
  echo "  Admin account: ${BOOTSTRAP_ADMIN_EMAIL} (password from ${ENV_FILE})"
fi
if [[ "${ALLOW_REGISTRATION:-true}" == "true" ]]; then
  echo "  Registration is OPEN. Create your account, then set ALLOW_REGISTRATION=false"
  echo "  in ${ENV_FILE} and re-run this script to lock it down."
fi
echo
echo "  Useful commands:"
echo "    logs:    docker compose -f ${COMPOSE_FILE} logs -f app"
echo "    backup:  ./scripts/backup.sh"
echo "    stop:    docker compose -f ${COMPOSE_FILE} down"
