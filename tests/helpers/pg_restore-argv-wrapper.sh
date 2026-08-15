#!/usr/bin/env bash
set -euo pipefail

: "${PANSHI_REAL_PG_RESTORE:?PANSHI_REAL_PG_RESTORE is required}"
if [[ -n "${PANSHI_PG_RESTORE_CALLED_FILE:-}" ]]; then
  : > "$PANSHI_PG_RESTORE_CALLED_FILE"
fi
if [[ -n "${PANSHI_PG_RESTORE_ARGS_FILE:-}" ]]; then
  printf '%s\n' "$@" > "$PANSHI_PG_RESTORE_ARGS_FILE"
fi
exec "$PANSHI_REAL_PG_RESTORE" "$@"
