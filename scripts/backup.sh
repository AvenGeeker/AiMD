#!/usr/bin/env bash
#
# Back up an AiMD deployment: Postgres dump + attachment volume.
#
#   ./scripts/backup.sh                 # -> ./backups/aimarkdown-<timestamp>.tar.gz
#   ./scripts/backup.sh --out /mnt/nas  # -> /mnt/nas/aimarkdown-<timestamp>.tar.gz
#
# Cron example (daily at 03:30, keep 14 days):
#   30 3 * * * cd /path/to/AiMD && ./scripts/backup.sh --keep 14 >> /var/log/aimarkdown-backup.log 2>&1

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/deploy"
ENV_FILE="${DEPLOY_DIR}/.env"
OUT_DIR="${REPO_ROOT}/backups"
KEEP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || { echo "no ${ENV_FILE}; has deploy.sh been run?" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

echo "==> dumping database"
docker exec aimarkdown-postgres pg_dump \
  --username="${POSTGRES_USER:-aimarkdown}" \
  --dbname="${POSTGRES_DB:-aimarkdown}" \
  --format=custom --compress=9 --file=/tmp/aimarkdown.dump
docker cp aimarkdown-postgres:/tmp/aimarkdown.dump "${STAGING}/database.dump"
docker exec aimarkdown-postgres rm -f /tmp/aimarkdown.dump

echo "==> copying attachments"
mkdir -p "${STAGING}/uploads"
docker cp aimarkdown-app:/data/uploads/. "${STAGING}/uploads/" 2>/dev/null || echo "  (no attachments yet)"

echo "==> recording metadata"
cat > "${STAGING}/BACKUP.json" <<JSON
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "publicUrl": "${PUBLIC_URL:-}",
  "postgresUser": "${POSTGRES_USER:-aimarkdown}",
  "postgresDb": "${POSTGRES_DB:-aimarkdown}",
  "appImage": "$(docker inspect --format '{{.Config.Image}}' aimarkdown-app 2>/dev/null || echo unknown)",
  "restoreHint": "pg_restore --clean --if-exists -U <user> -d <db> database.dump ; copy uploads/ back to the app:/data/uploads volume"
}
JSON
# The .env holds the secrets needed to bring the stack back up.
cp "$ENV_FILE" "${STAGING}/env.snapshot"
chmod 600 "${STAGING}/env.snapshot"

mkdir -p "$OUT_DIR"
ARCHIVE="${OUT_DIR}/aimarkdown-${STAMP}.tar.gz"
echo "==> writing ${ARCHIVE}"
tar -czf "$ARCHIVE" -C "$STAGING" .
chmod 600 "$ARCHIVE"

if [[ "$KEEP" -gt 0 ]]; then
  echo "==> pruning to the newest ${KEEP} backups"
  ls -1t "${OUT_DIR}"/aimarkdown-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old" && echo "  removed $(basename "$old")"
  done
fi

echo "==> done: $(du -h "$ARCHIVE" | cut -f1)"
echo "    verify with: tar -tzf ${ARCHIVE} | head"
