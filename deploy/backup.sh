#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'Backup failed: %s\n' "$*" >&2
  exit 1
}

require_directory() {
  local label="$1"
  local path="$2"
  [[ -d "$path" && ! -L "$path" ]] || die "$label must be an existing non-symlink directory"
  (cd "$path" && pwd -P)
}

require_descendant() {
  local root="$1"
  local candidate="$2"
  case "$candidate" in
    "$root"/*) ;;
    *) die 'resolved backup target is outside BACKUP_ROOT' ;;
  esac
}

sha256_write() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

sha256_check() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$1"
  else
    shasum -a 256 -c "$1"
  fi
}

manifest_is_exact() {
  [[ "$(awk '
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
  ' "$1")" == yes ]]
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

safe_delete_tree() {
  local root="$1"
  local target="$2"
  [[ -d "$target" && ! -L "$target" ]] || die 'refusing to delete a non-directory or symlink'
  local resolved
  resolved="$(cd "$target" && pwd -P)"
  require_descendant "$root" "$resolved"
  find "$resolved" -depth -mindepth 1 -delete
  rmdir "$resolved"
}

: "${BACKUP_ROOT:?BACKUP_ROOT is required}"
: "${BACKUP_RETENTION_DAYS:?BACKUP_RETENTION_DAYS is required}"
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${BACKUP_UPLOAD_DIR:?BACKUP_UPLOAD_DIR is required}"
: "${BACKUP_APP_VERSION:?BACKUP_APP_VERSION is required}"

[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || die 'BACKUP_RETENTION_DAYS must be a non-negative integer'
[[ "$BACKUP_APP_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || die 'BACKUP_APP_VERSION contains unsafe characters'
command -v pg_dump >/dev/null 2>&1 || die 'pg_dump is required'
command -v tar >/dev/null 2>&1 || die 'tar is required'

backup_root="$(require_directory BACKUP_ROOT "$BACKUP_ROOT")"
upload_root="$(require_directory BACKUP_UPLOAD_DIR "$BACKUP_UPLOAD_DIR")"

if [[ -n "$(find "$upload_root" -type l -print -quit)" ]]; then
  die 'BACKUP_UPLOAD_DIR must not contain symbolic links'
fi
if [[ -n "$(find "$upload_root" -name $'*\n*' -print -quit)" ]]; then
  die 'BACKUP_UPLOAD_DIR must not contain newline characters in names'
fi
if [[ -n "$(find "$upload_root" ! -type f ! -type d -print -quit)" ]]; then
  die 'BACKUP_UPLOAD_DIR must contain only regular files and directories'
fi

timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
backup_id="panshi-backup-${timestamp}-${BACKUP_APP_VERSION}"
final_dir="$backup_root/$backup_id"
partial_dir="$backup_root/.incomplete-${backup_id}-$$"
require_descendant "$backup_root" "$final_dir"
require_descendant "$backup_root" "$partial_dir"
[[ ! -e "$final_dir" && ! -L "$final_dir" ]] || die 'backup identifier already exists'
[[ ! -e "$partial_dir" && ! -L "$partial_dir" ]] || die 'partial backup target already exists'

partial_created=false
cleanup_partial() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$partial_created" == true && -d "$partial_dir" && ! -L "$partial_dir" ]]; then
    safe_delete_tree "$backup_root" "$partial_dir" || true
  fi
  exit "$status"
}
trap cleanup_partial EXIT INT TERM

mkdir "$partial_dir"
partial_created=true
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --file="$partial_dir/database.dump"
tar -C "$upload_root" -czf "$partial_dir/uploads.tar.gz" .
printf 'app_version=%s\ncreated_at=%s\n' "$BACKUP_APP_VERSION" "$timestamp" > "$partial_dir/metadata.env"
(
  cd "$partial_dir"
  sha256_write database.dump uploads.tar.gz metadata.env > SHA256SUMS
  sha256_check SHA256SUMS >/dev/null
  printf 'complete\n' > COMPLETE
)

move_exact "$partial_dir" "$final_dir"
partial_created=false
[[ -d "$final_dir" && ! -L "$final_dir" ]] || die 'published backup target is invalid'
[[ "$(cd "$final_dir" && pwd -P)" == "$final_dir" ]] || die 'published backup escaped BACKUP_ROOT'

# Retention intentionally considers only direct, complete, hash-valid backup directories.
while IFS= read -r expired_dir; do
  [[ -n "$expired_dir" && -d "$expired_dir" && ! -L "$expired_dir" ]] || continue
  expired_resolved="$(cd "$expired_dir" && pwd -P)"
  require_descendant "$backup_root" "$expired_resolved"
  expired_name="${expired_resolved##*/}"
  [[ "$expired_name" =~ ^panshi-backup-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || continue
  [[ -f "$expired_resolved/COMPLETE" && ! -L "$expired_resolved/COMPLETE" ]] || continue
  [[ -f "$expired_resolved/SHA256SUMS" && ! -L "$expired_resolved/SHA256SUMS" ]] || continue
  [[ -f "$expired_resolved/database.dump" && ! -L "$expired_resolved/database.dump" ]] || continue
  [[ -f "$expired_resolved/uploads.tar.gz" && ! -L "$expired_resolved/uploads.tar.gz" ]] || continue
  [[ -f "$expired_resolved/metadata.env" && ! -L "$expired_resolved/metadata.env" ]] || continue
  manifest_is_exact "$expired_resolved/SHA256SUMS" || continue
  (cd "$expired_resolved" && sha256_check SHA256SUMS >/dev/null 2>&1) || continue
  safe_delete_tree "$backup_root" "$expired_resolved"
done < <(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime "+$BACKUP_RETENTION_DAYS" -print)

printf '%s\n' "$backup_id"
