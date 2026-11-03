#!/usr/bin/env bash
#
# One-command deployment for AiMD.
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
    warn "port $port is already in use — set HTTP_PORT/HTTPS_PORT in ${ENV_FILE}, or front AiMD with your existing proxy"
  fi
done

# ---------------------------------------------------------------------------
# .env
# ---------------------------------------------------------------------------
rand() { openssl rand -hex "${1:-32}"; }

# --- URL helpers: split "https://host:8443/x" into scheme / host / port. ---
url_scheme() { local v="$1"; [[ "$v" =~ ^([a-zA-Z][a-zA-Z0-9+.-]*):// ]] && echo "${BASH_REMATCH[1]}" || echo ""; }
url_host() {
  local v="$1" rest
  v="${v#*://}"
  v="${v%%/*}"
  rest="${v#*@}"
  rest="${rest%%:*}"
  echo "$rest"
}
url_port() {
  local v="$1" host rest
  host="$(url_host "$v")"
  v="${v#*://}"
  v="${v%%/*}"
  rest="${v#*@}"
  rest="${rest#*:}"
  [[ -n "$rest" && "$rest" != "$host" ]] && echo "$rest" || echo ""
}
# Add a scheme when the user gave a bare hostname/IP, defaulting domains to https and IPs to http.
normalize_public_url() {
  local v="$1"
  v="${v%/}"
  if [[ "$v" != *"://"* ]]; then
    if [[ "$v" =~ ^[0-9.]+$ || "$v" == "localhost" || "$v" == "127.0.0.1" ]]; then
      echo "http://${v}"
    else
      echo "https://${v}"
    fi
  else
    echo "$v"
  fi
}
# Caddy site address: scheme + host, never a port (Caddy binds the standard container port).
#   https://notes.example.com -> https://notes.example.com  (auto HTTPS on 443, redirect from 80)
#   http://203.0.113.10:8080    -> http://203.0.113.10          (plain HTTP on container :80)
derive_caddy_site() { echo "$(url_scheme "$1")://$(url_host "$1")"; }

if [[ ! -f "$ENV_FILE" ]]; then
  info "Creating ${ENV_FILE}"
  cp "${DEPLOY_DIR}/.env.example" "$ENV_FILE"

  # Two deployment modes:
  #   - 域名模式: PUBLIC_URL=https://<域名>, Caddy 自动 HTTPS (Let's Encrypt)。
  #   - 无域名 / IP 直连: PUBLIC_URL=http://<IP>[:<port>], 纯 HTTP; 大陆区未备案用非标端口。
  if [[ -n "${PUBLIC_URL:-}" ]]; then
    # Scripted / CI deployment: PUBLIC_URL was supplied in the environment.
    PUBLIC_URL_VALUE="$(normalize_public_url "$PUBLIC_URL")"
    ACME_EMAIL_VALUE="${ACME_EMAIL:-}"
    # When the URL carries a port (http://ip:8080), honor it as the host HTTP_PORT.
    HTTP_PORT_VALUE="${HTTP_PORT:-$(url_port "$PUBLIC_URL_VALUE")}"
    HTTP_PORT_VALUE="${HTTP_PORT_VALUE:-80}"
  else
    read -r -p "  有域名吗？输入域名开启自动 HTTPS（如 notes.example.com）；直接回车=无域名，走 http IP 直连: " DOMAIN_VALUE
    if [[ -n "$DOMAIN_VALUE" ]]; then
      PUBLIC_URL_VALUE="https://${DOMAIN_VALUE}"
      HTTP_PORT_VALUE="80"
      read -r -p "  Let's Encrypt 通知邮箱（可选）: " ACME_EMAIL_VALUE
    else
      DEFAULT_IP="$(curl -sS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
      read -r -p "  服务器公网 IP（直接回车自动检测: ${DEFAULT_IP:-失败}）: " IP_VALUE
      IP_VALUE="${IP_VALUE:-$DEFAULT_IP}"
      [[ -n "$IP_VALUE" ]] || fail "未检测到公网 IP，请手动输入"
      read -r -p "  对外 HTTP 端口（默认 8080；大陆区 ECS 未备案时 80 会被运营商拦截）: " HTTP_PORT_VALUE
      HTTP_PORT_VALUE="${HTTP_PORT_VALUE:-8080}"
      if [[ "$HTTP_PORT_VALUE" == "80" ]]; then
        PUBLIC_URL_VALUE="http://${IP_VALUE}"
      else
        PUBLIC_URL_VALUE="http://${IP_VALUE}:${HTTP_PORT_VALUE}"
      fi
      ACME_EMAIL_VALUE=""
    fi
  fi

  CADDY_SITE_ADDR_VALUE="$(derive_caddy_site "$PUBLIC_URL_VALUE")"
  JWT_SECRET_VALUE="$(rand 48)"
  POSTGRES_PASSWORD_VALUE="$(rand 24)"

  # Rewrite the placeholders in place; | is used as the sed delimiter because secrets contain /.
  sed -i.bak \
    -e "s|^PUBLIC_URL=.*|PUBLIC_URL=${PUBLIC_URL_VALUE}|" \
    -e "s|^CADDY_SITE_ADDR=.*|CADDY_SITE_ADDR=${CADDY_SITE_ADDR_VALUE}|" \
    -e "s|^ACME_EMAIL=.*|ACME_EMAIL=${ACME_EMAIL_VALUE}|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET_VALUE}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD_VALUE}|" \
    -e "s|^HTTP_PORT=.*|HTTP_PORT=${HTTP_PORT_VALUE}|" \
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

# Backfill for .env files created before the direct-IP mode existed: normalize a bare
# PUBLIC_URL to scheme-ful form and derive CADDY_SITE_ADDR when it is missing.
NEED_WRITE=0
if [[ -n "${PUBLIC_URL:-}" && "$PUBLIC_URL" != *"://"* ]]; then
  PUBLIC_URL="$(normalize_public_url "$PUBLIC_URL")"
  NEED_WRITE=1
fi
if [[ -z "${CADDY_SITE_ADDR:-}" ]]; then
  [[ -n "${PUBLIC_URL:-}" ]] || fail "CADDY_SITE_ADDR and PUBLIC_URL are both empty in ${ENV_FILE}"
  CADDY_SITE_ADDR="$(derive_caddy_site "$PUBLIC_URL")"
  NEED_WRITE=1
fi
if [[ "$NEED_WRITE" == "1" ]]; then
  sed -i.bak \
    -e "s|^PUBLIC_URL=.*|PUBLIC_URL=${PUBLIC_URL}|" \
    -e "s|^CADDY_SITE_ADDR=.*|CADDY_SITE_ADDR=${CADDY_SITE_ADDR}|" \
    "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
  warn "backfilled CADDY_SITE_ADDR / PUBLIC_URL in ${ENV_FILE}"
fi

[[ -n "${JWT_SECRET:-}" ]] || fail "JWT_SECRET is empty in ${ENV_FILE}"
[[ ${#JWT_SECRET} -ge 32 ]] || fail "JWT_SECRET must be at least 32 characters"
[[ -n "${POSTGRES_PASSWORD:-}" ]] || fail "POSTGRES_PASSWORD is empty in ${ENV_FILE}"
[[ -n "${PUBLIC_URL:-}" ]] || fail "PUBLIC_URL is empty in ${ENV_FILE}"
[[ -n "${CADDY_SITE_ADDR:-}" ]] || fail "CADDY_SITE_ADDR is empty in ${ENV_FILE}"
ok "environment validated (PUBLIC_URL=${PUBLIC_URL})"
if [[ "$(url_scheme "$PUBLIC_URL")" == "http" ]]; then
  warn "纯 HTTP 直连模式（无 TLS）。大陆区 ECS 上请确认 HTTP_PORT=${HTTP_PORT:-80} 是非标端口（如 8080）。"
fi

# ---------------------------------------------------------------------------
# Bring the stack up
# ---------------------------------------------------------------------------
cd "$DEPLOY_DIR"

UP_ARGS=(-d)
if [[ "$REBUILD" == "1" ]]; then UP_ARGS+=(--build --force-recreate); fi
if [[ "$NO_BUILD" == "1" ]]; then
  [[ -n "${APP_IMAGE:-}" ]] || fail "--no-build requires APP_IMAGE in ${ENV_FILE}"
  if [[ "$APP_IMAGE" == *"/"* || "$APP_IMAGE" == *"."* ]]; then
    # Registry reference: always refresh mutable tags such as :latest before recreating.
    info "Pulling prebuilt image ${APP_IMAGE}"
    docker pull "$APP_IMAGE" || fail "could not pull ${APP_IMAGE}"
  else
    # Bare local tag (docker load / local build).
    docker image inspect "$APP_IMAGE" >/dev/null 2>&1 \
      || fail "local image ${APP_IMAGE} not found; docker load it first"
    info "Using local prebuilt image ${APP_IMAGE}"
  fi
else
  info "Building application image (this can take a few minutes on a small VPS)"
  info "Only dependency/Web changes rebuild the heavy mermaid/shiki bundle; server-only updates reuse that Docker layer."
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
PUBLIC_SCHEME="$(url_scheme "$PUBLIC_URL")"
PUBLIC_HOST="$(url_host "$PUBLIC_URL")"
HEALTHY=0
STATUS=""
HEALTH_BODY=""
probe_http() {
  # Host header matches the Caddy site; connecting to loopback avoids hairpin NAT issues.
  curl -sS --max-time 5 -H "Host: ${PUBLIC_HOST}" "http://127.0.0.1:${HTTP_PORT}/api/health" 2>/dev/null || true
}
probe_https() {
  curl -sSk --max-time 5 \
    --resolve "${PUBLIC_HOST}:${HTTPS_PORT}:127.0.0.1" \
    "https://${PUBLIC_HOST}:${HTTPS_PORT}/api/health" 2>/dev/null || true
}
for _ in $(seq 1 60); do
  if [[ "$PUBLIC_SCHEME" == "http" ]]; then
    # Direct-IP mode is plain HTTP; only the configured HTTP port is live.
    HEALTH_BODY="$(probe_http)"
  else
    # Domain mode: the :80 listener answers with a redirect (no body), then HTTPS serves /api/health.
    HEALTH_BODY="$(probe_http)"
    if [[ -z "$(printf '%s' "$HEALTH_BODY" | grep -o '"status":"ok"' || true)" && "$HTTPS_PORT" != "$HTTP_PORT" ]]; then
      HEALTH_BODY="$(probe_https)"
    fi
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
echo "  Web app:   ${PUBLIC_URL}/"
if [[ "$PUBLIC_SCHEME" == "http" ]]; then
  echo "  (纯 HTTP：浏览器会提示“不安全”，直接继续即可；之后配好域名可切 HTTPS)"
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
