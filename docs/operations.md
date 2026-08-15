# Production operations

The production frontend image combines only the public web and admin build artifacts. Nginx serves the admin SPA at `/admin/`, serves the public SPA elsewhere, proxies `/api/` to the API, and never mounts or serves private uploads. The API image is built independently.

## Required environment

Store production values in the operator-managed, untracked file `/secure/path/panshi-ai4s-camp.prod.env`:

- `POSTGRES_DB`: PostgreSQL database name.
- `POSTGRES_USER`: PostgreSQL application role.
- `POSTGRES_PASSWORD`: strong PostgreSQL password; there is no production default.
- `DATABASE_URL`: complete PostgreSQL URL for migrations and the API. URL-encode special characters and keep the database, user, and password consistent with the PostgreSQL variables.
- `CORS_ORIGINS`: comma-separated public HTTPS origins accepted by the API, for example `https://camp.example.org`.
- `OPERATIONS_UID`, `OPERATIONS_GID`: required numeric owner IDs for operations processes and the host-mounted `0600` password files. Export values derived from `id -u` and `id -g`; do not assume UID/GID 1000.
- `MAINTENANCE_API_HEALTH_URL`: API health URL as seen by an operations container, normally `http://api:3001/healthz`. Backup and restore refuse to run while it is reachable.
- `UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES`, `UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES`, `UPLOAD_ARCHIVE_MAX_ENTRIES`, `UPLOAD_ARCHIVE_MAX_PATH_DEPTH`: explicit positive restoreability limits enforced when creating and restoring upload archives.
- `RESTORE_MIN_FREE_BYTES`: free-space headroom required in addition to the archive's declared expanded bytes before extraction.
- `BACKUP_ROOT`: operations-container backup root; set exactly `/backups`.
- `BACKUP_RETENTION_DAYS`: non-negative number of days to retain complete, hash-valid backups, for example `14`.
- `BACKUP_PGHOST`, `BACKUP_PGPORT`, `BACKUP_PGDATABASE`, `BACKUP_PGUSER`: dedicated libpq settings used only by the backup job; normally use `postgres`, `5432`, the production database, and its least-privilege backup role.
- `BACKUP_PGPASSFILE_HOST`: absolute host path to the backup role's libpq password file. The container exposes it as `BACKUP_PGPASSFILE=/run/secrets/backup.pgpass`.
- `BACKUP_UPLOAD_DIR`: backup-container upload source; Compose sets it exactly `/data/uploads`.
- `BACKUP_APP_VERSION`: deployed release identifier using only letters, numbers, dots, underscores, and hyphens; use the same immutable release tag as `IMAGE_TAG`.
- `RESTORE_PGHOST`, `RESTORE_PGPORT`, `RESTORE_PGDATABASE`, `RESTORE_PGUSER`: dedicated libpq settings used only by the restore job.
- `RESTORE_PGPASSFILE_HOST`: absolute host path to the restore role's libpq password file. The container exposes it as `RESTORE_PGPASSFILE=/run/secrets/restore.pgpass`.
- `RESTORE_UPLOAD_DIR`: restore-container upload target; Compose sets it exactly `/data/uploads`.

Optional settings are `IMAGE_TAG`, `HTTP_PORT`, and `HTTP_BIND_ADDRESS`. The frontend defaults to `127.0.0.1:8080`. Set `HTTP_BIND_ADDRESS` to a non-loopback address only after an operator explicitly chooses and secures that exposure. Frontend builds keep `VITE_API_BASE_URL` and `VITE_PUBLIC_WEB_BASE_URL` blank so both browser applications use the Nginx origin; the admin bundle uses Vite base `/admin/`.

Create separate password files for backup and restore, make each a single libpq line such as `postgres:5432:DATABASE:ROLE:PASSWORD`, and run `chmod 600` on both files. At the start of every production operations session, derive the container identity and verify both files are readable and owned by that identity:

```sh
export OPERATIONS_UID="$(id -u)"
export OPERATIONS_GID="$(id -g)"
test "$OPERATIONS_UID" -gt 0 && test "$OPERATIONS_GID" -gt 0
test -r /secure/path/backup.pgpass && test -r /secure/path/restore.pgpass
test "$(stat -c '%u:%g' /secure/path/backup.pgpass)" = "$OPERATIONS_UID:$OPERATIONS_GID"
test "$(stat -c '%u:%g' /secure/path/restore.pgpass)" = "$OPERATIONS_UID:$OPERATIONS_GID"
```

