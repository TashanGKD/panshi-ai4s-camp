#!/usr/bin/env bash
set -euo pipefail
umask 077

OPERATIONS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy/operations-common.sh
source "$OPERATIONS_SCRIPT_DIR/operations-common.sh"

die() {
  printf 'Restore failed: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf 'Usage: MAINTENANCE_ACK=RESTORE:BACKUP_ID:DATABASE %s --yes BACKUP_ID\n' "${0##*/}" >&2
}

require_descendant() {
  local root="$1"
  local candidate="$2"
  case "$candidate" in
    "$root"/*) ;;
    *) die 'resolved backup path is outside BACKUP_ROOT' ;;
  esac
}

sha256_check() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -c "$1"; else shasum -a 256 -c "$1"; fi
}

require_private_file() {
  local label="$1"
  local path="$2"
  [[ -f "$path" && ! -L "$path" ]] || die "$label must be a regular non-symlink file"
  local mode
  if stat -f '%Lp' "$path" >/dev/null 2>&1; then mode="$(stat -f '%Lp' "$path")"; else mode="$(stat -c '%a' "$path")"; fi
  (( (8#$mode & 077) == 0 )) || die "$label must not be accessible by group or other users"
}

move_exact() {
  local source="$1"
  local target="$2"
  if mv --help >/dev/null 2>&1; then mv -T "$source" "$target"; else mv -h "$source" "$target"; fi
}

safe_delete_tree_under() {
  local parent="$1"
  local target="$2"
  [[ -d "$target" && ! -L "$target" ]] || return 1
  local resolved
  resolved="$(cd "$target" && pwd -P)" || return 1
  case "$resolved" in "$parent"/*) ;; *) return 1 ;; esac
  find "$resolved" -depth -mindepth 1 -delete && rmdir "$resolved"
}

if [[ "$#" -ne 2 || "$1" != '--yes' ]]; then
  usage
  exit 2
fi
backup_selector="$2"
[[ "$backup_selector" =~ ^panshi-backup-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
  || die 'backup identifier is invalid; use a generated direct-child backup ID'

: "${BACKUP_ROOT:?BACKUP_ROOT is required}"
: "${RESTORE_PGHOST:?RESTORE_PGHOST is required}"
: "${RESTORE_PGPORT:?RESTORE_PGPORT is required}"
: "${RESTORE_PGDATABASE:?RESTORE_PGDATABASE is required}"
: "${RESTORE_PGUSER:?RESTORE_PGUSER is required}"
: "${RESTORE_PGPASSFILE:?RESTORE_PGPASSFILE is required}"
: "${RESTORE_UPLOAD_DIR:?RESTORE_UPLOAD_DIR is required}"
: "${MAINTENANCE_ACK:?MAINTENANCE_ACK is required}"
: "${UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES:?UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES is required}"
: "${UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES:?UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES is required}"
: "${UPLOAD_ARCHIVE_MAX_ENTRIES:?UPLOAD_ARCHIVE_MAX_ENTRIES is required}"
: "${UPLOAD_ARCHIVE_MAX_PATH_DEPTH:?UPLOAD_ARCHIVE_MAX_PATH_DEPTH is required}"
: "${RESTORE_MIN_FREE_BYTES:?RESTORE_MIN_FREE_BYTES is required}"

[[ "$RESTORE_PGPORT" =~ ^[0-9]+$ && "$RESTORE_PGPORT" -ge 1 && "$RESTORE_PGPORT" -le 65535 ]] || die 'RESTORE_PGPORT must be a valid port'
[[ "$RESTORE_UPLOAD_DIR" == /* ]] || die 'RESTORE_UPLOAD_DIR must be an absolute path'
[[ "$RESTORE_UPLOAD_DIR" != / && "$RESTORE_UPLOAD_DIR" != "${HOME:-/nonexistent}" ]] || die 'RESTORE_UPLOAD_DIR is too broad'
require_bounded_integer UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES "$UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES"
require_bounded_integer UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES "$UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES"
require_bounded_integer UPLOAD_ARCHIVE_MAX_ENTRIES "$UPLOAD_ARCHIVE_MAX_ENTRIES"
require_bounded_integer UPLOAD_ARCHIVE_MAX_PATH_DEPTH "$UPLOAD_ARCHIVE_MAX_PATH_DEPTH"
require_bounded_integer RESTORE_MIN_FREE_BYTES "$RESTORE_MIN_FREE_BYTES"
[[ -d "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT" ]] || die 'BACKUP_ROOT must be an existing non-symlink directory'
command -v pg_restore >/dev/null 2>&1 || die 'pg_restore is required'
command -v tar >/dev/null 2>&1 || die 'tar is required'
command -v python3 >/dev/null 2>&1 || die 'python3 is required'
require_private_file RESTORE_PGPASSFILE "$RESTORE_PGPASSFILE"

backup_root="$(cd "$BACKUP_ROOT" && pwd -P)"
backup_candidate="$backup_root/$backup_selector"
[[ -d "$backup_candidate" && ! -L "$backup_candidate" ]] || die 'backup does not exist or is a symlink'
backup_dir="$(cd "$backup_candidate" && pwd -P)"
require_descendant "$backup_root" "$backup_dir"

stage_dir=
old_dir=
restore_parent=
restore_target=
restore_pid=
swapped=false
had_old=false
committed=false

restore_exit() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$committed" != true ]]; then
    if [[ "$swapped" == true && -n "$restore_target" && -d "$restore_target" && ! -L "$restore_target" ]]; then
      safe_delete_tree_under "$restore_parent" "$restore_target" || true
    fi
    if [[ "$had_old" == true && -n "$old_dir" && -d "$old_dir" && ! -L "$old_dir" && ! -e "$restore_target" ]]; then
      move_exact "$old_dir" "$restore_target" || true
    fi
    if [[ -n "$stage_dir" && -d "$stage_dir" && ! -L "$stage_dir" ]]; then
      safe_delete_tree_under "$restore_parent" "$stage_dir" || true
    fi
  fi
  release_operations_lock
  exit "$status"
}

restore_signal() {
  if [[ "$committed" == true ]]; then
    printf 'WARNING: restore committed; signal received after commit. New uploads remain authoritative and old uploads are retained at %s for manual verification/removal.\n' "$old_dir" >&2
    exit 0
  fi
  if [[ -n "$restore_pid" ]]; then
    kill -TERM "$restore_pid" >/dev/null 2>&1 || true
    return
  fi
  exit 130
}

trap restore_exit EXIT
trap restore_signal INT TERM
acquire_operations_lock "$backup_root"
require_maintenance "RESTORE:$backup_selector:$RESTORE_PGDATABASE"

for required_file in COMPLETE SHA256SUMS database.dump uploads.tar.gz metadata.env; do
  [[ -f "$backup_dir/$required_file" && ! -L "$backup_dir/$required_file" ]] \
    || die "backup is incomplete: $required_file"
done
cmp -s "$backup_dir/COMPLETE" <(printf 'complete\n') || die 'invalid COMPLETE marker'

manifest_valid="$(awk '
  BEGIN { ok=1; seen_dump=0; seen_uploads=0; seen_metadata=0 }
  NF != 2 || $1 !~ /^[a-f0-9]{64}$/ { ok=0; next }
  $2 == "database.dump" { seen_dump++; next }
  $2 == "uploads.tar.gz" { seen_uploads++; next }
  $2 == "metadata.env" { seen_metadata++; next }
  { ok=0 }
  END { if (ok && seen_dump == 1 && seen_uploads == 1 && seen_metadata == 1) print "yes"; else print "no" }
' "$backup_dir/SHA256SUMS")"
[[ "$manifest_valid" == yes ]] || die 'SHA256SUMS contains unsafe or unexpected entries'
(cd "$backup_dir" && sha256_check SHA256SUMS >/dev/null) || die 'backup checksum verification failed'

restore_parent_input="${RESTORE_UPLOAD_DIR%/*}"
restore_name="${RESTORE_UPLOAD_DIR##*/}"
[[ -n "$restore_name" && "$restore_name" != . && "$restore_name" != .. ]] || die 'invalid RESTORE_UPLOAD_DIR'
[[ -d "$restore_parent_input" && ! -L "$restore_parent_input" ]] || die 'RESTORE_UPLOAD_DIR parent must be an existing non-symlink directory'
restore_parent="$(cd "$restore_parent_input" && pwd -P)"
restore_target="$restore_parent/$restore_name"
if [[ -e "$restore_target" || -L "$restore_target" ]]; then
  [[ -d "$restore_target" && ! -L "$restore_target" ]] || die 'RESTORE_UPLOAD_DIR must be a directory and not a symlink'
  [[ "$(cd "$restore_target" && pwd -P)" == "$restore_target" ]] || die 'RESTORE_UPLOAD_DIR resolves unexpectedly'
