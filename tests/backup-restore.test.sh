#!/usr/bin/env bash
set -euo pipefail
export COPYFILE_DISABLE=1

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BACKUP_SCRIPT="$PROJECT_ROOT/deploy/backup.sh"
RESTORE_SCRIPT="$PROJECT_ROOT/deploy/restore.sh"

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
assert_file_contains "$RESTORE_SCRIPT" '^set -euo pipefail$'
assert_file_contains "$RESTORE_SCRIPT" 'pg_restore'
assert_file_contains "$RESTORE_SCRIPT" '--single-transaction'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_PGHOST'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_PGDATABASE'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_PGPASSFILE'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_UPLOAD_DIR'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_ACKNOWLEDGE'

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
SERVER_STARTED=false

cleanup() {
  local status=$?
  trap - EXIT INT TERM
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

mkdir -p "$PGSOCKET" "$BACKUP_ROOT" "$SOURCE_UPLOADS/nested" "$DATA_ROOT/uploads" "$OUTSIDE_ROOT" "$PG_DUMP_WRAPPER_DIR"
RESTORE_UPLOADS="$DATA_ROOT/uploads"
TEST_DATABASE_SECRET='panshi-task18-secret-password'
printf '127.0.0.1:%s:*:%s:%s\n' "$PGPORT" "$PGUSER" "$TEST_DATABASE_SECRET" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
ln -s "$PROJECT_ROOT/tests/helpers/pg_dump-delay-wrapper.sh" "$PG_DUMP_WRAPPER_DIR/pg_dump"
ln -s "$PROJECT_ROOT/tests/helpers/pg_restore-argv-wrapper.sh" "$PG_DUMP_WRAPPER_DIR/pg_restore"
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
)
RESTORE_ENV=(
  BACKUP_ROOT="$BACKUP_ROOT"
  RESTORE_PGHOST=127.0.0.1
  RESTORE_PGPORT="$PGPORT"
  RESTORE_PGDATABASE="$RESTORE_DB"
  RESTORE_PGUSER="$PGUSER"
  RESTORE_PGPASSFILE="$PGPASSFILE"
  RESTORE_UPLOAD_DIR="$RESTORE_UPLOADS"
  RESTORE_ACKNOWLEDGE=RESTORE
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
for attack_kind in symlink hardlink fifo absolute traversal; do
  attack_id="panshi-backup-20000101T000000Z-attack-$attack_kind"
  attack_backup="$BACKUP_ROOT/$attack_id"
  cp -R "$BACKUP_DIR" "$attack_backup"
  case "$attack_kind" in
    symlink) tar -C "$ATTACK_SOURCE" -czf "$attack_backup/uploads.tar.gz" symlink ;;
    hardlink) tar -C "$ATTACK_SOURCE" -czf "$attack_backup/uploads.tar.gz" payload hardlink ;;
    fifo) tar -C "$ATTACK_SOURCE" -czf "$attack_backup/uploads.tar.gz" fifo ;;
    absolute) tar -P -czf "$attack_backup/uploads.tar.gz" "$ATTACK_SOURCE/payload" ;;
    traversal) tar -C "$ATTACK_SOURCE/nested" -czf "$attack_backup/uploads.tar.gz" ../payload ;;
  esac
  (cd "$attack_backup" && shasum -a 256 database.dump uploads.tar.gz metadata.env > SHA256SUMS)
  restore_called="$TEST_ROOT/panshi_task18_restore_called_$attack_kind"
  if env \
    "${RESTORE_ENV[@]}" \
    PATH="$PG_DUMP_WRAPPER_DIR:$PATH" \
    PANSHI_REAL_PG_RESTORE=/usr/bin/false \
    PANSHI_PG_RESTORE_CALLED_FILE="$restore_called" \
    "$RESTORE_SCRIPT" --yes "$attack_id" >/dev/null 2>&1; then
    fail "restore accepted unsafe $attack_kind archive"
  fi
  [[ ! -e "$restore_called" ]] || fail "restore validated $attack_kind archive after pg_restore"
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
  RESTORE_ACKNOWLEDGE= \
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
