#!/usr/bin/env bash
set -euo pipefail

ECS_HOST="${ECS_HOST:-101.200.234.115}"
ECS_USER="${ECS_USER:-root}"
ECS_PORT="${ECS_PORT:-13200}"
LOCAL_PORT="${LOCAL_PORT:-3200}"
IDENTITY_FILE="${IDENTITY_FILE:-/home/aup/.ssh/tashan_tunnel}"

[[ "$ECS_PORT" =~ ^[1-9][0-9]{0,4}$ && "$ECS_PORT" -le 65535 ]] || { echo 'Invalid ECS_PORT' >&2; exit 1; }
[[ "$LOCAL_PORT" =~ ^[1-9][0-9]{0,4}$ && "$LOCAL_PORT" -le 65535 ]] || { echo 'Invalid LOCAL_PORT' >&2; exit 1; }
[[ -f "$IDENTITY_FILE" && ! -L "$IDENTITY_FILE" ]] || { echo 'Tunnel identity file is unavailable' >&2; exit 1; }

exec /usr/bin/autossh -M 0 -N \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=yes \
  -i "$IDENTITY_FILE" \
  -R "127.0.0.1:${ECS_PORT}:127.0.0.1:${LOCAL_PORT}" \
  "${ECS_USER}@${ECS_HOST}"
