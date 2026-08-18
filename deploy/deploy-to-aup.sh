#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-aup-server}"
REMOTE_ROOT="${REMOTE_ROOT:-/home/aup/panshi-ai4s-camp}"
REMOTE_ENV="${REMOTE_ENV:-${REMOTE_ROOT}/secrets/production.env}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-panshi-ai4s-camp-prod}"
COMPOSE_FILES="-f compose.yaml -f compose.prod.yaml"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--apply]

Without --apply this command performs a dry run and does not contact AUP.
Production target: ${REMOTE_HOST}:${REMOTE_ROOT}
EOF
}

if [[ "${1:-}" != "--apply" ]]; then
  usage
  printf '\nDry run only. Re-run with --apply to deploy.\n'
  exit 0
fi

cd "$PROJECT_ROOT"
[[ -f package.json && -f compose.prod.yaml ]] || { echo 'Run from the Panshi camp project.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Refusing to deploy a dirty worktree.' >&2; exit 1; }

RELEASE_COMMIT="$(git rev-parse HEAD)"
LOCK_PATH="${REMOTE_ROOT}/.deploy-lock"

ssh "$REMOTE_HOST" "
  set -e
  mkdir -p '$REMOTE_ROOT'
  if ! mkdir '$LOCK_PATH' 2>/dev/null; then
    echo 'Another Panshi camp deployment is in progress.' >&2
    exit 1
  fi
"
cleanup_lock() {
  ssh "$REMOTE_HOST" "rmdir '$LOCK_PATH' 2>/dev/null || true" >/dev/null 2>&1 || true
}
trap cleanup_lock EXIT

rsync -az --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'secrets/' \
  --exclude 'node_modules/' \
  --exclude '**/dist/' \
  --exclude 'test-results/' \
  --exclude 'playwright-report/' \
  --exclude 'var/' \
  "$PROJECT_ROOT/" "$REMOTE_HOST:$REMOTE_ROOT/"

ssh "$REMOTE_HOST" "
  set -euo pipefail
  cd '$REMOTE_ROOT'
  test -f '$REMOTE_ENV' || { echo 'Missing operator-managed production environment: $REMOTE_ENV' >&2; exit 1; }
  docker compose --env-file '$REMOTE_ENV' -p '$COMPOSE_PROJECT' $COMPOSE_FILES config -q
  docker compose --env-file '$REMOTE_ENV' -p '$COMPOSE_PROJECT' $COMPOSE_FILES build
  docker compose --env-file '$REMOTE_ENV' -p '$COMPOSE_PROJECT' $COMPOSE_FILES up -d
  printf '%s\n' '$RELEASE_COMMIT' > .deployed-commit
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3200/healthz >/dev/null
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3200/api/v1/public/site >/dev/null
  docker compose --env-file '$REMOTE_ENV' -p '$COMPOSE_PROJECT' $COMPOSE_FILES ps
"

printf 'Deployed %s to %s:%s\n' "$RELEASE_COMMIT" "$REMOTE_HOST" "$REMOTE_ROOT"