The one-shot `operations-volume-init` service assigns only `/data` and `/backups` to this identity; the API and both operations jobs then run with the same non-root UID/GID so the API can inspect protected `0700` backups. Do not put database URLs, passwords, or `MAINTENANCE_ACK` in the persistent environment file. The acknowledgement is constructed for one command and must exactly bind its operation and database, plus the backup ID for restore. The backup service receives no restore settings, the restore service receives no backup database settings, database credentials stay out of process arguments, and backup metadata contains only the release version and UTC creation time.

Do not commit the production environment file. The checked-in `.env.example` is for local development only.

## Local and production isolation

Always give local and production stacks distinct Compose project names. This namespaces their resources: for example, local PostgreSQL uses `panshi-ai4s-camp-local_database-data`, while production uses `panshi-ai4s-camp-prod_database-data`. Production also has separately namespaced upload and backup volumes and therefore cannot resolve the local volumes on the same host.

Start local Compose, including `compose.override.yaml` and its loopback PostgreSQL port, with:

```sh
docker compose -p panshi-ai4s-camp-local up -d
```

Every production command must use the explicit environment file, production project, and exact file list below. The file list intentionally excludes the local override.

## TLS and proxy boundary

Place an external TLS reverse proxy on the same host in front of the loopback-only Nginx listener. The TLS terminator is the public ingress and should proxy to `127.0.0.1:8080`; it must overwrite client-supplied `X-Forwarded-For` and `X-Forwarded-Proto` values. Nginx forwards `Host`, client-address headers, and a controlled forwarded protocol to the API.

The API currently does not enable Express `trust proxy`, so forwarded headers are not used as an authorization or client-identity source. Production authentication cookies are marked `Secure` because `NODE_ENV=production`, independent of Express protocol inference. Keep direct access to the loopback listener unavailable to remote clients.

Nginx adds frame denial (`X-Frame-Options` and CSP `frame-ancestors`), `nosniff`, a strict referrer policy, and a same-origin-oriented CSP. HSTS must be configured only at the external TLS terminator, where HTTPS is actually established; it is intentionally absent from this HTTP Nginx layer.

The API accepts files up to 5 MiB. Allowing 64 KiB of multipart overhead requires more than 5 MiB at the proxy, so Nginx uses a 6 MiB request-body limit. Requests over 6 MiB are rejected by Nginx.

## Build, migrate, and start

Validate the effective model:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml config -q
```

Build exact release images:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml build
```

Before a release, resolve and record immutable digests for the exact Node, Nginx, and PostgreSQL base-image tags and pin those digests in the release branch. Do not invent a digest when registry verification is unavailable.

Start the stack:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml up -d
```

Compose enforces database healthy → one-shot migration succeeds → API healthy → frontend. Migration exits nonzero on connection, checksum, or SQL failure; `service_completed_successfully` prevents the API and frontend from starting after a failed migration.

To run only the migration job explicitly:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml run --rm migration
```

Inspect status and service logs:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml ps
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml logs SERVICE
```

After the API is healthy, create the initial administrator. The command prompts for the password without echoing it:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml exec api node apps/api/dist/src/cli/create-admin.js --phone 13800138000 --name "Initial Admin"
```

Stop services without deleting named data volumes:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml down
```

The named volumes separately hold PostgreSQL data, API-managed uploads, and operator-managed backups. Production mounts the complete upload volume at `/data`; the API storage root and both operations paths are `/data/uploads`. Restore staging and rollback directories are siblings under `/data`, so all renames stay on the upload volume and the target itself is not a mountpoint. Mounting `backups-data` does not schedule or create backups.

## Backup schedule and verification

The backup script creates a PostgreSQL custom-format dump with `pg_dump --format=custom`, archives the upload tree, enforces the configured archive resource limits, writes a SHA-256 manifest, and publishes the directory atomically with a `COMPLETE` marker. A failed run remains unpublished and is cleaned up. Backup and restore require `flock` (provided by `util-linux` in the operations image) and take the same exclusive lock on the shared backup volume; there is no mkdir fallback. A concurrent job fails fast and the kernel releases the lock on process exit or crash. Retention runs only after a successful backup and deletes only direct descendants of `BACKUP_ROOT` that match the backup naming contract, contain `COMPLETE`, and pass their manifest check.

The database and uploads form one coherent application snapshot only while writers are stopped. For this architecture, every backup follows this exact maintenance sequence. The script accepts only curl exit 6 (DNS resolution failed) or 7 (connection failed) as proof that the API is unreachable; timeout 28, TLS errors, and every other ambiguous failure reject the operation:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml stop frontend api
if curl --silent --output /dev/null --connect-timeout 2 --max-time 3 http://127.0.0.1:8080/healthz; then echo 'maintenance verification failed: service is reachable' >&2; exit 1; fi
export BACKUP_PGDATABASE='the exact BACKUP_PGDATABASE value from the production env file'
export MAINTENANCE_ACK="BACKUP:${BACKUP_PGDATABASE}"
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml run --rm -e MAINTENANCE_ACK backup deploy/backup.sh
unset MAINTENANCE_ACK
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml start api frontend
```