fi

archive_stats="$(validate_archive_metadata "$backup_dir/uploads.tar.gz")" || die 'upload archive failed safety or resource validation'
archive_expanded="$(printf '%s\n' "$archive_stats" | sed -n 's/.*expanded=\([0-9][0-9]*\).*/\1/p')"
[[ "$archive_expanded" =~ ^[0-9]+$ ]] || die 'upload archive validator returned invalid metadata'
free_bytes="$(filesystem_free_bytes "$restore_parent")"
required_free=$((archive_expanded + RESTORE_MIN_FREE_BYTES))
(( free_bytes >= required_free )) || die 'restore filesystem lacks configured free-space headroom'

stage_dir="$(mktemp -d "$restore_parent/.panshi-restore-stage.XXXXXX")"
old_dir="$restore_parent/.panshi-restore-old.$$"
[[ ! -e "$old_dir" && ! -L "$old_dir" ]] || die 'restore rollback path already exists'
tar -xzf "$backup_dir/uploads.tar.gz" -C "$stage_dir"
validate_extracted_tree "$stage_dir"
find "$stage_dir" -type d -exec chmod 700 {} +
find "$stage_dir" -type f -exec chmod 600 {} +

if [[ -d "$restore_target" ]]; then
  move_exact "$restore_target" "$old_dir"
  had_old=true
