#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-secrets.sh — block credentials before they reach a public repository.
#
# Usage:
#   ./scripts/check-secrets.sh            # scan everything git tracks (worktree content)
#   ./scripts/check-secrets.sh --staged   # scan only staged files (pre-commit mode)
#   ./scripts/check-secrets.sh --all      # tracked + untracked, non-ignored files
#
# Exit 0 = clean, 1 = findings, 2 = usage error. Matched values are masked in the
# report so the output itself is safe to paste into an issue.
#
# Written for bash 3.2 (macOS default): no mapfile, no associative arrays.
# ---------------------------------------------------------------------------
set -o pipefail

MODE="tracked"
case "${1:-}" in
  --staged) MODE="staged" ;;
  --all)    MODE="all" ;;
  "")       ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

cd "$(git rev-parse --show-toplevel)" || exit 2

FILE_LIST="$(mktemp)"
trap 'rm -f "$FILE_LIST"' EXIT

case "$MODE" in
  staged) git diff --cached --name-only --diff-filter=ACMR > "$FILE_LIST" ;;
  all)    { git ls-files; git ls-files --others --exclude-standard; } | sort -u > "$FILE_LIST" ;;
  *)      git ls-files > "$FILE_LIST" ;;
esac

# Drop binaries, lockfiles and vendored/generated trees.
FILTERED="$(mktemp)"
trap 'rm -f "$FILE_LIST" "$FILTERED"' EXIT
grep -vE '(^|/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|\.(svg|png|jpe?g|gif|ico|icns|jar|aar|woff2?|ttf|otf|eot|mp4|mp3|wav|zip|gz|dmg|exe|p12|cer|p7b|pdf|map)$|(^|/)gradle/wrapper/' "$FILE_LIST" > "$FILTERED" || true

# skip-worktree files hold developer-local content (e.g. IDE-generated code-signing material)
# that git will not push, so scanning their worktree copy would only produce noise.
SKIP_LIST="$(git ls-files -v | awk '$1 == "S" { print substr($0, 3) }')"
if [ -n "$SKIP_LIST" ]; then
  KEEP="$(mktemp)"
  trap 'rm -f "$FILE_LIST" "$FILTERED" "$KEEP"' EXIT
  grep -vxF "$SKIP_LIST" "$FILTERED" > "$KEEP" || true
  SKIPPED=$(( $(wc -l < "$FILTERED" | tr -d ' ') - $(wc -l < "$KEEP" | tr -d ' ') ))
  mv "$KEEP" "$FILTERED"
else
  SKIPPED=0
fi

COUNT=$(wc -l < "$FILTERED" | tr -d ' ')
if [ "$COUNT" -eq 0 ]; then
  echo "check-secrets: nothing to scan ($MODE mode)."
  exit 0
fi

# Placeholder / documentation markers: a line containing any of these is an example, not a leak.
ALLOW='change-me|changeme|current-password|new-password|showPassword|your[-_]|YOUR[-_]|<[a-z0-9._-]+>|example\.(com|org|net|internal)|notes\.example|@Example|placeholder|dummy|redacted|xxxxx|sk-sp-|203\.0\.113\.|198\.51\.100\.|192\.0\.2\.|aimarkdown_dev|aimarkdown_test|e2e_pg_password|e2e-deploy-secret|0123456789abcdef|test-password|test-secret'