The command prints only the new identifier, such as `panshi-backup-20260815T020304Z-release-2026.08.15`. Record that identifier in the operations log. Verify the marker and SHA-256 manifest before copying the backup off-host:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml run --rm backup -lc 'cd /backups/BACKUP_ID && sha256sum -c SHA256SUMS && test "$(cat COMPLETE)" = complete'
```

Backups are trusted only while held inside the operator-protected `0700` backup root. The SHA-256 manifest detects accidental change but does not authenticate a backup. Before importing or restoring a copied backup, verify an out-of-band authenticated checksum or signature supplied through a separately protected channel.

Schedule the entire stop → unreachable verification → target-bound backup → start sequence daily using a host `systemd timer` (preferred) under a dedicated operator account; never schedule only the inner backup command. Set `Persistent=true` so a missed run executes after reboot. Alert on any nonzero exit or when the admin System Status page reports no recent successful backup. Retention is controlled only by `BACKUP_RETENTION_DAYS`; off-host retention must be configured separately. Test a restore on an isolated host/database at least monthly.

## Restore warning and runbook

> Warning: restore is destructive. It replaces the configured upload directory and runs `pg_restore --clean --if-exists --single-transaction` against `RESTORE_PGDATABASE`. Confirm the generated direct-child backup ID, target database settings, maintenance window, and a separate current backup before continuing. Never point the restore variables at an unreviewed target.

1. Announce the maintenance window, stop browser/API traffic, keep PostgreSQL running, and prove the public service is unreachable:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml stop frontend api
if curl --silent --output /dev/null --connect-timeout 2 --max-time 3 http://127.0.0.1:8080/healthz; then echo 'maintenance verification failed: service is reachable' >&2; exit 1; fi
```

2. Verify `BACKUP_ID/COMPLETE` and every SHA-256 entry with the verification command above. The restore script repeats this validation and rejects traversal, symlinks, incomplete backups, and hash mismatches before changing uploads or the database.

3. Perform the explicitly acknowledged restore. Replace `BACKUP_ID` with one direct child identifier printed by a successful backup:

```sh
export BACKUP_ID='panshi-backup-YYYYMMDDTHHMMSSZ-release'
export RESTORE_PGDATABASE='the exact RESTORE_PGDATABASE value from the production env file'
export MAINTENANCE_ACK="RESTORE:${BACKUP_ID}:${RESTORE_PGDATABASE}"
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml run --rm -e MAINTENANCE_ACK restore deploy/restore.sh --yes "$BACKUP_ID"
unset MAINTENANCE_ACK
```

The upload replacement is staged and can be rolled back only before the transactional database restore commits. Once `pg_restore` succeeds, the new database and uploads are authoritative. Failure to delete the old upload directory, or a signal received after commit, produces a warning and leaves the old directory beside `/data/uploads` for manual verification and later removal; it never reinstates old uploads. Preserve all warnings and do not retry blindly.

4. Start the stack and verify database health, the admin System Status page, a known user/content record, and the SHA-256 of at least one restored attachment:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml up -d
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml ps
```

5. Record the backup identifier, operator, timestamps, verification evidence, and restored application version. End the maintenance window only after API and attachment checks pass.

## Verification tiers and current limitation

`npm test` includes `npm run test:deployment`, a fast, hermetic, offline static gate. It uses the repository's Node YAML parser to inspect the effective local and production models and validates the structured Nginx routing contract. It performs no clean install, shell/Ruby invocation, network access, or Docker call.

`npm run test:deployment:build` is the explicit CI/release gate. It reproduces each Docker dependency/build stage in clean temporary contexts, validates artifacts and API runtime imports, runs native Compose and image/live HTTP checks when Docker is available, and explicitly reports skipped container checks otherwise. At this review, the Docker engine and Compose plugin are unavailable; clean-context builds can run, but container builds, executable Nginx validation, and live proxy checks cannot be claimed.

`VERIFICATION_PROVIDER=disabled` is intentional in the current production model. The code currently supports only `disabled` and a development-only `mock`; no production SMS adapter is implemented, so student verification-code delivery remains unavailable until that adapter is added.

## SMS adapter switch

Do not set production to `mock`: configuration validation rejects that combination. Until a real adapter exists, keep `VERIFICATION_PROVIDER=disabled`, keep registration closed in published content, and verify that verification-send returns the documented unavailable response without disclosing account existence.

A future production switch is allowed only after a named adapter implements the existing `VerificationProvider` contract and has delivery receipts, timeout/retry behavior, IP and per-phone rate limits, a global cost circuit breaker, secret rotation, redacted logging, and integration tests. Add that adapter name to configuration validation; never alias it to `mock`. In a maintenance window, deploy with the new provider name and its operator-managed secret variables, then test one dedicated non-user phone through send, register, login, reset, audit redaction, and rate-limit boundaries. Roll back the switch by restoring `VERIFICATION_PROVIDER=disabled` and redeploying the previous release; do not retain test codes or provider credentials in the repository or operations log. No live SMS vendor is selected by this document.

## Deployment verification

Before touching production, run the repository gates from a clean checkout:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
TEST_DATABASE_URL='postgresql://local-role@127.0.0.1:5432/panshi_ai4s_camp_test' npm run test:release
npm run test:deployment:build
bash tests/backup-restore.test.sh
```

