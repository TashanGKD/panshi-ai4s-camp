#!/usr/bin/env bash
set -euo pipefail

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
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_DATABASE_URL'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_UPLOAD_DIR'
assert_file_contains "$BACKUP_SCRIPT" 'BACKUP_APP_VERSION'
assert_file_contains "$RESTORE_SCRIPT" '^set -euo pipefail$'
assert_file_contains "$RESTORE_SCRIPT" 'pg_restore'
assert_file_contains "$RESTORE_SCRIPT" '--single-transaction'
assert_file_contains "$RESTORE_SCRIPT" 'RESTORE_DATABASE_URL'
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
OUTSIDE_ROOT="$TEST_ROOT/panshi_task18_outside"
PGPORT=$((55000 + ($$ % 1000)))
PGUSER=panshi_task18_owner
SOURCE_DB=panshi_task18_source
RESTORE_DB=panshi_task18_restore
SOURCE_URL="postgresql://$PGUSER@127.0.0.1:$PGPORT/$SOURCE_DB"
RESTORE_URL="postgresql://$PGUSER@127.0.0.1:$PGPORT/$RESTORE_DB"
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

mkdir -p "$PGSOCKET" "$BACKUP_ROOT" "$SOURCE_UPLOADS/nested" "$RESTORE_UPLOADS" "$OUTSIDE_ROOT"
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

# Rejection: upload trees containing a symlink must fail without leaving partial backups.
ln -s "$OUTSIDE_ROOT" "$SOURCE_UPLOADS/escape-link"
if env \
  BACKUP_ROOT="$BACKUP_ROOT" \
  BACKUP_RETENTION_DAYS=7 \
  BACKUP_DATABASE_URL="$SOURCE_URL" \
  BACKUP_UPLOAD_DIR="$SOURCE_UPLOADS" \
  BACKUP_APP_VERSION=task18-test \
  "$BACKUP_SCRIPT" >/dev/null 2>&1; then
  fail 'backup accepted an upload symlink escape'
fi
[[ -z "$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -name '.incomplete-*' -print -quit)" ]] \
  || fail 'failed backup left an incomplete directory'
unlink "$SOURCE_UPLOADS/escape-link"

# Retention must ignore incomplete directories and symlink escapes.
mkdir "$BACKUP_ROOT/panshi-backup-20000101T000000Z-incomplete"
touch -t 200001010000 "$BACKUP_ROOT/panshi-backup-20000101T000000Z-incomplete"
ln -s "$OUTSIDE_ROOT" "$BACKUP_ROOT/panshi-backup-20000101T000000Z-symlink"

BACKUP_ID="$(env \
  BACKUP_ROOT="$BACKUP_ROOT" \
  BACKUP_RETENTION_DAYS=7 \
  BACKUP_DATABASE_URL="$SOURCE_URL" \
  BACKUP_UPLOAD_DIR="$SOURCE_UPLOADS" \
  BACKUP_APP_VERSION=task18-test \
  "$BACKUP_SCRIPT")"

[[ "$BACKUP_ID" =~ ^panshi-backup-[0-9]{8}T[0-9]{6}Z-task18-test$ ]] || fail "unsafe backup identifier: $BACKUP_ID"
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_ID"
[[ -f "$BACKUP_DIR/COMPLETE" ]] || fail 'backup lacks COMPLETE marker'
[[ -f "$BACKUP_DIR/database.dump" ]] || fail 'backup lacks custom database dump'
[[ -f "$BACKUP_DIR/uploads.tar.gz" ]] || fail 'backup lacks upload archive'
[[ -f "$BACKUP_DIR/SHA256SUMS" ]] || fail 'backup lacks SHA-256 manifest'
(cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS >/dev/null)
[[ -d "$BACKUP_ROOT/panshi-backup-20000101T000000Z-incomplete" ]] || fail 'retention deleted an incomplete backup'
[[ -L "$BACKUP_ROOT/panshi-backup-20000101T000000Z-symlink" ]] || fail 'retention followed or deleted a symlink'
[[ -d "$OUTSIDE_ROOT" ]] || fail 'retention escaped the backup root'

# A direct, complete, hash-valid expired backup is the only retention deletion target.
VALID_EXPIRED="$BACKUP_ROOT/panshi-backup-20000101T000000Z-valid"
cp -R "$BACKUP_DIR" "$VALID_EXPIRED"
touch -t 200001010000 "$VALID_EXPIRED"
env \
  BACKUP_ROOT="$BACKUP_ROOT" \
  BACKUP_RETENTION_DAYS=7 \
  BACKUP_DATABASE_URL="$SOURCE_URL" \
  BACKUP_UPLOAD_DIR="$SOURCE_UPLOADS" \
  BACKUP_APP_VERSION=retention-check \
  "$BACKUP_SCRIPT" >/dev/null
