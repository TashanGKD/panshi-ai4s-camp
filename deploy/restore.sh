#!/usr/bin/env bash
set -euo pipefail
umask 077

die() {
  printf 'Restore failed: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf 'Usage: RESTORE_ACKNOWLEDGE=RESTORE %s --yes BACKUP_ID\n' "${0##*/}" >&2
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
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$1"
  else
    shasum -a 256 -c "$1"
  fi
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
  if mv --help >/dev/null 2>&1; then
    mv -T "$source" "$target"
  else
    mv -h "$source" "$target"
  fi
}

safe_delete_tree_under() {
  local parent="$1"
  local target="$2"
  [[ -d "$target" && ! -L "$target" ]] || die 'refusing to delete a non-directory or symlink'
  local resolved
  resolved="$(cd "$target" && pwd -P)"
  case "$resolved" in
    "$parent"/*) ;;
    *) die 'refusing to delete outside the configured restore parent' ;;
  esac
  find "$resolved" -depth -mindepth 1 -delete
  rmdir "$resolved"
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
: "${RESTORE_ACKNOWLEDGE:?RESTORE_ACKNOWLEDGE is required}"
[[ "$RESTORE_ACKNOWLEDGE" == RESTORE ]] || die 'RESTORE_ACKNOWLEDGE must equal RESTORE'
[[ "$RESTORE_PGPORT" =~ ^[0-9]+$ && "$RESTORE_PGPORT" -ge 1 && "$RESTORE_PGPORT" -le 65535 ]] || die 'RESTORE_PGPORT must be a valid port'
[[ "$RESTORE_UPLOAD_DIR" == /* ]] || die 'RESTORE_UPLOAD_DIR must be an absolute path'
[[ "$RESTORE_UPLOAD_DIR" != / && "$RESTORE_UPLOAD_DIR" != "${HOME:-/nonexistent}" ]] || die 'RESTORE_UPLOAD_DIR is too broad'
[[ -d "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT" ]] || die 'BACKUP_ROOT must be an existing non-symlink directory'
command -v pg_restore >/dev/null 2>&1 || die 'pg_restore is required'
command -v tar >/dev/null 2>&1 || die 'tar is required'
require_private_file RESTORE_PGPASSFILE "$RESTORE_PGPASSFILE"

backup_root="$(cd "$BACKUP_ROOT" && pwd -P)"
backup_candidate="$backup_root/$backup_selector"
[[ -d "$backup_candidate" && ! -L "$backup_candidate" ]] || die 'backup does not exist or is a symlink'
backup_dir="$(cd "$backup_candidate" && pwd -P)"
require_descendant "$backup_root" "$backup_dir"

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
  END {
    if (ok && seen_dump == 1 && seen_uploads == 1 && seen_metadata == 1) print "yes"
    else print "no"
  }
' "$backup_dir/SHA256SUMS")"
[[ "$manifest_valid" == yes ]] || die 'SHA256SUMS contains unsafe or unexpected entries'
(cd "$backup_dir" && sha256_check SHA256SUMS >/dev/null) || die 'backup checksum verification failed'

while IFS= read -r archive_path; do
  case "$archive_path" in
    .|./) ;;
    /*|../*|*/../*|*/..|..) die 'upload archive contains path traversal' ;;
    ./*) ;;
    *) die 'upload archive contains a non-relative entry' ;;
  esac
done < <(tar -tzf "$backup_dir/uploads.tar.gz")
if tar -tvzf "$backup_dir/uploads.tar.gz" | awk 'substr($1,1,1) !~ /^[-d]$/ { found=1 } END { exit found ? 0 : 1 }'; then
  die 'upload archive contains links or special files'
fi

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

stage_dir="$(mktemp -d "$restore_parent/.panshi-restore-stage.XXXXXX")"
old_dir="$restore_parent/.panshi-restore-old.$$"
[[ ! -e "$old_dir" && ! -L "$old_dir" ]] || die 'restore rollback path already exists'
swapped=false
had_old=false

rollback() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$swapped" == true && -d "$restore_target" && ! -L "$restore_target" ]]; then
    safe_delete_tree_under "$restore_parent" "$restore_target" || true
  fi
  if [[ "$had_old" == true && -d "$old_dir" && ! -L "$old_dir" && ! -e "$restore_target" ]]; then
    move_exact "$old_dir" "$restore_target" || true
  fi
  if [[ -d "$stage_dir" && ! -L "$stage_dir" ]]; then
    safe_delete_tree_under "$restore_parent" "$stage_dir" || true
  fi
  exit "$status"
}
trap rollback EXIT INT TERM

tar -xzf "$backup_dir/uploads.tar.gz" -C "$stage_dir"
[[ -z "$(find "$stage_dir" -type l -print -quit)" ]] || die 'extracted upload archive contains a symbolic link'
find "$stage_dir" -type d -exec chmod 700 {} +
find "$stage_dir" -type f -exec chmod 600 {} +

if [[ -d "$restore_target" ]]; then
  move_exact "$restore_target" "$old_dir"
  had_old=true
fi
move_exact "$stage_dir" "$restore_target"
swapped=true

# Validation and upload staging complete before this destructive, transactional database operation.
if ! PGHOST="$RESTORE_PGHOST" \
  PGPORT="$RESTORE_PGPORT" \
  PGDATABASE="$RESTORE_PGDATABASE" \
  PGUSER="$RESTORE_PGUSER" \
  PGPASSFILE="$RESTORE_PGPASSFILE" \
  pg_restore --dbname="$RESTORE_PGDATABASE" --clean --if-exists --single-transaction --exit-on-error --no-owner --no-privileges \
    "$backup_dir/database.dump"; then
  die 'database restore failed; uploads were rolled back'
fi

if [[ "$had_old" == true ]]; then
  safe_delete_tree_under "$restore_parent" "$old_dir"
fi
swapped=false
trap - EXIT INT TERM
printf 'Restore completed from %s\n' "${backup_dir##*/}"
