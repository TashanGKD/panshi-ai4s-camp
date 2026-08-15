#!/usr/bin/env bash
set -euo pipefail

: "${PANSHI_REAL_PG_DUMP:?PANSHI_REAL_PG_DUMP is required}"

if [[ -n "${PANSHI_PG_DUMP_CALLED_FILE:-}" ]]; then
  : > "$PANSHI_PG_DUMP_CALLED_FILE"
fi
if [[ -n "${PANSHI_PG_DUMP_ARGS_FILE:-}" ]]; then
  printf '%s\n' "$@" > "$PANSHI_PG_DUMP_ARGS_FILE"
fi
if [[ -n "${PANSHI_PG_DUMP_READY_FILE:-}" ]]; then
  : > "$PANSHI_PG_DUMP_READY_FILE"
  : "${PANSHI_PG_DUMP_CONTINUE_FILE:?PANSHI_PG_DUMP_CONTINUE_FILE is required with READY_FILE}"
  deadline=$((SECONDS + 10))
  while [[ ! -f "$PANSHI_PG_DUMP_CONTINUE_FILE" ]]; do
    (( SECONDS < deadline )) || exit 124
    sleep 0.05
  done
fi

exec "$PANSHI_REAL_PG_DUMP" "$@"