Set `TRUST_PROXY=true` only when the production API is reached through the reviewed single Nginx hop; otherwise retain the default `false`. Configure the five `RATE_LIMIT_*_MAX` and `RATE_LIMIT_*_WINDOW_MS` pairs conservatively. The current limiter store is process-local and supports one API replica only; before adding replicas, deploy and test an external shared atomic store. A 429 response must retain structured error JSON and `Retry-After`; private auth families also retain `Cache-Control: private, no-store`.

Run the browser release gate separately against the exact local test database with all six E2E safety switches and dedicated test credentials: `npm run test:e2e:all`. Its Node orchestrator creates one cryptographically random run token and start timestamp, passes both through launch, then runs visual/source, review workflow, content publishing, student authentication and application submission in order before verifying launch evidence again with the same identity. Never parallelize these configurations because they intentionally reset the same dedicated database. Launch, review and application submission sequentially reuse `var/e2e-uploads` and `var/e2e-temp`; visual/source, content publishing and student authentication use their separate `var/visual-e2e-*`, `var/content-e2e-*` and `var/student-auth-e2e-*` roots. Every API startup uses the shared fail-fast Node lifecycle: the cleanup guarantee is installed before migration begins, failed migration prevents seed/server, and exit cleanup is backed by Playwright global teardown, including review. Every configuration owns a unique `test-results/<suite>` output directory, so later suites cannot remove launch evidence. The final verifier accepts only `test-results/launch/evidence/launch-visual`: its exact 48 PNG names plus one matching marker, regular non-symlink files, valid PNG signature/IHDR, filename-matched viewport dimensions, current run timestamps and no extras. These generated files are not deployment inputs.

On a Docker-capable release host, the clean-build gate must report its container checks as executed, not skipped. Then validate the exact production model and deploy only the reviewed image tag:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml config -q
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml build
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml up -d
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml ps
```

Verify through the external HTTPS origin, not only loopback: public home, schedule, application, travel, contact, resources, login and profile; admin login, dashboard, content, applications, resources, administrators, audit and system status; `/healthz`; one public API payload; one authorized private response with `Cache-Control: private, no-store`; and one authorized attachment/resource download whose SHA-256 matches its source. Confirm the same published banner/navigation/content is shown at desktop and mobile widths. Check that anonymous and ordinary-user probes cannot enumerate another application, attachment, admitted resource, admin endpoint, or audit log.

## Go-live and rollback checklist

Before go-live:

1. Record the release commit, immutable image digests, database target, operator, previous release tag, and rollback decision owner.
2. Confirm the exact production environment file, TLS certificate/renewal, loopback-only Nginx binding, CORS origins, storage marker/permissions, backup password-file ownership, free space, and off-host backup copy.
3. Run a coherent maintenance backup and verify its `COMPLETE` marker and SHA-256 manifest. Record its generated backup ID.
4. Run migration, create the first administrator only if none exists, and verify at least two active administrators before normal operations. Never seed a password.
5. Preview and publish each approved content/form/resource revision through the admin UI. Confirm registration dates and keep registration closed while verification delivery is disabled.
6. Complete the external HTTPS verification above, inspect audit entries for the release operations, and obtain the go-live decision.

Rollback application code when health, authorization, rendering, or download checks fail but the new migration remains backward-compatible: restore the previous reviewed image tag in the production environment, rerun the exact `config -q` and `up -d` commands, and repeat external verification. Never edit or delete an applied migration and never point `content_modules.published_version_id` by hand; use the admin content rollback action for a bad content release.

If data or migration state must be reverted, stop frontend and API and follow the destructive restore runbook above using the recorded pre-release backup. A database restore and upload restore are one operation. Do not attempt a partial SQL rollback or copy individual storage paths. If the restore fails or its post-restore hash checks disagree, keep the service stopped, preserve evidence and staging/rollback directories, and escalate rather than retrying blindly. Record the final release/backup IDs, verification results, downtime, and decision in the operations log.
