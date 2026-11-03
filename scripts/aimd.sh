#!/usr/bin/env bash
#
# AiMD server operations.
#
# Usage:
#   ./scripts/aimd.sh deploy [--no-backup] [--keep N]
#   ./scripts/aimd.sh update [--no-backup] [--keep N]
#   ./scripts/aimd.sh apply
#   ./scripts/aimd.sh rollback [release-id|image-tag] [--with-env] [--yes]
#   ./scripts/aimd.sh status
#   ./scripts/aimd.sh releases
#   ./scripts/aimd.sh logs [app|caddy|postgres] [--tail N]
#   ./scripts/aimd.sh backup [--keep N]
#   ./scripts/aimd.sh doctor
#   ./scripts/aimd.sh config
#   ./scripts/aimd.sh restart
#   ./scripts/aimd.sh stop
#
# State lives in .deploy/ (git-ignored): current release, current image, env snapshots.
# Rollback switches the application image only. Database migrations are forward-only;
# restore a database backup explicitly if you need to roll data back.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/.env"
STATE_DIR="$REPO_ROOT/.deploy"
RELEASES_DIR="$STATE_DIR/releases"
CURRENT_FILE="$STATE_DIR/current"
CURRENT_IMAGE_FILE="$STATE_DIR/current-image"
LOCK_FILE="$STATE_DIR/lock"
BACKUP_KEEP="${AIMD_BACKUP_KEEP:-14}"
HEALTH_RETRIES="${AIMD_HEALTH_RETRIES:-60}"
HEALTH_INTERVAL="${AIMD_HEALTH_INTERVAL:-2}"

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
else
  C_RESET=''
  C_CYAN=''
  C_GREEN=''
  C_YELLOW=''
  C_RED=''
fi

