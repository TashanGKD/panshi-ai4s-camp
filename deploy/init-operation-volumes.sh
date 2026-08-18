#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${OPERATIONS_UID:?OPERATIONS_UID is required}"
: "${OPERATIONS_GID:?OPERATIONS_GID is required}"
[[ "$OPERATIONS_UID" =~ ^[1-9][0-9]*$ ]] || { printf 'Invalid OPERATIONS_UID\n' >&2; exit 1; }
[[ "$OPERATIONS_GID" =~ ^[1-9][0-9]*$ ]] || { printf 'Invalid OPERATIONS_GID\n' >&2; exit 1; }

for target in /data /backups; do
  [[ -d "$target" && ! -L "$target" ]] || { printf 'Invalid volume target\n' >&2; exit 1; }
  [[ "$(cd "$target" && pwd -P)" == "$target" ]] || { printf 'Volume target resolves unexpectedly\n' >&2; exit 1; }
done

if [[ -e /data/uploads && ! -e /data/uploads/.panshi-storage-root ]]; then
  [[ -d /data/uploads && ! -L /data/uploads ]] || { printf 'Invalid unmarked upload root\n' >&2; exit 1; }
  [[ -z "$(find /data/uploads -mindepth 1 -maxdepth 1 -print -quit)" ]] || {
    printf 'Refusing to remove a non-empty unmarked upload root\n' >&2
    exit 1
  }
  rmdir /data/uploads
fi

chown -R "$OPERATIONS_UID:$OPERATIONS_GID" /data /backups
chmod 700 /data /backups
