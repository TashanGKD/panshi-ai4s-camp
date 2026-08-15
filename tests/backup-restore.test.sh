#!/usr/bin/env bash
set -euo pipefail
export COPYFILE_DISABLE=1

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BACKUP_SCRIPT="$PROJECT_ROOT/deploy/backup.sh"
RESTORE_SCRIPT="$PROJECT_ROOT/deploy/restore.sh"
OPERATIONS_COMMON="$PROJECT_ROOT/deploy/operations-common.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  grep -Eq -- "$pattern" "$file" || fail "$file does not satisfy contract: $pattern"
}

[[ -x "$BACKUP_SCRIPT" ]] || fail "missing executable deploy/backup.sh"
[[ -x "$RESTORE_SCRIPT" ]] || fail "missing executable deploy/restore.sh"

# Hermetic contract gate: this always runs, including environments without PostgreSQL.
assert_file_contains "$BACKUP_SCRIPT" '^set -euo pipefail$'
assert_file_contains "$BACKUP_SCRIPT" 'pg_dump'
assert_file_contains "$BACKUP_SCRIPT" '--format=custom'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_ROOT'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_RETENTION_DAYS'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_PGHOST'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_PGDATABASE'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_PGPASSFILE'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_UPLOAD_DIR'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_APP_VERSION'
assert_file_contains "$BACKUP_SCRIPT" 'MAINTENANCE_ACK'
assert_file_contains "$BACKUP_SCRIPT" 'MAINTENANCE_API_HEALTH_URL'
assert_file_contains "$BACKUP_SCRIPT" 'UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES'
assert_file_contains "$RESTORE_SCRIPT" '^set -euo pipefail$'
assert_file_contains "$RESTORE_SCRIPT" 'pg_restore'
assert_file_contains "$RESTORE_SCRIPT" '--single-transaction'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_PGHOST'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_PGDATABASE'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_PGPASSFILE'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_UPLOAD_DIR'
assert_file_contains "$RESTORE_SCRIPT" 'MAINTENANCE_ACK'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_MIN_FREE_BYTES'
assert_file_contains "$OPERATIONS_COMMON" "6\|7\)"
assert_file_contains "$OPERATIONS_COMMON" "flock is required"
if grep -Eq 'OPERATIONS_FORCE_PORTABLE_LOCK|panshi-operations\.lock\.d' "$OPERATIONS_COMMON"; then
  fail 'operations lock contains an unsafe portable fallback'
fi

for command in initdb pg_ctl createdb dropdb psql pg_dump pg_restore; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'SKIP real PostgreSQL backup/restore: missing %s (static contract gate passed)\n' "$command"
    exit 0
  fi
done

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/panshi-task18-backup-restore.XXXXXX")"
PGDATA="$TEST_ROOT/panshi_task18_pgdata"
PGSOCKET="/tmp/panshi-task18-sock.$$"
BACKUP_ROOT="$TEST_ROOT/panshi_task18_backups"
SOURCE_UPLOADS="$TEST_ROOT/panshi_task18_source_uploads"
RESTORE_UPLOADS="$TEST_ROOT/panshi_task18_restore_uploads"
DATA_ROOT="$TEST_ROOT/panshi_task18_data"
OUTSIDE_ROOT="$TEST_ROOT/panshi_task18_outside"
PGPORT=$((55000 + ($$ % 1000)))
PGUSER=panshi_task18_owner
SOURCE_DB=panshi_task18_source
RESTORE_DB=panshi_task18_restore
SOURCE_URL="postgresql://$PGUSER@127.0.0.1:$PGPORT/$SOURCE_DB"
RESTORE_URL="postgresql://$PGUSER@127.0.0.1:$PGPORT/$RESTORE_DB"
PGPASSFILE="$TEST_ROOT/panshi_task18.pgpass"
REAL_PG_DUMP="$(command -v pg_dump)"
REAL_PG_RESTORE="$(command -v pg_restore)"
PG_DUMP_WRAPPER_DIR="$TEST_ROOT/panshi_task18_bin"
FLOCK_WRAPPER_DIR="$TEST_ROOT/panshi_task18_flock_bin"
SERVER_STARTED=false
HEALTH_SERVER_PID=

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$HEALTH_SERVER_PID" ]]; then
    kill "$HEALTH_SERVER_PID" >/dev/null 2>&1 || true
    wait "$HEALTH_SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$SERVER_STARTED" == true ]]; then
    pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [[ -d "$PGSOCKET" && ! -L "$PGSOCKET" ]]; then
    find "$PGSOCKET" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "$PGSOCKET" >/dev/null 2>&1 || true
  fi
  find "$TEST_ROOT" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
  rmdir "$TEST_ROOT" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$PGSOCKET" "$BACKUP_ROOT" "$SOURCE_UPLOADS/nested" "$DATA_ROOT/uploads" "$OUTSIDE_ROOT" "$PG_DUMP_WRAPPER_DIR" "$FLOCK_WRAPPER_DIR"
RESTORE_UPLOADS="$DATA_ROOT/uploads"
TEST_DATABASE_SECRET='panshi-task18-secret-password'
printf '127.0.0.1:%s:*:%s:%s\n' "$PGPORT" "$PGUSER" "$TEST_DATABASE_SECRET" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
ln -s "$PROJECT_ROOT/tests/helpers/pg_dump-delay-wrapper.sh" "$PG_DUMP_WRAPPER_DIR/pg_dump"
ln -s "$PROJECT_ROOT/tests/helpers/pg_restore-argv-wrapper.sh" "$PG_DUMP_WRAPPER_DIR/pg_restore"
ln -s "$PROJECT_ROOT/tests/helpers/flock-compat.py" "$FLOCK_WRAPPER_DIR/flock"
export PATH="$FLOCK_WRAPPER_DIR:$PATH"

