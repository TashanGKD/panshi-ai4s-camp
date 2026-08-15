# Production operations

The production frontend image combines only the public web and admin build artifacts. Nginx serves the admin SPA at `/admin/`, serves the public SPA elsewhere, proxies `/api/` to the API, and never mounts or serves private uploads. The API image is built independently.

## Required environment

Store production values in the operator-managed, untracked file `/secure/path/panshi-ai4s-camp.prod.env`:

- `POSTGRES_DB`: PostgreSQL database name.
- `POSTGRES_USER`: PostgreSQL application role.
- `POSTGRES_PASSWORD`: strong PostgreSQL password; there is no production default.
- `DATABASE_URL`: complete PostgreSQL URL for migrations and the API. URL-encode special characters and keep the database, user, and password consistent with the PostgreSQL variables.
- `CORS_ORIGINS`: comma-separated public HTTPS origins accepted by the API, for example `https://camp.example.org`.
- `BACKUP_ROOT`: operations-container backup root; set exactly `/backups`.
- `BACKUP_RETENTION_DAYS`: non-negative number of days to retain complete, hash-valid backups, for example `14`.
- `BACKUP_DATABASE_URL`: dedicated PostgreSQL URL used only by `pg_dump`; normally targets the production database through `postgres:5432`.
- `BACKUP_UPLOAD_DIR`: operations-container upload source; set exactly `/uploads`.
- `BACKUP_APP_VERSION`: deployed release identifier using only letters, numbers, dots, underscores, and hyphens; use the same immutable release tag as `IMAGE_TAG`.
- `RESTORE_DATABASE_URL`: dedicated PostgreSQL URL used only by `pg_restore`; normally targets the production database through `postgres:5432`.
- `RESTORE_UPLOAD_DIR`: operations-container upload restore target; set exactly `/uploads`.

Optional settings are `IMAGE_TAG`, `HTTP_PORT`, and `HTTP_BIND_ADDRESS`. The frontend defaults to `127.0.0.1:8080`. Set `HTTP_BIND_ADDRESS` to a non-loopback address only after an operator explicitly chooses and secures that exposure. Frontend builds keep `VITE_API_BASE_URL` and `VITE_PUBLIC_WEB_BASE_URL` blank so both browser applications use the Nginx origin; the admin bundle uses Vite base `/admin/`.

Do not put `RESTORE_ACKNOWLEDGE` in the persistent environment file. It is a one-command acknowledgement supplied only during an approved restore. The scripts do not print connection URLs, and backup metadata contains only the release version and UTC creation time.

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

The named volumes separately hold PostgreSQL data, API-managed uploads, and operator-managed backups. Mounting `backups-data` does not schedule or create backups.

## Backup schedule and verification

The backup script creates a PostgreSQL custom-format dump with `pg_dump --format=custom`, archives the upload tree, writes a SHA-256 manifest, and publishes the directory atomically with a `COMPLETE` marker. A failed run remains unpublished and is cleaned up. Retention runs only after a successful backup and deletes only direct descendants of `BACKUP_ROOT` that match the backup naming contract, contain `COMPLETE`, and pass their manifest check.

Run one production backup with the exact production Compose boundary:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml run --rm operations deploy/backup.sh
```

The command prints only the new identifier, such as `panshi-backup-20260815T020304Z-release-2026.08.15`. Record that identifier in the operations log. Verify the marker and SHA-256 manifest before copying the backup off-host:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml run --rm operations -lc 'cd /backups/BACKUP_ID && sha256sum -c SHA256SUMS && test "$(cat COMPLETE)" = complete'
```

Schedule the same backup command daily using a host `systemd timer` (preferred) or cron under a dedicated operator account. Set `Persistent=true` for a systemd timer so a missed run executes after reboot. Alert when the command exits nonzero or the admin System Status page reports no recent successful backup. Retention is controlled only by `BACKUP_RETENTION_DAYS`; off-host retention must be configured separately. Test a restore on an isolated host/database at least monthly.

## Restore warning and runbook

> Warning: restore is destructive. It replaces the configured upload directory and runs `pg_restore --clean --if-exists --single-transaction` against `RESTORE_DATABASE_URL`. Confirm the backup identifier, target database, maintenance window, and a separate current backup before continuing. Never point the restore variables at an unreviewed target.

1. Announce the maintenance window, stop browser/API traffic, and keep PostgreSQL running:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml stop frontend api
```

2. Verify `BACKUP_ID/COMPLETE` and every SHA-256 entry with the verification command above. The restore script repeats this validation and rejects traversal, symlinks, incomplete backups, and hash mismatches before changing uploads or the database.

3. Perform the explicitly acknowledged restore. Replace `BACKUP_ID` with one direct child identifier printed by a successful backup:

```sh
docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml run --rm -e RESTORE_ACKNOWLEDGE=RESTORE operations deploy/restore.sh --yes BACKUP_ID
```

The upload replacement is staged and can be rolled back if the transactional database restore fails. Any nonzero exit means the restore did not complete; preserve the console output, do not retry blindly, and inspect the target state before another attempt.

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