# name<TAB>regex  (extended regex; the public-IP rule is handled separately, grep -E has no lookahead)
RULES='aws-access-key-id	\b(AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{12,}\b
aliyun-access-key-id	\bLTAI[0-9A-Za-z]{12,}\b
github-token	\b(gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,})\b
gitlab-token	\bglpat-[0-9A-Za-z_-]{15,}\b
slack-token	\bxox[baprs]-[0-9A-Za-z-]{10,}\b
openai-key	\bsk-(proj-)?[0-9A-Za-z_-]{24,}\b
anthropic-key	\bsk-ant-[0-9A-Za-z_-]{20,}\b
google-api-key	\bAIza[0-9A-Za-z_-]{30,}\b
private-key-block	-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----
signed-jwt-literal	\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b
harmony-signing-material	"(keyPassword|storePassword)"[[:space:]]*:[[:space:]]*"[0-9A-Fa-f]{32,}"
apple-team-id	DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*"?[0-9A-Z]{10}"?
signing-material-path	/Users/[A-Za-z0-9._-]+/\.(ohos|ssh|aws|kube|docker)/
secret-assignment	(JWT_SECRET|AI_CREDENTIALS_SECRET|POSTGRES_PASSWORD|SECRET_KEY|ACCESS_KEY_SECRET|SESSION_SECRET|SMTP_PASSWORD|BOOTSTRAP_ADMIN_PASSWORD|API_KEY|AUTH_TOKEN)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9/+_.:-]{20,}
password-literal	(password|passwd|pwd)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}["'"'"']
basic-auth-url	[a-z][a-z0-9+.-]*://[A-Za-z0-9._-]+:[^@[:space:]"'"'"']{6,}@[A-Za-z0-9.-]+'

FINDINGS=0

report() { # $1=rule $2=file:line:content
  local rule="$1" hit="$2" file lineno content masked
  file="${hit%%:*}"
  hit="${hit#*:}"
  lineno="${hit%%:*}"
  content="${hit#*:}"
  if printf '%s' "$content" | grep -qE "$ALLOW"; then
    return
  fi
  # Fixture passwords ("password123", "longenough") are deliberate in test files.
  if [ "$rule" = "password-literal" ] && printf '%s' "$file" | grep -qE '(^|/)(tests?|__tests__|e2e|fixtures?)/|\.(test|spec)\.[cm]?[jt]sx?$'; then
    return
  fi
  masked=$(printf '%s' "$content" | sed -E 's#[A-Za-z0-9+/_:=.-]{10,}#<REDACTED>#g' | cut -c1-150)
  printf '  [%s] %s:%s\n      %s\n' "$rule" "$file" "$lineno" "$masked"
  FINDINGS=$((FINDINGS + 1))
}

# One grep per rule over the whole file list (fast, and keeps the rule label accurate).
while IFS="$(printf '\t')" read -r name pattern; do
  [ -n "$name" ] || continue
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    report "$name" "$hit"
  done < <(tr '\n' '\0' < "$FILTERED" | xargs -0 grep -nEIH "$pattern" 2>/dev/null)
done <<< "$RULES"

# Public IPv4 literals, minus private / documentation / loopback ranges and version numbers.
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  report "public-ip-literal" "$hit"
done < <(tr '\n' '\0' < "$FILTERED" | xargs -0 grep -nEoIH '\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b' 2>/dev/null \
  | grep -vE ':(127\.|10\.|0\.|255\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|203\.0\.113\.|198\.51\.100\.|192\.0\.2\.|169\.254\.)' \
  | grep -vE ':[0-9]+\.[0-9]+\.[0-9]+$')

if [ "$FINDINGS" -gt 0 ]; then
  cat >&2 <<MSG

check-secrets: $FINDINGS potential secret(s) found ($COUNT file(s) scanned, $MODE mode).

Fix before pushing to a public repository:
  1. Remove the value from the file; read it from .env / a secrets manager / \${ENV_VAR}.
  2. If it was ever committed, treat it as burned: rotate the credential, then scrub
     history (git filter-repo or BFG). A force-push alone does not remove it.
  3. Re-run: ./scripts/check-secrets.sh

Genuine false positive? Prefer an inline placeholder such as <your-secret> in the
source, or add a narrow marker to ALLOW above — do not widen the rule regexes.
MSG
  exit 1
fi

echo "check-secrets: clean ($COUNT file(s) scanned, $SKIPPED developer-local file(s) skipped, $MODE mode)."