NO_FLOCK_BIN="$TEST_ROOT/panshi_task18_no_flock_bin"
mkdir "$NO_FLOCK_BIN"
ln -s "$(command -v bash)" "$NO_FLOCK_BIN/bash"
NO_FLOCK_OUTPUT="$TEST_ROOT/panshi_task18_no_flock_output"
if env PATH="$NO_FLOCK_BIN" bash -c '
  die() { printf "%s\n" "$*" >&2; exit 1; }
  source "$1"
  acquire_operations_lock "$2"
' bash "$OPERATIONS_COMMON" "$BACKUP_ROOT" >"$NO_FLOCK_OUTPUT" 2>&1; then
  fail 'operations lock succeeded without flock'
fi
grep -Fq 'flock is required' "$NO_FLOCK_OUTPUT" || fail 'missing flock did not produce a clear failure'
initdb -D "$PGDATA" -A trust -U "$PGUSER" --no-locale >/dev/null
pg_ctl -D "$PGDATA" -l "$TEST_ROOT/panshi_task18_postgres.log" -o "-F -h 127.0.0.1 -k $PGSOCKET -p $PGPORT" -w start >/dev/null
SERVER_STARTED=true
createdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$SOURCE_DB"

for migration in "$PROJECT_ROOT"/apps/api/drizzle/*.sql; do
  psql "$SOURCE_URL" -v ON_ERROR_STOP=1 -X -q -f "$migration"
done

ATTACHMENT_CONTENT='panshi task 18 attachment payload'
printf '%s' "$ATTACHMENT_CONTENT" > "$SOURCE_UPLOADS/nested/task18-attachment.txt"
ATTACHMENT_SHA="$(shasum -a 256 "$SOURCE_UPLOADS/nested/task18-attachment.txt" | awk '{print $1}')"

BACKUP_ENV=(
  BACKUP_ROOT="$BACKUP_ROOT"
  BACKUP_RETENTION_DAYS=7
  BACKUP_PGHOST=127.0.0.1
  BACKUP_PGPORT="$PGPORT"
  BACKUP_PGDATABASE="$SOURCE_DB"
  BACKUP_PGUSER="$PGUSER"
  BACKUP_PGPASSFILE="$PGPASSFILE"
  BACKUP_UPLOAD_DIR="$SOURCE_UPLOADS"
  BACKUP_APP_VERSION=task18-test
  MAINTENANCE_ACK="BACKUP:$SOURCE_DB"
  MAINTENANCE_API_HEALTH_URL=http://127.0.0.1:1/healthz
  UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES=10485760
  UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES=20971520
  UPLOAD_ARCHIVE_MAX_ENTRIES=1000
  UPLOAD_ARCHIVE_MAX_PATH_DEPTH=16
)
RESTORE_ENV=(
  BACKUP_ROOT="$BACKUP_ROOT"
  RESTORE_PGHOST=127.0.0.1
  RESTORE_PGPORT="$PGPORT"
  RESTORE_PGDATABASE="$RESTORE_DB"
  RESTORE_PGUSER="$PGUSER"
  RESTORE_PGPASSFILE="$PGPASSFILE"
  RESTORE_UPLOAD_DIR="$RESTORE_UPLOADS"
  MAINTENANCE_API_HEALTH_URL=http://127.0.0.1:1/healthz
  UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES=10485760
  UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES=20971520
  UPLOAD_ARCHIVE_MAX_ENTRIES=1000
  UPLOAD_ARCHIVE_MAX_PATH_DEPTH=16
  RESTORE_MIN_FREE_BYTES=1048576
)

psql "$SOURCE_URL" -v ON_ERROR_STOP=1 -X -q \
  -v attachment_sha="$ATTACHMENT_SHA" \
  -v attachment_size="${#ATTACHMENT_CONTENT}" <<'SQL'
INSERT INTO users (id, phone_normalized, password_hash, role, display_name)
VALUES ('18000000-0000-4000-8000-000000000001', '+8613818000018', 'task18-hash', 'user', 'Task 18 Test User');
INSERT INTO content_modules (key, draft, draft_revision)
VALUES ('task18', '{"fixture":true}'::jsonb, 1);
INSERT INTO content_versions (id, module_key, version, payload, created_by)
VALUES (
  '18000000-0000-4000-8000-000000000002', 'task18', 1,
  '{"title":"Task 18 Backup Fixture"}'::jsonb,
  '18000000-0000-4000-8000-000000000001'
);
INSERT INTO files (
  id, storage_key, original_name, mime_type, size_bytes, sha256,
  uploaded_by, owner_user_id, purpose, visibility
)
VALUES (
  '18000000-0000-4000-8000-000000000003', 'nested/task18-attachment.txt',
  'task18-attachment.txt', 'text/plain', :'attachment_size', :'attachment_sha',
  '18000000-0000-4000-8000-000000000001',
  '18000000-0000-4000-8000-000000000001', 'registration_attachment', 'owner_admin'
);
SQL

# Rejection: maintenance must be target-bound and the configured API health URL must be unreachable.
WRONG_MAINTENANCE_CALLED="$TEST_ROOT/panshi_task18_wrong_maintenance_called"
if env \
  "${BACKUP_ENV[@]}" \
  MAINTENANCE_ACK="BACKUP:not-$SOURCE_DB" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_DUMP=/usr/bin/false \
  PANSHI_PG_DUMP_CALLED_FILE="$WRONG_MAINTENANCE_CALLED" \
  "$BACKUP_SCRIPT" >/dev/null 2>&1; then
  fail 'backup accepted a maintenance acknowledgement for another database'
fi
[[ ! -e "$WRONG_MAINTENANCE_CALLED" ]] || fail 'backup checked target-bound maintenance after pg_dump'

HEALTH_PORT=$((59000 + ($$ % 500)))
node -e 'require("node:http").createServer((_q,r)=>r.end("ok")).listen(Number(process.argv[1]), "127.0.0.1")' "$HEALTH_PORT" &
HEALTH_SERVER_PID=$!
health_deadline=$((SECONDS + 5))
until curl -fsS "http://127.0.0.1:$HEALTH_PORT/healthz" >/dev/null 2>&1; do
  (( SECONDS < health_deadline )) || fail 'maintenance health fixture did not start'
  sleep 0.05
done
REACHABLE_CALLED="$TEST_ROOT/panshi_task18_reachable_called"
if env \
  "${BACKUP_ENV[@]}" \
  MAINTENANCE_API_HEALTH_URL="http://127.0.0.1:$HEALTH_PORT/healthz" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_DUMP=/usr/bin/false \
  PANSHI_PG_DUMP_CALLED_FILE="$REACHABLE_CALLED" \
  "$BACKUP_SCRIPT" >/dev/null 2>&1; then
  fail 'backup accepted a reachable API during maintenance'
fi
[[ ! -e "$REACHABLE_CALLED" ]] || fail 'backup checked API reachability after pg_dump'
kill "$HEALTH_SERVER_PID"
wait "$HEALTH_SERVER_PID" >/dev/null 2>&1 || true
HEALTH_SERVER_PID=

# Rejection: a TCP listener that accepts but never answers is not proof of maintenance.
node -e 'require("node:net").createServer(()=>{}).listen(Number(process.argv[1]), "127.0.0.1")' "$HEALTH_PORT" &
HEALTH_SERVER_PID=$!
health_deadline=$((SECONDS + 5))
until node -e '
  const socket=require("node:net").connect(Number(process.argv[1]), "127.0.0.1");
  socket.on("connect",()=>{ socket.destroy(); process.exit(0) });
  socket.on("error",()=>process.exit(1));
  setTimeout(()=>process.exit(1), 200);
' "$HEALTH_PORT"; do
  (( SECONDS < health_deadline )) || fail 'hung maintenance fixture did not start'
  sleep 0.05
done
HUNG_BACKUP_CALLED="$TEST_ROOT/panshi_task18_hung_backup_called"
if env \
  "${BACKUP_ENV[@]}" \
  MAINTENANCE_API_HEALTH_URL="http://127.0.0.1:$HEALTH_PORT/healthz" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_DUMP=/usr/bin/false \
  PANSHI_PG_DUMP_CALLED_FILE="$HUNG_BACKUP_CALLED" \
  "$BACKUP_SCRIPT" >/dev/null 2>&1; then
  fail 'backup accepted a timed-out maintenance health check'
fi
[[ ! -e "$HUNG_BACKUP_CALLED" ]] || fail 'timed-out backup maintenance check reached pg_dump'
kill "$HEALTH_SERVER_PID"
wait "$HEALTH_SERVER_PID" >/dev/null 2>&1 || true
HEALTH_SERVER_PID=

# Rejection: libpq password files must be private before any database command runs.
INSECURE_PGPASSFILE="$TEST_ROOT/panshi_task18_insecure.pgpass"
cp "$PGPASSFILE" "$INSECURE_PGPASSFILE"
chmod 644 "$INSECURE_PGPASSFILE"
INSECURE_CALLED="$TEST_ROOT/panshi_task18_insecure_called"
if env \
  "${BACKUP_ENV[@]}" \
  BACKUP_PGPASSFILE="$INSECURE_PGPASSFILE" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_DUMP=/usr/bin/false \
  PANSHI_PG_DUMP_CALLED_FILE="$INSECURE_CALLED" \
  "$BACKUP_SCRIPT" >/dev/null 2>&1; then
  fail 'backup accepted a group/world-readable PGPASSFILE'
fi
[[ ! -e "$INSECURE_CALLED" ]] || fail 'backup checked PGPASSFILE permissions after pg_dump'

# Rejection: backup and upload roots must be disjoint before pg_dump runs.
OVERLAP_BASE="$TEST_ROOT/panshi_task18_overlap"
mkdir -p "$OVERLAP_BASE/backup/uploads" "$OVERLAP_BASE/upload/backup"
overlap_case=0
while IFS='|' read -r overlap_backup overlap_upload; do
  overlap_case=$((overlap_case + 1))
  called_file="$TEST_ROOT/panshi_task18_overlap_called_$overlap_case"
  if env \
    "${BACKUP_ENV[@]}" \
    BACKUP_ROOT="$overlap_backup" \
    BACKUP_UPLOAD_DIR="$overlap_upload" \
    PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
    PANSHI_REAL_PG_DUMP=/usr/bin/false \
    PANSHI_PG_DUMP_CALLED_FILE="$called_file" \
    "$BACKUP_SCRIPT" >/dev/null 2>&1; then
    fail "backup accepted overlapping roots: $overlap_backup | $overlap_upload"
  fi
  [[ ! -e "$called_file" ]] || fail 'overlap validation ran after pg_dump'
done <<EOF
$OVERLAP_BASE/backup|$OVERLAP_BASE/backup
$OVERLAP_BASE/backup|$OVERLAP_BASE/backup/uploads
$OVERLAP_BASE/upload/backup|$OVERLAP_BASE/upload
EOF

# Rejection: a symlink inserted while pg_dump is running must prevent COMPLETE publication.
RACE_READY="$TEST_ROOT/panshi_task18_race_ready"
RACE_CONTINUE="$TEST_ROOT/panshi_task18_race_continue"
RACE_OUTPUT="$TEST_ROOT/panshi_task18_race_output"
env \
  "${BACKUP_ENV[@]}" \
  BACKUP_APP_VERSION=race-check \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_DUMP="$REAL_PG_DUMP" \
  PANSHI_PG_DUMP_READY_FILE="$RACE_READY" \
  PANSHI_PG_DUMP_CONTINUE_FILE="$RACE_CONTINUE" \
  "$BACKUP_SCRIPT" >"$RACE_OUTPUT" 2>&1 &
race_pid=$!
race_deadline=$((SECONDS + 5))
while [[ ! -f "$RACE_READY" ]]; do
  (( SECONDS < race_deadline )) || fail 'pg_dump race wrapper did not become ready'
  sleep 0.05
done
ln -s "$OUTSIDE_ROOT" "$SOURCE_UPLOADS/race-link"
: > "$RACE_CONTINUE"
if wait "$race_pid"; then
  fail 'backup published after a symlink was inserted during pg_dump'
fi
if grep -Fq "$TEST_DATABASE_SECRET" "$RACE_OUTPUT"; then
  fail 'backup failure output leaked the database password'
fi
unlink "$SOURCE_UPLOADS/race-link"
[[ -z "$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -name '*race-check*' -print -quit)" ]] \
  || fail 'race failure left a published or partial backup'

# Rejection: upload trees containing a symlink must fail without leaving partial backups.
ln -s "$OUTSIDE_ROOT" "$SOURCE_UPLOADS/escape-link"
if env "${BACKUP_ENV[@]}" "$BACKUP_SCRIPT" >/dev/null 2>&1; then
  fail 'backup accepted an upload symlink escape'
fi
[[ -z "$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -name '.incomplete-*' -print -quit)" ]] \
  || fail 'failed backup left an incomplete directory'
unlink "$SOURCE_UPLOADS/escape-link"

# Retention must ignore incomplete directories and symlink escapes.
mkdir "$BACKUP_ROOT/panshi-backup-20000101T000000Z-incomplete"
touch -t 200001010000 "$BACKUP_ROOT/panshi-backup-20000101T000000Z-incomplete"
ln -s "$OUTSIDE_ROOT" "$BACKUP_ROOT/panshi-backup-20000101T000000Z-symlink"

PG_DUMP_ARGS="$TEST_ROOT/panshi_task18_pg_dump_args"
BACKUP_ID="$(env \
  "${BACKUP_ENV[@]}" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_DUMP="$REAL_PG_DUMP" \
  PANSHI_PG_DUMP_ARGS_FILE="$PG_DUMP_ARGS" \
  "$BACKUP_SCRIPT")"
if grep -Eq "127\\.0\\.0\\.1|$PGUSER|postgresql://|password" "$PG_DUMP_ARGS"; then
  fail 'backup database connection details appeared in pg_dump argv'
fi

[[ "$BACKUP_ID" =~ ^panshi-backup-[0-9]{8}T[0-9]{6}Z-task18-test$ ]] || fail "unsafe backup identifier: $BACKUP_ID"
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_ID"
RESTORE_ENV+=(MAINTENANCE_ACK="RESTORE:$BACKUP_ID:$RESTORE_DB")
[[ -f "$BACKUP_DIR/COMPLETE" ]] || fail 'backup lacks COMPLETE marker'
[[ -f "$BACKUP_DIR/database.dump" ]] || fail 'backup lacks custom database dump'
[[ -f "$BACKUP_DIR/uploads.tar.gz" ]] || fail 'backup lacks upload archive'
[[ -f "$BACKUP_DIR/SHA256SUMS" ]] || fail 'backup lacks SHA-256 manifest'
(cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS >/dev/null)
mode_of() { if stat -f '%Lp' "$1" >/dev/null 2>&1; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi; }
[[ "$(mode_of "$BACKUP_DIR")" == 700 ]] || fail 'backup directory is not mode 0700'
for private_file in database.dump uploads.tar.gz metadata.env SHA256SUMS COMPLETE; do
  [[ "$(mode_of "$BACKUP_DIR/$private_file")" == 600 ]] || fail "$private_file is not mode 0600"
done
[[ -d "$BACKUP_ROOT/panshi-backup-20000101T000000Z-incomplete" ]] || fail 'retention deleted an incomplete backup'
[[ -L "$BACKUP_ROOT/panshi-backup-20000101T000000Z-symlink" ]] || fail 'retention followed or deleted a symlink'
[[ -d "$OUTSIDE_ROOT" ]] || fail 'retention escaped the backup root'

# Rejection: restore also rejects a health check that connects but times out.
node -e 'require("node:net").createServer(()=>{}).listen(Number(process.argv[1]), "127.0.0.1")' "$HEALTH_PORT" &
HEALTH_SERVER_PID=$!
sleep 0.1
HUNG_RESTORE_UPLOADS="$DATA_ROOT/hung-restore-uploads"
mkdir "$HUNG_RESTORE_UPLOADS"
printf unchanged > "$HUNG_RESTORE_UPLOADS/sentinel.txt"
HUNG_RESTORE_CALLED="$TEST_ROOT/panshi_task18_hung_restore_called"
if env \
  "${RESTORE_ENV[@]}" \
  RESTORE_UPLOAD_DIR="$HUNG_RESTORE_UPLOADS" \
  MAINTENANCE_API_HEALTH_URL="http://127.0.0.1:$HEALTH_PORT/healthz" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_RESTORE=/usr/bin/true \
  PANSHI_PG_RESTORE_CALLED_FILE="$HUNG_RESTORE_CALLED" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore accepted a timed-out maintenance health check'
fi
[[ ! -e "$HUNG_RESTORE_CALLED" ]] || fail 'timed-out restore maintenance check reached pg_restore'
[[ "$(<"$HUNG_RESTORE_UPLOADS/sentinel.txt")" == unchanged ]] || fail 'timed-out restore mutated uploads'
kill "$HEALTH_SERVER_PID"
wait "$HEALTH_SERVER_PID" >/dev/null 2>&1 || true
HEALTH_SERVER_PID=

# Rejection: restore acknowledgement is exact and binds backup ID plus target database.
WRONG_RESTORE_UPLOADS="$DATA_ROOT/wrong-ack-uploads"
mkdir "$WRONG_RESTORE_UPLOADS"
printf 'unchanged' > "$WRONG_RESTORE_UPLOADS/sentinel.txt"
WRONG_RESTORE_CALLED="$TEST_ROOT/panshi_task18_wrong_restore_called"
if env \
  "${RESTORE_ENV[@]}" \
  RESTORE_UPLOAD_DIR="$WRONG_RESTORE_UPLOADS" \
  MAINTENANCE_ACK="RESTORE:$BACKUP_ID:not-$RESTORE_DB" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_RESTORE=/usr/bin/true \
  PANSHI_PG_RESTORE_CALLED_FILE="$WRONG_RESTORE_CALLED" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore accepted maintenance acknowledgement for another target'
fi
[[ ! -e "$WRONG_RESTORE_CALLED" ]] || fail 'restore checked target-bound maintenance after pg_restore'
[[ "$(<"$WRONG_RESTORE_UPLOADS/sentinel.txt")" == unchanged ]] || fail 'wrong restore acknowledgement mutated uploads'

# Rejection: backup and restore share one exclusive flock on BACKUP_ROOT.
LOCK_READY="$TEST_ROOT/panshi_task18_lock_ready"
LOCK_CONTINUE="$TEST_ROOT/panshi_task18_lock_continue"
env \
  "${BACKUP_ENV[@]}" \
  BACKUP_APP_VERSION=lock-holder \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_DUMP="$REAL_PG_DUMP" \
  PANSHI_PG_DUMP_READY_FILE="$LOCK_READY" \
  PANSHI_PG_DUMP_CONTINUE_FILE="$LOCK_CONTINUE" \
  "$BACKUP_SCRIPT" >/dev/null 2>&1 &
lock_pid=$!
lock_deadline=$((SECONDS + 5))
while [[ ! -f "$LOCK_READY" ]]; do
  (( SECONDS < lock_deadline )) || fail 'lock holder did not reach pg_dump'
  sleep 0.05
done
[[ -f "$BACKUP_ROOT/.panshi-operations.lock" ]] || fail 'shared flock file was not created'
LOCKED_RESTORE_CALLED="$TEST_ROOT/panshi_task18_locked_restore_called"
if env \
  "${RESTORE_ENV[@]}" \
  RESTORE_UPLOAD_DIR="$WRONG_RESTORE_UPLOADS" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_RESTORE=/usr/bin/true \
  PANSHI_PG_RESTORE_CALLED_FILE="$LOCKED_RESTORE_CALLED" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore acquired the shared lock while backup held it'
fi
[[ ! -e "$LOCKED_RESTORE_CALLED" ]] || fail 'locked restore reached pg_restore'
kill -TERM "$lock_pid"
: > "$LOCK_CONTINUE"
wait "$lock_pid" >/dev/null 2>&1 || true
env "${BACKUP_ENV[@]}" BACKUP_APP_VERSION=lock-reacquire "$BACKUP_SCRIPT" >/dev/null \
  || fail 'shared flock could not be reacquired after signal termination'

# Rejection: one restore excludes a second restore for the full operation.
RESTORE_LOCK_ONE="$DATA_ROOT/restore-lock-one"
RESTORE_LOCK_TWO="$DATA_ROOT/restore-lock-two"
mkdir "$RESTORE_LOCK_ONE" "$RESTORE_LOCK_TWO"
printf first > "$RESTORE_LOCK_ONE/sentinel.txt"
printf second > "$RESTORE_LOCK_TWO/sentinel.txt"
RESTORE_LOCK_READY="$TEST_ROOT/panshi_task18_restore_lock_ready"
RESTORE_LOCK_CONTINUE="$TEST_ROOT/panshi_task18_restore_lock_continue"
env \
  "${RESTORE_ENV[@]}" \
  RESTORE_UPLOAD_DIR="$RESTORE_LOCK_ONE" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_RESTORE=/usr/bin/true \
  PANSHI_PG_RESTORE_READY_FILE="$RESTORE_LOCK_READY" \
  PANSHI_PG_RESTORE_CONTINUE_FILE="$RESTORE_LOCK_CONTINUE" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1 &
restore_lock_pid=$!
restore_lock_deadline=$((SECONDS + 5))
while [[ ! -f "$RESTORE_LOCK_READY" ]]; do
  (( SECONDS < restore_lock_deadline )) || fail 'restore lock holder did not reach pg_restore'
  sleep 0.05
done
SECOND_RESTORE_CALLED="$TEST_ROOT/panshi_task18_second_restore_called"
if env \
  "${RESTORE_ENV[@]}" \
  RESTORE_UPLOAD_DIR="$RESTORE_LOCK_TWO" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_RESTORE=/usr/bin/true \
  PANSHI_PG_RESTORE_CALLED_FILE="$SECOND_RESTORE_CALLED" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'second restore acquired the shared flock'
fi
[[ ! -e "$SECOND_RESTORE_CALLED" ]] || fail 'second restore reached pg_restore while first restore held flock'
[[ "$(<"$RESTORE_LOCK_TWO/sentinel.txt")" == second ]] || fail 'locked second restore mutated uploads'
: > "$RESTORE_LOCK_CONTINUE"
wait "$restore_lock_pid" || fail 'first restore failed after releasing test delay'

# A direct, complete, hash-valid expired backup is the only retention deletion target.
VALID_EXPIRED="$BACKUP_ROOT/panshi-backup-20000101T000000Z-valid"
cp -R "$BACKUP_DIR" "$VALID_EXPIRED"
touch -t 200001010000 "$VALID_EXPIRED"
INVALID_MARKER_EXPIRED="$BACKUP_ROOT/panshi-backup-20000101T000000Z-invalid-marker"
cp -R "$BACKUP_DIR" "$INVALID_MARKER_EXPIRED"
printf 'not-complete\n' > "$INVALID_MARKER_EXPIRED/COMPLETE"
touch -t 200001010000 "$INVALID_MARKER_EXPIRED"
env \
  "${BACKUP_ENV[@]}" \
  BACKUP_APP_VERSION=retention-check \
  "$BACKUP_SCRIPT" >/dev/null
[[ ! -e "$VALID_EXPIRED" ]] || fail 'retention did not delete a validated expired backup'
[[ -d "$INVALID_MARKER_EXPIRED" ]] || fail 'retention deleted a backup with an invalid COMPLETE marker'
[[ -d "$BACKUP_ROOT/panshi-backup-20000101T000000Z-incomplete" ]] || fail 'retention deleted an incomplete backup during valid cleanup'
[[ -L "$BACKUP_ROOT/panshi-backup-20000101T000000Z-symlink" ]] || fail 'retention deleted a symlink during valid cleanup'

# Rejection: finalized archives with unsafe entry metadata must fail before pg_restore.
ATTACK_SOURCE="$TEST_ROOT/panshi_task18_attack_source"
mkdir -p "$ATTACK_SOURCE/nested"
printf 'payload' > "$ATTACK_SOURCE/payload"
ln -s "$OUTSIDE_ROOT" "$ATTACK_SOURCE/symlink"
ln "$ATTACK_SOURCE/payload" "$ATTACK_SOURCE/hardlink"
mkfifo "$ATTACK_SOURCE/fifo"
for attack_kind in symlink hardlink fifo sparse absolute traversal; do
  attack_id="panshi-backup-20000101T000000Z-attack-$attack_kind"
  attack_backup="$BACKUP_ROOT/$attack_id"
  cp -R "$BACKUP_DIR" "$attack_backup"
  case "$attack_kind" in
    symlink) tar -C "$ATTACK_SOURCE" -czf "$attack_backup/uploads.tar.gz" symlink ;;
    hardlink) tar -C "$ATTACK_SOURCE" -czf "$attack_backup/uploads.tar.gz" payload hardlink ;;
    fifo) tar -C "$ATTACK_SOURCE" -czf "$attack_backup/uploads.tar.gz" fifo ;;
    sparse) python3 - "$attack_backup/uploads.tar.gz" <<'PY'
import sys
import tarfile
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    entry = tarfile.TarInfo('./sparse')
    entry.type = tarfile.GNUTYPE_SPARSE
    entry.size = 0
    archive.addfile(entry)
PY
      ;;
    absolute) tar -P -czf "$attack_backup/uploads.tar.gz" "$ATTACK_SOURCE/payload" ;;
    traversal) tar -C "$ATTACK_SOURCE/nested" -czf "$attack_backup/uploads.tar.gz" ../payload ;;
  esac
  (cd "$attack_backup" && shasum -a 256 database.dump uploads.tar.gz metadata.env > SHA256SUMS)
  restore_called="$TEST_ROOT/panshi_task18_restore_called_$attack_kind"
  if env \
    "${RESTORE_ENV[@]}" \
    MAINTENANCE_ACK="RESTORE:$attack_id:$RESTORE_DB" \
    PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
    PANSHI_REAL_PG_RESTORE=/usr/bin/false \
    PANSHI_PG_RESTORE_CALLED_FILE="$restore_called" \
    "$RESTORE_SCRIPT" --yes "$attack_id" >/dev/null 2>&1; then
    fail "restore accepted unsafe $attack_kind archive"
  fi
  [[ ! -e "$restore_called" ]] || fail "restore validated $attack_kind archive after pg_restore"
done

# Rejection: archive resource limits are checked before upload/database mutation.
RESOURCE_SOURCE="$TEST_ROOT/panshi_task18_resource_source"
mkdir -p "$RESOURCE_SOURCE/deep/one/two"
printf a > "$RESOURCE_SOURCE/a"
printf b > "$RESOURCE_SOURCE/b"
dd if=/dev/zero of="$RESOURCE_SOURCE/large" bs=2048 count=1 >/dev/null 2>&1
printf deep > "$RESOURCE_SOURCE/deep/one/two/file"
for resource_kind in compressed entries expanded depth free; do
  resource_id="panshi-backup-20000101T000000Z-resource-$resource_kind"
  resource_backup="$BACKUP_ROOT/$resource_id"
  cp -R "$BACKUP_DIR" "$resource_backup"
  case "$resource_kind" in
    entries) tar -C "$RESOURCE_SOURCE" -czf "$resource_backup/uploads.tar.gz" ./a ./b ;;
    expanded) tar -C "$RESOURCE_SOURCE" -czf "$resource_backup/uploads.tar.gz" ./large ;;
    depth) tar -C "$RESOURCE_SOURCE" -czf "$resource_backup/uploads.tar.gz" ./deep/one/two/file ;;
  esac
  (cd "$resource_backup" && shasum -a 256 database.dump uploads.tar.gz metadata.env > SHA256SUMS)
  resource_called="$TEST_ROOT/panshi_task18_resource_called_$resource_kind"
  resource_uploads="$DATA_ROOT/resource-$resource_kind"
  mkdir "$resource_uploads"
  printf unchanged > "$resource_uploads/sentinel.txt"
  resource_limits=(
    UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES=10485760
    UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES=20971520
    UPLOAD_ARCHIVE_MAX_ENTRIES=1000
    UPLOAD_ARCHIVE_MAX_PATH_DEPTH=16
    RESTORE_MIN_FREE_BYTES=1048576
  )
  case "$resource_kind" in
    compressed) resource_limits+=(UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES=1) ;;
    entries) resource_limits+=(UPLOAD_ARCHIVE_MAX_ENTRIES=1) ;;
    expanded) resource_limits+=(UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES=100) ;;
    depth) resource_limits+=(UPLOAD_ARCHIVE_MAX_PATH_DEPTH=2) ;;
    free) resource_limits+=(RESTORE_MIN_FREE_BYTES=9000000000000000) ;;
  esac
  if env \
    "${RESTORE_ENV[@]}" \
    "${resource_limits[@]}" \
    RESTORE_UPLOAD_DIR="$resource_uploads" \
    MAINTENANCE_ACK="RESTORE:$resource_id:$RESTORE_DB" \
    PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
    PANSHI_REAL_PG_RESTORE=/usr/bin/true \
    PANSHI_PG_RESTORE_CALLED_FILE="$resource_called" \
    "$RESTORE_SCRIPT" --yes "$resource_id" >/dev/null 2>&1; then
    fail "restore accepted excessive archive resource: $resource_kind"
  fi
  [[ ! -e "$resource_called" ]] || fail "$resource_kind limit was checked after pg_restore"
  [[ "$(<"$resource_uploads/sentinel.txt")" == unchanged ]] || fail "$resource_kind rejection mutated uploads"
done

# Rejection: traversal and symlink backup selectors must fail before database/upload changes.
printf 'sentinel' > "$RESTORE_UPLOADS/sentinel.txt"
for invalid_backup in \
  '../outside' \
  'sub/../panshi-backup-20260815T020304Z-safe' \
  '-panshi-backup-20260815T020304Z-safe' \
  $'panshi-backup-20260815T020304Z-safe\ncontrol' \
  $'panshi-backup-20260815T020304Z-safe\tcontrol' \
  "$BACKUP_DIR" \
  'panshi-backup-20000101T000000Z-symlink'; do
  if env "${RESTORE_ENV[@]}" "$RESTORE_SCRIPT" --yes "$invalid_backup" >/dev/null 2>&1; then
    fail "restore accepted unsafe backup selector: $invalid_backup"
  fi
  [[ "$(<"$RESTORE_UPLOADS/sentinel.txt")" == sentinel ]] || fail 'unsafe restore modified uploads'
done

if env \
  "${RESTORE_ENV[@]}" \
  MAINTENANCE_ACK= \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore accepted a missing acknowledgement'
fi
if env \
  "${RESTORE_ENV[@]}" \
  "$RESTORE_SCRIPT" "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore accepted a destructive run without --yes'
fi
[[ "$(<"$RESTORE_UPLOADS/sentinel.txt")" == sentinel ]] || fail 'unacknowledged restore modified uploads'
if env \
  "${RESTORE_ENV[@]}" \
  RESTORE_PGPASSFILE="$INSECURE_PGPASSFILE" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore accepted a group/world-readable PGPASSFILE'
fi
[[ "$(<"$RESTORE_UPLOADS/sentinel.txt")" == sentinel ]] || fail 'insecure PGPASSFILE rejection modified uploads'

# Production-layout simulation: target is /data/uploads, with stage and rollback siblings on one filesystem.
if env \
  "${RESTORE_ENV[@]}" \
  RESTORE_PGDATABASE=panshi_task18_missing \
  MAINTENANCE_ACK="RESTORE:$BACKUP_ID:panshi_task18_missing" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore unexpectedly succeeded against a missing database'
fi
[[ "$(<"$RESTORE_UPLOADS/sentinel.txt")" == sentinel ]] || fail 'database failure did not roll back /data/uploads'
[[ -z "$(find "$DATA_ROOT" -mindepth 1 -maxdepth 1 \( -name '.panshi-restore-stage.*' -o -name '.panshi-restore-old.*' \) -print -quit)" ]] \
  || fail 'rollback left staging directories beside /data/uploads'

# Rejection: a hash mismatch must fail before destructive changes.
cp "$BACKUP_DIR/SHA256SUMS" "$BACKUP_DIR/SHA256SUMS.valid"
printf 'tampered' >> "$BACKUP_DIR/uploads.tar.gz"
if env "${RESTORE_ENV[@]}" "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore accepted a checksum mismatch'
fi
[[ "$(<"$RESTORE_UPLOADS/sentinel.txt")" == sentinel ]] || fail 'checksum failure modified uploads'
mv "$BACKUP_DIR/SHA256SUMS.valid" "$BACKUP_DIR/SHA256SUMS"
shasum -a 256 "$BACKUP_DIR/uploads.tar.gz" >/dev/null
# Remove only the bytes appended above and verify the original manifest again.
tampered_size="$(wc -c < "$BACKUP_DIR/uploads.tar.gz")"
truncate -s "$((tampered_size - 8))" "$BACKUP_DIR/uploads.tar.gz"
(cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS >/dev/null)

# Once pg_restore commits, cleanup failure must preserve new uploads and leave the old directory recoverable.
CLEANUP_DB=panshi_task18_cleanup_commit
CLEANUP_URL="postgresql://$PGUSER@127.0.0.1:$PGPORT/$CLEANUP_DB"
CLEANUP_UPLOADS="$DATA_ROOT/cleanup-commit-uploads"
createdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$CLEANUP_DB"
mkdir "$CLEANUP_UPLOADS"
printf old-cleanup > "$CLEANUP_UPLOADS/old.txt"
CLEANUP_OUTPUT="$TEST_ROOT/panshi_task18_cleanup_commit_output"
env \
  "${RESTORE_ENV[@]}" \
  RESTORE_PGDATABASE="$CLEANUP_DB" \
  RESTORE_UPLOAD_DIR="$CLEANUP_UPLOADS" \
  MAINTENANCE_ACK="RESTORE:$BACKUP_ID:$CLEANUP_DB" \
  PANSHI_TEST_FAIL_OLD_UPLOAD_CLEANUP=1 \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >"$CLEANUP_OUTPUT" 2>&1
[[ -f "$CLEANUP_UPLOADS/nested/task18-attachment.txt" ]] || fail 'cleanup failure restored old uploads after database commit'
cleanup_old_dir="$(find "$DATA_ROOT" -mindepth 1 -maxdepth 1 -type d -name '.panshi-restore-old.*' -print -quit)"
[[ -n "$cleanup_old_dir" && "$(<"$cleanup_old_dir/old.txt")" == old-cleanup ]] || fail 'cleanup failure did not preserve the old upload directory'
grep -Fq 'restore committed' "$CLEANUP_OUTPUT" || fail 'cleanup failure did not clearly report committed restore state'
grep -Fq 'retained' "$CLEANUP_OUTPUT" || fail 'cleanup failure omitted old-upload recovery guidance'
! grep -Fqi 'rolled back' "$CLEANUP_OUTPUT" || fail 'cleanup failure incorrectly reported a rollback'
[[ "$(psql "$CLEANUP_URL" -X -Atqc "SELECT count(*) FROM users WHERE id = '18000000-0000-4000-8000-000000000001'")" == 1 ]] \
  || fail 'cleanup failure lost the committed database restore'

# A post-commit signal must keep the committed database and new uploads authoritative.
SIGNAL_DB=panshi_task18_signal_commit
SIGNAL_URL="postgresql://$PGUSER@127.0.0.1:$PGPORT/$SIGNAL_DB"
SIGNAL_UPLOADS="$DATA_ROOT/signal-commit-uploads"
SIGNAL_READY="$TEST_ROOT/panshi_task18_signal_commit_ready"
SIGNAL_CONTINUE="$TEST_ROOT/panshi_task18_signal_commit_continue"
SIGNAL_OUTPUT="$TEST_ROOT/panshi_task18_signal_commit_output"
createdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$SIGNAL_DB"
mkdir "$SIGNAL_UPLOADS"
printf old-signal > "$SIGNAL_UPLOADS/old.txt"
env \
  "${RESTORE_ENV[@]}" \
  RESTORE_PGDATABASE="$SIGNAL_DB" \
  RESTORE_UPLOAD_DIR="$SIGNAL_UPLOADS" \
  MAINTENANCE_ACK="RESTORE:$BACKUP_ID:$SIGNAL_DB" \
  PANSHI_TEST_POST_COMMIT_READY_FILE="$SIGNAL_READY" \
  PANSHI_TEST_POST_COMMIT_CONTINUE_FILE="$SIGNAL_CONTINUE" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >"$SIGNAL_OUTPUT" 2>&1 &
signal_restore_pid=$!
signal_deadline=$((SECONDS + 10))
while [[ ! -f "$SIGNAL_READY" ]]; do
  if ! kill -0 "$signal_restore_pid" >/dev/null 2>&1; then fail 'restore exited before post-commit signal hook'; fi
  (( SECONDS < signal_deadline )) || fail 'restore did not reach post-commit state'
  sleep 0.05
done
kill -TERM "$signal_restore_pid"
wait "$signal_restore_pid" || fail 'post-commit signal reported restore failure'
[[ -f "$SIGNAL_UPLOADS/nested/task18-attachment.txt" ]] || fail 'post-commit signal restored old uploads'
signal_old_dir=
while IFS= read -r candidate_old_dir; do
  if [[ -f "$candidate_old_dir/old.txt" && "$(<"$candidate_old_dir/old.txt")" == old-signal ]]; then
    signal_old_dir="$candidate_old_dir"
    break
  fi
done < <(find "$DATA_ROOT" -mindepth 1 -maxdepth 1 -type d -name '.panshi-restore-old.*' -print)
[[ -n "$signal_old_dir" && "$(<"$signal_old_dir/old.txt")" == old-signal ]] || fail 'post-commit signal did not preserve old uploads for deferred cleanup'
grep -Fq 'restore committed' "$SIGNAL_OUTPUT" || fail 'post-commit signal omitted committed-state warning'
! grep -Fqi 'rolled back' "$SIGNAL_OUTPUT" || fail 'post-commit signal incorrectly reported rollback'
[[ "$(psql "$SIGNAL_URL" -X -Atqc "SELECT count(*) FROM users WHERE id = '18000000-0000-4000-8000-000000000001'")" == 1 ]] \
  || fail 'post-commit signal lost the committed database restore'

# Destroy the isolated source database/storage and restore into fresh isolated targets.
dropdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$SOURCE_DB"
find "$SOURCE_UPLOADS" -depth -mindepth 1 -delete
rmdir "$SOURCE_UPLOADS"
createdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$RESTORE_DB"

PG_RESTORE_ARGS="$TEST_ROOT/panshi_task18_pg_restore_args"
env \
  "${RESTORE_ENV[@]}" \
  PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
  PANSHI_REAL_PG_RESTORE="$REAL_PG_RESTORE" \
  PANSHI_PG_RESTORE_ARGS_FILE="$PG_RESTORE_ARGS" \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null
if grep -Eq "127\\.0\\.0\\.1|$PGUSER|postgresql://|password" "$PG_RESTORE_ARGS"; then
  fail 'restore database connection details appeared in pg_restore argv'
fi

[[ "$(psql "$RESTORE_URL" -X -Atqc "SELECT count(*) FROM users WHERE id = '18000000-0000-4000-8000-000000000001'")" == 1 ]] \
  || fail 'test user was not restored'
[[ "$(psql "$RESTORE_URL" -X -Atqc "SELECT count(*) FROM content_versions WHERE id = '18000000-0000-4000-8000-000000000002' AND payload->>'title' = 'Task 18 Backup Fixture'")" == 1 ]] \
  || fail 'content version was not restored'
[[ "$(psql "$RESTORE_URL" -X -Atqc "SELECT count(*) FROM files WHERE id = '18000000-0000-4000-8000-000000000003' AND sha256 = '$ATTACHMENT_SHA'")" == 1 ]] \
  || fail 'attachment metadata was not restored'
RESTORED_SHA="$(shasum -a 256 "$RESTORE_UPLOADS/nested/task18-attachment.txt" | awk '{print $1}')"
[[ "$RESTORED_SHA" == "$ATTACHMENT_SHA" ]] || fail 'restored attachment SHA-256 differs'
[[ "$(mode_of "$RESTORE_UPLOADS")" == 700 ]] || fail 'restored upload directory is not mode 0700'
[[ "$(mode_of "$RESTORE_UPLOADS/nested")" == 700 ]] || fail 'restored nested directory is not mode 0700'
[[ "$(mode_of "$RESTORE_UPLOADS/nested/task18-attachment.txt")" == 600 ]] || fail 'restored attachment is not mode 0600'

printf 'PASS real PostgreSQL backup/restore: user=1 content_version=1 attachment_sha256=%s\n' "$RESTORED_SHA"
