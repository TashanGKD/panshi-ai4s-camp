# Production operations

The production stack builds three independent application images from `apps/web/Dockerfile`, `apps/admin/Dockerfile`, and `apps/api/Dockerfile`. The deployed `frontend` image is built from the web Dockerfile: it combines only the web and admin static artifacts, serves the admin SPA at `/admin/`, serves the public SPA everywhere else, and proxies `/api/` to the API. Uploaded files remain private to the API volume and are never served by Nginx.

## Required environment

Set these variables in the shell or in an operator-managed, untracked environment file before rendering or starting the production Compose stack:

- `POSTGRES_DB`: PostgreSQL database name.
- `POSTGRES_USER`: PostgreSQL role used by the container.
- `POSTGRES_PASSWORD`: strong PostgreSQL password; there is no production default.
- `DATABASE_URL`: complete PostgreSQL URL used by migration and API services. URL-encode special characters and keep its database, user, and password consistent with the three PostgreSQL variables.
- `CORS_ORIGINS`: comma-separated public HTTP(S) origins allowed by the API, for example `https://camp.example.org`.

Optional deployment settings are `IMAGE_TAG`, `HTTP_BIND_ADDRESS`, and `HTTP_PORT`. Production frontend builds deliberately use a blank `VITE_API_BASE_URL` and `VITE_PUBLIC_WEB_BASE_URL`, so both browser applications use the same origin as Nginx. The admin bundle is built with Vite base `/admin/`.

Do not commit a production environment file. The checked-in `.env.example` contains local-development values only.

For local development, plain `docker compose up -d` automatically merges `compose.override.yaml` and publishes PostgreSQL only on `127.0.0.1:5433`. Production commands must keep the explicit `-f compose.yaml -f compose.prod.yaml` file list shown below; this deliberately excludes the local port override.

## Build and start

Validate the merged configuration before starting:

```sh
docker compose -f compose.yaml -f compose.prod.yaml config -q
```

Build and start the stack:

```sh
docker compose -f compose.yaml -f compose.prod.yaml up --build -d
```

Compose enforces this startup order: database healthy → one-shot migration succeeds → API healthy → frontend. The migration command exits nonzero on any connection, checksum, or SQL failure. Because the API depends on `service_completed_successfully`, a failed migration prevents API and frontend startup.

The named volumes are separate: `database-data` stores PostgreSQL data, `uploads-data` stores API-managed private uploads, and `backups-data` is mounted at `/backups` in PostgreSQL for operator-managed backups. Mounting the backup volume does not create backups automatically.

To run migration explicitly without starting later services:

```sh
docker compose -f compose.yaml -f compose.prod.yaml run --rm migration
```

Inspect service health and logs with `docker compose -f compose.yaml -f compose.prod.yaml ps` and `docker compose -f compose.yaml -f compose.prod.yaml logs SERVICE`. The public Nginx health endpoint is `/healthz`; the API container checks its database-aware `/healthz` internally.