info() { printf '%s==>%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
ok() { printf '%s  ✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s  !%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die() { printf '%s  ✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
AiMD 服务器运维脚本

用法:
  ./scripts/aimd.sh <命令> [参数]

命令:
  deploy [--no-backup] [--keep N]
      首次部署或重新部署。备份 -> 构建 -> 启动 -> 健康检查。
      已有版本时失败会自动回滚到上一版镜像。

  update [--no-backup] [--keep N]
      更新代码后使用，要求已经有过一次 deploy。
      默认先备份数据库/附件，再构建并切换；失败自动回滚镜像。

  apply
      只应用 deploy/.env 的修改，不重新构建镜像。
      适合改域名、端口、ALLOW_REGISTRATION 等配置。

  rollback [版本ID|镜像标签] [--with-env] [--yes]
      回滚应用镜像。默认回到上一版。
      --with-env  同时恢复目标版本的 deploy/.env 快照
      --yes       跳过确认

  status
      显示当前发布、镜像、容器状态、健康检查、DNS 和证书。

  releases
      列出发布记录。

  logs [app|caddy|postgres] [--tail N]
      跟踪容器日志，默认 app。

  backup [--keep N]
      备份数据库和附件，默认保留 14 份。

  doctor
      检查 Docker、Compose、.env、DNS、端口、健康状态。

  config
      用 $EDITOR 编辑 deploy/.env；改完执行 apply。

  restart
      用当前镜像重建 app/caddy 并做健康检查。

  stop
      停止容器，保留数据卷。

注意:
  - 回滚只切换应用镜像，不会回滚数据库迁移。
  - 需要恢复数据库时，使用 backups/ 里的备份包，按备份中的 BACKUP.json 操作。
  - 不要用 docker compose down -v 或 docker system prune --volumes 删除数据卷。
USAGE
}

require_env_file() {
  [[ -f "$ENV_FILE" ]] || die "缺少 ${ENV_FILE}。请先按部署教程生成 deploy/.env。"
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

validate_env_file() {
  local file="$1"
  [[ -f "$file" ]] || { warn "缺少 $file"; return 1; }
  (
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
    [[ -n "${PUBLIC_URL:-}" ]] || { echo "PUBLIC_URL 为空" >&2; exit 1; }
    [[ -n "${CADDY_SITE_ADDR:-}" ]] || { echo "CADDY_SITE_ADDR 为空" >&2; exit 1; }
    [[ -n "${JWT_SECRET:-}" && ${#JWT_SECRET} -ge 32 ]] || { echo "JWT_SECRET 至少需要 32 个字符" >&2; exit 1; }
    [[ -n "${POSTGRES_PASSWORD:-}" ]] || { echo "POSTGRES_PASSWORD 为空" >&2; exit 1; }
    case "${PUBLIC_URL}" in
      http://*|https://*) ;;
      *) echo "PUBLIC_URL 必须以 http:// 或 https:// 开头" >&2; exit 1 ;;
    esac
    case "${CADDY_SITE_ADDR}" in
      http://*|https://*) ;;
      *) echo "CADDY_SITE_ADDR 必须以 http:// 或 https:// 开头" >&2; exit 1 ;;
    esac
  )
}

validate_env() {
  validate_env_file "$ENV_FILE" || die "deploy/.env 校验失败"
}

compose_plain() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

preflight() {
  command -v docker >/dev/null 2>&1 || die "未找到 docker"
  docker info >/dev/null 2>&1 || die "无法连接 Docker daemon（服务未启动或当前用户没有 docker 权限）"
  docker compose version >/dev/null 2>&1 || die "docker compose 不可用"
  command -v curl >/dev/null 2>&1 || die "未找到 curl"
  [[ -f "$COMPOSE_FILE" ]] || die "缺少 $COMPOSE_FILE"
  require_env_file
  validate_env
  mkdir -p "$STATE_DIR" "$RELEASES_DIR"
  chmod 700 "$STATE_DIR" "$RELEASES_DIR" 2>/dev/null || true
}

acquire_lock() {
  mkdir -p "$STATE_DIR"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    flock -n 9 || die "另一个操作正在进行（${LOCK_FILE}）"
  else
    warn "未找到 flock，跳过并发锁"
  fi
}

url_host() {
  local v="$1"
  v="${v#*://}"
  v="${v%%/*}"
  v="${v##*@}"
  v="${v%%:*}"
  printf '%s' "$v"
}

git_commit() {
  if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
    git -C "$REPO_ROOT" rev-parse --short HEAD
  else
    printf 'unknown'
  fi
}

current_release() {
  [[ -f "$CURRENT_FILE" ]] && cat "$CURRENT_FILE"
}

current_image() {
  [[ -f "$CURRENT_IMAGE_FILE" ]] && cat "$CURRENT_IMAGE_FILE"
}

write_current_release() {
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$1" > "$CURRENT_FILE"
}

write_current_image() {
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$1" > "$CURRENT_IMAGE_FILE"
}

new_release_id() {
  local id
  id="$(date +%Y%m%d-%H%M%S)"
  while [[ -d "$RELEASES_DIR/$id" ]]; do
    id="$(date +%Y%m%d-%H%M%S)-$RANDOM"
  done
  printf '%s' "$id"
}

write_meta() {
  local dir="$1" status="$2" image="$3" previous="$4" id="$5"
  cat > "$dir/meta.env" <<META
RELEASE_ID=$id
STATUS=$status
IMAGE_TAG=$image
PREVIOUS_IMAGE=$previous
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_COMMIT=$(git_commit)
PUBLIC_URL=$PUBLIC_URL
CADDY_SITE_ADDR=$CADDY_SITE_ADDR
META
  chmod 600 "$dir/meta.env"
}

find_release_by_image() {
  local image="$1" dir
  for dir in "$RELEASES_DIR"/*; do
    [[ -d "$dir" ]] || continue
    [[ "$(sed -n 's/^IMAGE_TAG=//p' "$dir/meta.env" 2>/dev/null || true)" == "$image" ]] || continue
    basename "$dir"
    return 0
  done
  return 1
}

latest_previous_release() {
  local current="$1" dir id status
  for dir in $(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r); do
    id="$(basename "$dir")"
    [[ "$id" == "$current" ]] && continue
    status="$(sed -n 's/^STATUS=//p' "$dir/meta.env" 2>/dev/null || true)"
    [[ "$status" == "success" ]] || continue
    printf '%s' "$id"
    return 0
  done
  return 1
}

backup_stack() {
  local keep="$1"
  if ! docker inspect aimarkdown-postgres >/dev/null 2>&1; then
    warn "Postgres 容器未运行，跳过备份"
    return 0
  fi
  info "备份数据库和附件（保留 $keep 份）"
  if ! bash "$REPO_ROOT/scripts/backup.sh" --keep "$keep"; then
    warn "备份失败"
    return 1
  fi
}

# A bare name such as aimarkdown-app:local (or the release-* tags we create) lives only in the
# local daemon. Anything with a registry host or a namespace (ghcr.io/..., user/app:tag) is remote.
image_is_local() {
  [[ "$1" != *"/"* && "$1" != *"."* ]]
}

build_app() {
  if [[ -n "${APP_IMAGE:-}" ]]; then
    warn "APP_IMAGE=$APP_IMAGE 非空，跳过本地构建"
    if image_is_local "$APP_IMAGE"; then
      if ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then
        warn "本地镜像不存在: $APP_IMAGE（先用 docker load 导入）"
        return 1
      fi
      return 0
    fi
    # Always ask the registry, even when the tag already exists locally. Otherwise a mutable tag
    # such as :latest silently redeploys the previous image after a new release is published.
    info "拉取 $APP_IMAGE"
    if ! docker pull "$APP_IMAGE"; then
      warn "拉取失败: $APP_IMAGE"
      return 1
    fi
    return 0
  fi

  info "构建 app 镜像"
  if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build app; then
    warn "构建失败"
    return 1
  fi
}

start_stack() {
  local image="$1"
  info "启动 app/caddy（镜像: ${image}）"
  if ! APP_IMAGE="$image" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate app caddy; then
    warn "容器启动失败"
    return 1
  fi
}

wait_health() {
  local url="${PUBLIC_URL%/}/api/health"
  local i body
  info "等待健康检查: $url"
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    body="$(curl -fsS --max-time 5 "$url" 2>/dev/null || true)"
    if [[ "$body" == *'"status":"ok"'* ]]; then
      ok "健康检查通过"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done

  warn "健康检查失败: $url"
  compose_plain ps || true
  compose_plain logs --tail=80 app caddy postgres || true
  return 1
}

rollback_runtime() {
  local image="$1" release="$2"
  [[ -n "$image" ]] || return 1
  warn "尝试回滚到镜像: $image"
  write_current_image "$image"
  if start_stack "$image" && wait_health; then
    [[ -n "$release" ]] && write_current_release "$release"
    ok "已回滚到 $image"
    return 0
  fi
  warn "回滚后健康检查仍失败"
  compose_plain logs --tail=120 app caddy || true
  return 1
}

do_release() {
  local mode="$1" backup_flag="$2" keep="$3"
  preflight
  acquire_lock
  load_env

  local previous_release previous_image id release_dir new_image
  previous_release="$(current_release || true)"
  if [[ "$mode" == "update" && -z "$previous_release" ]]; then
    die "还没有部署记录，请先执行: ./scripts/aimd.sh deploy"
  fi

  id="$(new_release_id)"
  release_dir="$RELEASES_DIR/$id"
  mkdir -p "$release_dir"
  chmod 700 "$release_dir"
  cp "$ENV_FILE" "$release_dir/env.snapshot"
  chmod 600 "$release_dir/env.snapshot"

  previous_image=""
  if [[ -n "$previous_release" ]]; then
    previous_image="$(current_image || true)"
  fi
  # `aimarkdown-app:local` is overwritten by the next build, so keep a safety tag
  # before building. Release tags are immutable and do not need this.
  if [[ "$previous_image" == "aimarkdown-app:local" ]]; then
    local safety_image="aimarkdown-app:pre-$id"
    if docker tag "$previous_image" "$safety_image" >/dev/null 2>&1; then
      previous_image="$safety_image"
    else
      warn "无法为当前 local 镜像创建安全标签，自动回滚将不可用"
      previous_image=""
    fi
  fi
  if [[ -z "$previous_image" ]] && docker inspect aimarkdown-app >/dev/null 2>&1; then
    previous_image="aimarkdown-app:pre-$id"
    if ! docker tag "$(docker inspect --format '{{.Image}}' aimarkdown-app)" "$previous_image"; then
      previous_image=""
    fi
  fi
  if [[ -n "$previous_image" ]] && ! docker image inspect "$previous_image" >/dev/null 2>&1; then
    warn "当前镜像 $previous_image 不存在，无法自动回滚"
    previous_image=""
  fi

  new_image="aimarkdown-app:release-$id"
  write_meta "$release_dir" pending "$new_image" "$previous_image" "$id"

  if [[ "$backup_flag" == "1" ]]; then
    if ! backup_stack "$keep"; then
      write_meta "$release_dir" failed "$new_image" "$previous_image" "$id"
      die "备份失败，已中止部署"
    fi
  fi

  if ! build_app; then
    write_meta "$release_dir" failed "$new_image" "$previous_image" "$id"
    die "构建失败，容器未切换；当前版本仍是 ${previous_release:-未部署}"
  fi

  if ! docker tag "${APP_IMAGE:-aimarkdown-app:local}" "$new_image"; then
    write_meta "$release_dir" failed "$new_image" "$previous_image" "$id"
    die "镜像打标签失败: $new_image"
  fi

  if ! start_stack "$new_image"; then
    write_meta "$release_dir" failed "$new_image" "$previous_image" "$id"
    if [[ -n "$previous_image" ]]; then
      rollback_runtime "$previous_image" "$previous_release" || true
    fi
    die "新版本启动失败"
  fi

  if wait_health; then
    write_current_image "$new_image"
    write_current_release "$id"
    write_meta "$release_dir" success "$new_image" "$previous_image" "$id"
    ok "部署成功: ${PUBLIC_URL}/"
    info "发布 ID: $id"
    return 0
  fi

  write_meta "$release_dir" failed "$new_image" "$previous_image" "$id"
  if [[ -n "$previous_image" ]]; then
    rollback_runtime "$previous_image" "$previous_release" || true
  fi
  die "新版本健康检查失败"
}

cmd_deploy() {
  local backup_flag=1 keep="$BACKUP_KEEP"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-backup) backup_flag=0; shift ;;
      --keep) [[ $# -ge 2 ]] || die "--keep 需要参数"; keep="$2"; shift 2 ;;
      -h|--help) usage; return 0 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  do_release deploy "$backup_flag" "$keep"
}

cmd_update() {
  local backup_flag=1 keep="$BACKUP_KEEP"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-backup) backup_flag=0; shift ;;
      --keep) [[ $# -ge 2 ]] || die "--keep 需要参数"; keep="$2"; shift 2 ;;
      -h|--help) usage; return 0 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  do_release update "$backup_flag" "$keep"
}

cmd_apply() {
  preflight
  acquire_lock
  load_env

  local image backup_file current_rel
  image="$(current_image || true)"
  [[ -n "$image" ]] || die "没有当前镜像记录，请先执行 deploy"
  docker image inspect "$image" >/dev/null 2>&1 || die "当前镜像不存在: $image"

  backup_file="$STATE_DIR/env.before-apply-$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$backup_file"
  chmod 600 "$backup_file"

  if start_stack "$image" && wait_health; then
    current_rel="$(current_release || true)"
    if [[ -n "$current_rel" && -d "$RELEASES_DIR/$current_rel" ]]; then
      cp "$ENV_FILE" "$RELEASES_DIR/$current_rel/env.snapshot"
      chmod 600 "$RELEASES_DIR/$current_rel/env.snapshot"
      printf '\nUPDATED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RELEASES_DIR/$current_rel/meta.env"
    fi
    ok "配置已应用"
    return 0
  fi

  warn "配置应用失败，恢复原 deploy/.env"
  cp "$backup_file" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  load_env
  start_stack "$image" || true
  wait_health || true
  die "配置已回滚；请查看 app/caddy 日志"
}

cmd_rollback() {
  local target="" with_env=0 yes=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --with-env) with_env=1; shift ;;
      --yes|-y) yes=1; shift ;;
      -h|--help) usage; return 0 ;;
      -*) die "未知参数: $1" ;;
      *) [[ -z "$target" ]] || die "只能指定一个版本"; target="$1"; shift ;;
    esac
  done

  preflight
  acquire_lock
  load_env

  local current_rel current_img target_image target_release
  current_rel="$(current_release || true)"
  current_img="$(current_image || true)"

  if [[ -z "$target" ]]; then
    if [[ -n "$current_rel" && -f "$RELEASES_DIR/$current_rel/meta.env" ]]; then
      target_image="$(sed -n 's/^PREVIOUS_IMAGE=//p' "$RELEASES_DIR/$current_rel/meta.env" | head -n1)"
      if [[ -n "$target_image" ]]; then
        target_release="$(find_release_by_image "$target_image" || true)"
      fi
    fi
    if [[ -z "${target_image:-}" ]]; then
      target_release="$(latest_previous_release "$current_rel" || true)"
      if [[ -n "$target_release" ]]; then
        target_image="$(sed -n 's/^IMAGE_TAG=//p' "$RELEASES_DIR/$target_release/meta.env" | head -n1)"
      fi
    fi
  elif [[ -d "$RELEASES_DIR/$target" ]]; then
    target_release="$target"
    target_image="$(sed -n 's/^IMAGE_TAG=//p' "$RELEASES_DIR/$target/meta.env" | head -n1)"
  else
    target_image="$target"
    target_release="$(find_release_by_image "$target_image" || true)"
  fi

  [[ -n "${target_image:-}" ]] || die "找不到可回滚的版本；用 ./scripts/aimd.sh releases 查看"
  docker image inspect "$target_image" >/dev/null 2>&1 || die "镜像不存在: $target_image"

  warn "回滚只切换应用镜像，不回滚数据库迁移。"
  if [[ "$with_env" == "1" ]]; then
    [[ -n "$target_release" && -f "$RELEASES_DIR/$target_release/env.snapshot" ]] || die "目标版本没有 env 快照"
    validate_env_file "$RELEASES_DIR/$target_release/env.snapshot" || die "目标版本 env 校验失败"
    warn "同时恢复目标版本的 deploy/.env"
  fi

  if [[ "$yes" != "1" ]]; then
    printf '回滚到 %s (%s)？[y/N] ' "${target_release:-$target_image}" "$target_image"
    read -r answer
    [[ "$answer" =~ ^[Yy]$ ]] || die "已取消"
  fi

  local old_image="$current_img" env_backup=""
  if [[ "$with_env" == "1" ]]; then
    env_backup="$STATE_DIR/env.before-rollback-$(date +%Y%m%d-%H%M%S)"
    cp "$ENV_FILE" "$env_backup"
    chmod 600 "$env_backup"
    cp "$RELEASES_DIR/$target_release/env.snapshot" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    load_env
    validate_env
  fi

  write_current_image "$target_image"
  if start_stack "$target_image" && wait_health; then
    [[ -n "$target_release" ]] && write_current_release "$target_release"
    ok "回滚成功: $target_image"
    return 0
  fi

  warn "回滚后健康检查失败"
  if [[ -n "$old_image" ]]; then
    warn "恢复到回滚前镜像: $old_image"
    write_current_image "$old_image"
    if [[ -n "$env_backup" ]]; then
      cp "$env_backup" "$ENV_FILE"
      chmod 600 "$ENV_FILE"
      load_env
    fi
    start_stack "$old_image" || true
    wait_health || true
  fi
  die "回滚失败，请查看 app/caddy 日志"
}

cmd_status() {
  preflight
  load_env

  local rel img host
  rel="$(current_release || true)"
  img="$(current_image || true)"
  host="$(url_host "$PUBLIC_URL")"

  printf '\nAiMD 部署状态\n'
  printf '  PUBLIC_URL:      %s\n' "$PUBLIC_URL"
  printf '  CADDY_SITE_ADDR: %s\n' "${CADDY_SITE_ADDR:-}"
  printf '  当前发布:        %s\n' "${rel:-无}"
  printf '  当前镜像:        %s\n' "${img:-无}"
  printf '  Git commit:      %s\n\n' "$(git_commit)"

  compose_plain ps || true

  printf '\n'
  if curl -fsS --max-time 5 "${PUBLIC_URL%/}/api/health" 2>/dev/null; then
    printf '\n'
    ok "健康检查通过"
  else
    warn "健康检查失败: ${PUBLIC_URL%/}/api/health"
  fi

  printf '\n'
  info "最近镜像"
  docker image ls aimarkdown-app --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}\t{{.Size}}' | head -n 12 || true

  printf '\n'
  info "磁盘"
  df -h / | tail -n 1 || true

  printf '\n'
  info "DNS"
  if command -v getent >/dev/null 2>&1; then
    getent hosts "$host" || true
  elif command -v dig >/dev/null 2>&1; then
    dig +short "$host" || true
  else
    warn "没有 getent/dig，跳过 DNS 检查"
  fi

  if [[ "$PUBLIC_URL" == https://* ]]; then
    printf '\n'
    info "TLS 证书"
    echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null \
      | openssl x509 -noout -issuer -subject -dates 2>/dev/null || warn "无法读取证书"
  fi
}

cmd_releases() {
  [[ -d "$RELEASES_DIR" ]] || { info "还没有发布记录"; return 0; }
  local current dir id status image created marker
  current="$(current_release || true)"
  printf '  %-20s %-8s %-40s %s\n' "RELEASE" "STATUS" "IMAGE" "CREATED"
  for dir in $(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r); do
    id="$(basename "$dir")"
    status="$(sed -n 's/^STATUS=//p' "$dir/meta.env" 2>/dev/null | head -n1)"
    image="$(sed -n 's/^IMAGE_TAG=//p' "$dir/meta.env" 2>/dev/null | head -n1)"
    created="$(sed -n 's/^CREATED_AT=//p' "$dir/meta.env" 2>/dev/null | head -n1)"
    marker=" "
    [[ "$id" == "$current" ]] && marker="*"
    printf '%s %-20s %-8s %-40s %s\n' "$marker" "$id" "${status:-unknown}" "${image:--}" "${created:--}"
  done
}

cmd_logs() {
  local service="app" tail="100"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tail) [[ $# -ge 2 ]] || die "--tail 需要参数"; tail="$2"; shift 2 ;;
      app|caddy|postgres) service="$1"; shift ;;
      -h|--help) usage; return 0 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  command -v docker >/dev/null 2>&1 || die "未找到 docker"
  docker info >/dev/null 2>&1 || die "无法连接 Docker daemon"

  local container
  case "$service" in
    app) container="aimarkdown-app" ;;
    caddy) container="aimarkdown-caddy" ;;
    postgres) container="aimarkdown-postgres" ;;
    *) die "未知服务: $service" ;;
  esac
  docker logs -f --tail="$tail" "$container"
}

cmd_backup() {
  local keep="$BACKUP_KEEP"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keep) [[ $# -ge 2 ]] || die "--keep 需要参数"; keep="$2"; shift 2 ;;
      -h|--help) usage; return 0 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  preflight
  bash "$REPO_ROOT/scripts/backup.sh" --keep "$keep"
}

cmd_doctor() {
  local failed=0 host
  info "Docker"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ok "docker daemon 可用"
  else
    warn "docker 不可用"
    failed=1
  fi
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "docker compose 可用"
  else
    warn "docker compose 不可用"
    failed=1
  fi

  info ".env"
  if validate_env_file "$ENV_FILE"; then
    ok "deploy/.env 校验通过"
    load_env
  else
    warn "deploy/.env 校验失败"
    failed=1
  fi

  if [[ -n "${PUBLIC_URL:-}" ]]; then
    host="$(url_host "$PUBLIC_URL")"
    info "DNS: $host"
    if command -v getent >/dev/null 2>&1; then
      getent hosts "$host" || warn "DNS 未解析"
    elif command -v dig >/dev/null 2>&1; then
      dig +short "$host" || true
    fi
    info "健康检查"
    curl -fsS --max-time 5 "${PUBLIC_URL%/}/api/health" || warn "健康检查失败"
  fi

  info "端口"
  ss -lntp 2>/dev/null | grep -E ":${HTTP_PORT:-80}|:${HTTPS_PORT:-443}" || true

  info "磁盘"
  df -h / | tail -n 1 || true
  info "内存"
  free -h | head -n 2 || true
  return "$failed"
}

cmd_config() {
  require_env_file
  local editor="${EDITOR:-vi}"
  command -v "$editor" >/dev/null 2>&1 || die "找不到编辑器: $editor"
  "$editor" "$ENV_FILE"
  info "修改后执行: ./scripts/aimd.sh apply"
}

cmd_restart() {
  preflight
  acquire_lock
  load_env
  local image
  image="$(current_image || true)"
  [[ -n "$image" ]] || image="aimarkdown-app:local"
  docker image inspect "$image" >/dev/null 2>&1 || die "镜像不存在: $image"
  start_stack "$image" || die "启动失败"
  wait_health || die "健康检查失败"
}

cmd_stop() {
  preflight
  acquire_lock
  load_env
  warn "停止容器（不会删除数据卷）"
  compose_plain down
  ok "已停止"
}

main() {
  local cmd="${1:-help}"
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    deploy) cmd_deploy "$@" ;;
    update) cmd_update "$@" ;;
    apply) cmd_apply "$@" ;;
    rollback) cmd_rollback "$@" ;;
    status) cmd_status "$@" ;;
    releases) cmd_releases "$@" ;;
    logs) cmd_logs "$@" ;;
    backup) cmd_backup "$@" ;;
    doctor) cmd_doctor "$@" ;;
    config) cmd_config "$@" ;;
    restart) cmd_restart "$@" ;;
    stop) cmd_stop "$@" ;;
    help|-h|--help) usage ;;
    *) die "未知命令: ${cmd}（用 help 查看）" ;;
  esac
}

main "$@"
