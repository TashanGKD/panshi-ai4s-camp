#!/usr/bin/env bash

require_bounded_integer() {
  local label="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] || die "$label must be an integer from 1 through 9000000000000000"
  (( 10#$value >= 1 && 10#$value <= 9000000000000000 )) \
    || die "$label must be an integer from 1 through 9000000000000000"
  printf -v "$label" '%d' "$((10#$value))"
}

require_maintenance() {
  local expected_ack="$1"
  [[ "${MAINTENANCE_ACK:-}" == "$expected_ack" ]] \
    || die "MAINTENANCE_ACK must exactly equal $expected_ack"
  : "${MAINTENANCE_API_HEALTH_URL:?MAINTENANCE_API_HEALTH_URL is required}"
  [[ "$MAINTENANCE_API_HEALTH_URL" =~ ^https?://[^[:space:][:cntrl:]@/]+(:[0-9]+)?/[^[:space:][:cntrl:]]*$ ]] \
    || die 'MAINTENANCE_API_HEALTH_URL must be an HTTP(S) URL without credentials'
  command -v curl >/dev/null 2>&1 || die 'curl is required for maintenance verification'
  local curl_status
  set +e
  curl --silent --output /dev/null --connect-timeout 2 --max-time 3 -- "$MAINTENANCE_API_HEALTH_URL"
  curl_status=$?
  set -e
  case "$curl_status" in
    0) die 'API health URL is reachable; stop frontend and API before continuing' ;;
    6|7|28) ;;
    *) die 'API health URL verification failed without proving the API is unreachable' ;;
  esac
}

OPERATIONS_LOCK_KIND=
OPERATIONS_LOCK_DIR=
acquire_operations_lock() {
  local backup_root="$1"
  if [[ "${OPERATIONS_FORCE_PORTABLE_LOCK:-}" != 1 ]] && command -v flock >/dev/null 2>&1; then
    exec 9>"$backup_root/.panshi-operations.lock"
    chmod 600 "$backup_root/.panshi-operations.lock"
    flock -n 9 || die 'another backup or restore operation holds the shared lock'
    OPERATIONS_LOCK_KIND=flock
    return
  fi

  OPERATIONS_LOCK_DIR="$backup_root/.panshi-operations.lock.d"
  if ! mkdir -m 700 "$OPERATIONS_LOCK_DIR" 2>/dev/null; then
    die 'another backup or restore operation holds the shared lock'
  fi
  printf '%s\n' "$$" > "$OPERATIONS_LOCK_DIR/pid"
  chmod 600 "$OPERATIONS_LOCK_DIR/pid"
  OPERATIONS_LOCK_KIND=portable
}

release_operations_lock() {
  case "$OPERATIONS_LOCK_KIND" in
    flock)
      flock -u 9 >/dev/null 2>&1 || true
      exec 9>&-
      ;;
    portable)
      if [[ -d "$OPERATIONS_LOCK_DIR" && ! -L "$OPERATIONS_LOCK_DIR" ]]; then
        find "$OPERATIONS_LOCK_DIR" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
        rmdir "$OPERATIONS_LOCK_DIR" >/dev/null 2>&1 || true
      fi
      ;;
  esac
  OPERATIONS_LOCK_KIND=
}

validate_archive_metadata() {
  local archive="$1"
  python3 "$OPERATIONS_SCRIPT_DIR/validate-upload-archive.py" \
    --archive "$archive" \
    --max-compressed-bytes "$UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES" \
    --max-expanded-bytes "$UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES" \
    --max-entries "$UPLOAD_ARCHIVE_MAX_ENTRIES" \
    --max-path-depth "$UPLOAD_ARCHIVE_MAX_PATH_DEPTH"
}

file_size_bytes() {
  if stat -f '%z' "$1" >/dev/null 2>&1; then stat -f '%z' "$1"; else stat -c '%s' "$1"; fi
}

filesystem_free_bytes() {
  local blocks
  blocks="$(df -Pk "$1" | awk 'NR == 2 { print $4 }')"
  [[ "$blocks" =~ ^[0-9]+$ ]] || die 'could not determine restore filesystem free space'
  printf '%s\n' "$((blocks * 1024))"
}

validate_extracted_tree() {
  local root="$1"
  local entries=0
  local expanded=0
  local path relative depth
  while IFS= read -r -d '' path; do
    entries=$((entries + 1))
    (( entries <= UPLOAD_ARCHIVE_MAX_ENTRIES )) || die 'extracted upload entry count exceeds configured maximum'
    relative="${path#"$root"/}"
    depth="$(awk -F/ '{ print NF }' <<< "$relative")"
    (( depth <= UPLOAD_ARCHIVE_MAX_PATH_DEPTH )) || die 'extracted upload path depth exceeds configured maximum'
    if [[ -f "$path" && ! -L "$path" ]]; then
      expanded=$((expanded + $(file_size_bytes "$path")))
      (( expanded <= UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES )) || die 'extracted upload bytes exceed configured maximum'
    elif [[ ! -d "$path" || -L "$path" ]]; then
      die 'extracted upload tree contains an unsupported entry'
    fi
  done < <(find "$root" -mindepth 1 -print0)
}