[[ ! -e "$VALID_EXPIRED" ]] || fail 'retention did not delete a validated expired backup'
[[ -d "$BACKUP_ROOT/panshi-backup-20000101T000000Z-incomplete" ]] || fail 'retention deleted an incomplete backup during valid cleanup'
[[ -L "$BACKUP_ROOT/panshi-backup-20000101T000000Z-symlink" ]] || fail 'retention deleted a symlink during valid cleanup'

# Rejection: traversal and symlink backup selectors must fail before database/upload changes.
printf 'sentinel' > "$RESTORE_UPLOADS/sentinel.txt"
for invalid_backup in '../outside' 'panshi-backup-20000101T000000Z-symlink'; do
  if env \
    BACKUP_ROOT="$BACKUP_ROOT" \
    RESTORE_DATABASE_URL="$RESTORE_URL" \
    RESTORE_UPLOAD_DIR="$RESTORE_UPLOADS" \
    RESTORE_ACKNOWLEDGE=RESTORE \
    "$RESTORE_SCRIPT" --yes "$invalid_backup" >/dev/null 2>&1; then
    fail "restore accepted unsafe backup selector: $invalid_backup"
  fi
  [[ "$(<"$RESTORE_UPLOADS/sentinel.txt")" == sentinel ]] || fail 'unsafe restore modified uploads'
done

if env \
  BACKUP_ROOT="$BACKUP_ROOT" \
  RESTORE_DATABASE_URL="$RESTORE_URL" \
  RESTORE_UPLOAD_DIR="$RESTORE_UPLOADS" \
  RESTORE_ACKNOWLEDGE= \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore accepted a missing acknowledgement'
fi
if env \
  BACKUP_ROOT="$BACKUP_ROOT" \
  RESTORE_DATABASE_URL="$RESTORE_URL" \
  RESTORE_UPLOAD_DIR="$RESTORE_UPLOADS" \
  RESTORE_ACKNOWLEDGE=RESTORE \
  "$RESTORE_SCRIPT" "$BACKUP_ID" >/dev/null 2>&1; then
  fail 'restore accepted a destructive run without --yes'
fi
[[ "$(<"$RESTORE_UPLOADS/sentinel.txt")" == sentinel ]] || fail 'unacknowledged restore modified uploads'

# Rejection: a hash mismatch must fail before destructive changes.
cp "$BACKUP_DIR/SHA256SUMS" "$BACKUP_DIR/SHA256SUMS.valid"
printf 'tampered' >> "$BACKUP_DIR/uploads.tar.gz"
if env \
  BACKUP_ROOT="$BACKUP_ROOT" \
  RESTORE_DATABASE_URL="$RESTORE_URL" \
  RESTORE_UPLOAD_DIR="$RESTORE_UPLOADS" \
  RESTORE_ACKNOWLEDGE=RESTORE \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null 2>&1; then
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

env \
  BACKUP_ROOT="$BACKUP_ROOT" \
  RESTORE_DATABASE_URL="$RESTORE_URL" \
  RESTORE_UPLOAD_DIR="$RESTORE_UPLOADS" \
  RESTORE_ACKNOWLEDGE=RESTORE \
  "$RESTORE_SCRIPT" --yes "$BACKUP_ID" >/dev/null

[[ "$(psql "$RESTORE_URL" -X -Atqc "SELECT count(*) FROM users WHERE id = '18000000-0000-4000-8000-000000000001'")" == 1 ]] \
  || fail 'test user was not restored'
[[ "$(psql "$RESTORE_URL" -X -Atqc "SELECT count(*) FROM content_versions WHERE id = '18000000-0000-4000-8000-000000000002' AND payload->>'title' = 'Task 18 Backup Fixture'")" == 1 ]] \
  || fail 'content version was not restored'
[[ "$(psql "$RESTORE_URL" -X -Atqc "SELECT count(*) FROM files WHERE id = '18000000-0000-4000-8000-000000000003' AND sha256 = '$ATTACHMENT_SHA'")" == 1 ]] \
  || fail 'attachment metadata was not restored'
RESTORED_SHA="$(shasum -a 256 "$RESTORE_UPLOADS/nested/task18-attachment.txt" | awk '{print $1}')"
[[ "$RESTORED_SHA" == "$ATTACHMENT_SHA" ]] || fail 'restored attachment SHA-256 differs'

printf 'PASS real PostgreSQL backup/restore: user=1 content_version=1 attachment_sha256=%s\n' "$RESTORED_SHA"
