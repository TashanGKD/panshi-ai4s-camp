# Architecture

## System boundary

The camp site is one npm-workspaces release with three independently built applications:

- `apps/web`: public and student React SPA.
- `apps/admin`: administrator React SPA, deployed below `/admin/`.
- `apps/api`: Express API and the only process allowed to access PostgreSQL or private files.
- `packages/contracts`: shared Zod request/response and content schemas.
- `packages/ui`: shared browser UI components.

The browser applications are decoupled from the API at build time. Split-port development uses `VITE_API_BASE_URL`; production leaves it empty so Nginx serves both SPAs and proxies `/api/` on one HTTPS origin. The API is a modular monolith: identity, content, registration, files, review, resources, statistics, audit, administrator management, and health are modules with service/repository boundaries, but deploy as one process and share one transaction-capable database client.

## Contracts, database, and storage

All browser-visible payloads cross `/api/v1` contracts from `packages/contracts`. PostgreSQL is authoritative for users, hashed sessions and verification codes, content pointers and immutable versions, form versions, applications and review history, file metadata, resources, audit logs, and backup records. Versioned SQL migrations are authoritative for database shape; they are checksum-locked after application.

`FileStorage` is the adapter boundary for bytes. The first implementation is local private storage under `FILE_STORAGE_ROOT`. Random storage keys, not original names or public URLs, are stored in PostgreSQL. The API validates signatures and ownership, streams downloads after authorization, and never exposes the storage root through Nginx. PostgreSQL and the upload tree therefore form one backup/restore unit.

## Authentication and authorization

Administrator and student accounts share `users` but have distinct roles. Passwords use bcrypt; sessions use a random browser token in an `HttpOnly`, `SameSite=Lax` cookie while PostgreSQL stores only its SHA-256 digest. Production cookies are `Secure`. Login rotates prior sessions. Mutating requests must carry an allowed `Origin`.

Public routes need no session. Student profile and application routes require an ordinary student session; administrators are deliberately rejected from the student application endpoint. Administrator routes require an active admin session. Owner-only attachments and admitted-only resources use not-found responses for unauthorized object access so IDs cannot be enumerated. Private API families set `Cache-Control: private, no-store` and omit validators.

The first verification delivery contract has `disabled` and development/test-only `mock` adapters. No production SMS adapter exists. A future provider must implement the existing `VerificationProvider` boundary and the operational controls described in `docs/operations.md` before production registration can be enabled.

## Main flows

### Content and publishing

An administrator loads a module draft and its revision, saves with `expectedRevision`, previews the protected draft through the same public renderer, and publishes or rolls back. Publishing validates the complete payload, creates a new immutable `content_versions` row, and atomically moves `content_modules.published_version_id`. Public site, schedule, and module APIs read only published pointers. Draft text, revisions, and actor metadata are never returned by public APIs.

### Registration and review

An administrator publishes a registration-form version. A student application binds to that immutable version, saves a revision-checked draft, links validated owned attachments, and submits. Submission writes a frozen application version and status history. Review transitions are controlled server-side. A supplement request exposes only its public message, deadline, and editable field/attachment IDs; internal notes remain administrator-only. Resubmission freezes another snapshot. Admission unlocks resources whose scope is `admitted`.

### Resources and public count

Resource metadata and file bytes are separate. Administrators upload a resource file, save metadata, select `public`, `authenticated`, or `admitted`, then publish. List and download authorization are both server-side and re-check file lifecycle state. The public submitted-registration count is returned only when the currently published `display.showRegistrationCount` is true; otherwise the API returns `visible: false` without a count.

### Audit and health

Security- and business-relevant mutations append redacted audit records in the same transaction where consistency requires it. Only administrators may list or inspect audit logs. `/healthz` is a shallow public process/database readiness endpoint; `/api/v1/admin/system-health` adds protected database, upload, backup, and release checks without exposing credentials or storage paths to public clients.

## Deployment boundaries

Production Compose separates PostgreSQL, one-shot migration, API, frontend/Nginx, backup, and restore responsibilities. Dependency ordering is database healthy, migration complete, API healthy, then frontend. Nginx serves only compiled SPAs and proxies API traffic; an external TLS terminator owns certificates, HSTS, and public ingress. Database, upload, and backup named volumes are project-namespaced. Backup and restore are explicit maintenance operations, not API features, and require the application writers to be stopped. Exact commands and rollback rules are in `docs/operations.md`.
