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

chown -R "$OPERATIONS_UID:$OPERATIONS_GID" /data /backups
chmod 700 /data /backups