fi
move_exact "$stage_dir" "$restore_target"
stage_dir=
swapped=true

# The signal handler forwards pre-commit signals to pg_restore. A zero wait status is the commit boundary.
PGHOST="$RESTORE_PGHOST" \
PGPORT="$RESTORE_PGPORT" \
PGDATABASE="$RESTORE_PGDATABASE" \
PGUSER="$RESTORE_PGUSER" \
PGPASSFILE="$RESTORE_PGPASSFILE" \
  pg_restore --dbname="$RESTORE_PGDATABASE" --clean --if-exists --single-transaction --exit-on-error --no-owner --no-privileges \
    "$backup_dir/database.dump" &
restore_pid=$!
set +e
wait "$restore_pid"
restore_status=$?
set -e
restore_pid=
if [[ "$restore_status" -ne 0 ]]; then
  die 'database restore failed; uploads were rolled back'
fi
committed=true
swapped=false

if [[ -n "${PANSHI_TEST_POST_COMMIT_READY_FILE:-}" ]]; then
  : > "$PANSHI_TEST_POST_COMMIT_READY_FILE"
  : "${PANSHI_TEST_POST_COMMIT_CONTINUE_FILE:?PANSHI_TEST_POST_COMMIT_CONTINUE_FILE is required with READY_FILE}"
  while [[ ! -f "$PANSHI_TEST_POST_COMMIT_CONTINUE_FILE" ]]; do sleep 0.05; done
fi

if [[ "$had_old" == true ]]; then
  cleanup_ok=true
  if [[ "${PANSHI_TEST_FAIL_OLD_UPLOAD_CLEANUP:-}" == 1 ]]; then
    cleanup_ok=false
  elif ! safe_delete_tree_under "$restore_parent" "$old_dir"; then
    cleanup_ok=false
  fi
  if [[ "$cleanup_ok" == true ]]; then
    old_dir=
  else
    printf 'WARNING: restore committed; old uploads retained at %s. Verify the restored service, then remove that directory manually.\n' "$old_dir" >&2
  fi
fi

printf 'Restore completed from %s\n' "${backup_dir##*/}"
