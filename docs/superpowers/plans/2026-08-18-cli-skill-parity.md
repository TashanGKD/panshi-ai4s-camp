# Panshi Camp Shared Client, CLI, Skill, and Parity Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete public-and-learner command-line client and learner Skill so a user can obtain every public or personally authorized website capability and complete every learner workflow without opening the website, while preserving server-side authorization, explicit write confirmation, stable machine-readable output, and drift-proof Web–CLI–Skill parity.

**Architecture:** Extend the existing API with CLI-scoped bearer sessions and a server-owned confirmation-intent protocol. Move browser-compatible API calls into a shared `@panshi/camp-client` package used by Web and CLI. Register each business capability once in `@panshi/contracts`, bind Web surfaces and CLI commands to those IDs, and verify both plus the learner Skill index with an executable parity gate. Keep this phase limited to the public/learner website; the existing admin website remains the source inventory for the later Admin CLI/Admin Skill phase.

**Tech Stack:** Node.js 24, npm 11 workspaces, TypeScript 6, Express 5, PostgreSQL/Drizzle ORM, Zod 4, Vitest 4, native `fetch`/`FormData`, `node:util.parseArgs`, `@napi-rs/keyring`, QR image generation, Markdown Skill package.

---

## Scope and non-negotiable contracts

This plan implements the approved design in `docs/superpowers/specs/2026-08-18-cli-skill-and-reusable-agent-design.md` for the public and learner permission domain only.

The source contracts verified before writing this plan are:

- API mounts: `apps/api/src/app.ts:173-217`.
- Browser routes: `apps/web/src/app/App.tsx:52-64`.
- Authentication routes and HttpOnly session behavior: `apps/api/src/modules/identity/auth.routes.ts:87-174`.
- Current user roles: `packages/contracts/src/identity.ts` (`user | admin`).
- Learner application mutations: `apps/api/src/modules/registration/application.routes.ts:22-34`.
- File operations: `apps/api/src/modules/files/file.routes.ts`.
- Learner check-in credential: `apps/api/src/modules/check-in/check-in.routes.ts:12-21`.
- Current application statuses: `packages/contracts/src/registration.ts:326-334`.
- Existing browser clients to be replaced by the shared client: `apps/web/src/api/public-client.ts`, `apps/web/src/api/auth-client.ts`, and `apps/web/src/api/application-client.ts`.

The first release must cover these capability families:

1. Public site, content, schedule, travel, contacts, institutions, registration form, application count, and public resources.
2. Verification-code request, registration, login, auth status, logout, password reset, and authenticated password change.
3. Application read, local validation, draft save, reopen, submit, status/timeline/supplement display.
4. Registration attachment upload, download, hide, and delete.
5. Authorized resource download.
6. Learner check-in status and QR image export without printing raw QR payload in normal or JSON output.

The later Admin CLI/Admin Skill is not implemented here. The capability registry must nevertheless support `admin`, and the parity gate must make the phase boundary explicit instead of silently treating admin Web surfaces as covered.

## Capability and confirmation conventions

Use these IDs throughout contracts, API handlers, Web bindings, CLI commands, and Skill indexes:

```ts
export const LearnerCapabilityIdSchema = z.enum([
  'public.site.show',
  'public.content.show',
  'public.schedule.list',
  'public.travel.show',
  'public.contacts.show',
  'public.institutions.search',
  'public.registration_form.show',
  'public.application_count.show',
  'resource.list',
  'resource.download',
  'auth.verification.send',
  'auth.register',
  'auth.login',
  'auth.status',
  'auth.logout',
  'auth.password_reset',
  'account.password_change',
  'application.show',
  'application.validate',
  'application.draft.save',
  'application.reopen',
  'application.submit',
  'file.upload',
  'file.download',
  'file.hide',
  'file.delete',
  'check_in.show',
  'check_in.qr.export',
])
```

Classification:

- `read`: execute immediately.
- `write`: prepare server intent, display exact preview, then execute once after explicit confirmation.
- `delete`: prepare server intent, display exact preview, require the user to type the target identifier, then execute once.
- Authentication secrets are collected only during execution and are never included in preview payloads or hashes. The preview binds the masked account identifier, purpose, capability ID, and client binding.
- `application.validate` and `check_in.qr.export` are local effects. Validation is read-only. QR export requires an explicit output path but does not require a server confirmation because it does not alter server state.

---

### Task 1: Define capability, CLI output, token, and confirmation contracts

**Files:**

- Create: `packages/contracts/src/capabilities.ts`
- Create: `packages/contracts/src/capabilities.test.ts`
- Create: `packages/contracts/src/cli.ts`
- Create: `packages/contracts/src/cli.test.ts`
- Create: `packages/contracts/src/confirmation.ts`
- Create: `packages/contracts/src/confirmation.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write failing capability-registry contract tests**

Test strict parsing, unique IDs, valid role/effect/confirmation combinations, and the fixed learner ID set. Include negative cases for duplicate IDs, `anonymous` application writes, and a `delete` capability with `confirmation: 'none'`.

```ts
it('rejects a destructive capability without double confirmation', () => {
  expect(CapabilitySchema.safeParse({
    id: 'file.delete', apiOperation: 'DELETE /api/v1/files/:id',
    webSurface: ['/application'], cliCommand: 'files delete <id>',
    skillIndex: ['files.delete'], roles: ['user'], effect: 'delete',
    confirmation: 'none', outputSchema: 'FileMutationResponse',
  }).success).toBe(false)
})
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `npm test -w @panshi/contracts -- --run src/capabilities.test.ts`

Expected: FAIL because `capabilities.ts` does not exist.

- [ ] **Step 3: Implement strict capability contracts and the learner registry**

Define:

```ts
export const CapabilitySchema = z.object({
  id: LearnerCapabilityIdSchema,
  apiOperation: z.string().min(1),
  webSurface: z.array(z.string().min(1)).min(1),
  cliCommand: z.string().min(1),
  skillIndex: z.array(z.string().min(1)).min(1),
  roles: z.array(z.enum(['anonymous', 'user', 'admin'])).min(1),
  effect: z.enum(['read', 'write', 'delete']),
  confirmation: z.enum(['none', 'single', 'double']),
  outputSchema: z.string().min(1),
  phase: z.enum(['learner-v1', 'admin-v2']),
}).strict().superRefine((value, context) => {
  if (value.effect === 'delete' && value.confirmation !== 'double') {
    context.addIssue({ code: 'custom', path: ['confirmation'], message: 'delete requires double confirmation' })
  }
  if (value.effect === 'write' && value.confirmation === 'none') {
    context.addIssue({ code: 'custom', path: ['confirmation'], message: 'write requires confirmation' })
  }
})
```

Export the exact registry as `learnerCapabilities` and enforce unique IDs at module initialization.

- [ ] **Step 4: Add stable CLI output and error schemas**

```ts
export const CliSuccessSchema = z.object({
  ok: z.literal(true), apiVersion: z.literal('v1'), capabilityId: LearnerCapabilityIdSchema,
  data: z.unknown(), requestId: z.string().min(1),
}).strict()

export const CliFailureSchema = z.object({
  ok: z.literal(false), code: z.string().regex(/^[A-Z0-9_]+$/u),
  message: z.string().min(1), details: z.unknown().optional(), requestId: z.string().min(1),
}).strict()
```

Add named stable errors for `UNAUTHORIZED`, `FORBIDDEN`, `INPUT_INVALID`, `STATE_NOT_ALLOWED`, `APPLICATION_REVISION_CONFLICT`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_EXPIRED`, `CONFIRMATION_MISMATCH`, `CONFIRMATION_ALREADY_USED`, `RESOURCE_NOT_FOUND`, and `SERVICE_UNAVAILABLE`.

- [ ] **Step 5: Add confirmation schemas**

The prepare request must contain only nonsecret canonical input:

```ts
export const ConfirmationPrepareRequestSchema = z.object({
  capabilityId: LearnerCapabilityIdSchema,
  payload: z.record(z.string(), z.unknown()),
  clientBinding: z.string().regex(/^[a-f0-9]{64}$/u),
  idempotencyKey: z.string().uuid(),
}).strict()
```

The response contains `confirmationId`, `expiresAt`, `preview`, `payloadSha256`, and required confirmation mode. Execution contains `confirmationId`, the same `clientBinding`, `idempotencyKey`, and the operation body supplied through the operation-specific route.

- [ ] **Step 6: Export contracts and run tests/typecheck**

Run:

```bash
npm test -w @panshi/contracts -- --run src/capabilities.test.ts src/cli.test.ts src/confirmation.test.ts
npm run typecheck -w @panshi/contracts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/capabilities.ts packages/contracts/src/capabilities.test.ts packages/contracts/src/cli.ts packages/contracts/src/cli.test.ts packages/contracts/src/confirmation.ts packages/contracts/src/confirmation.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): define learner CLI capabilities"
```

---

### Task 2: Add CLI-scoped bearer sessions without breaking browser sessions

**Files:**

- Create: `apps/api/drizzle/0022_cli_sessions.sql`
- Create: `apps/api/tests/cli-auth.test.ts`
- Create: `apps/api/tests/cli-auth.integration.test.ts`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/modules/identity/identity.repository.ts`
- Modify: `apps/api/src/modules/identity/session.service.ts`
- Modify: `apps/api/src/modules/identity/auth.routes.ts`
- Modify: `apps/api/src/middleware/require-user.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/audit/audit-policy.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write adversarial authentication tests first**

Tests must reject:

1. `Authorization: Bearer` with an empty or malformed token.
2. A request carrying both a session cookie and a bearer token.
3. A valid CLI token used after logout, password reset, account disable, or expiry.
4. A user CLI token on an admin route.
5. A CLI login response that accidentally places the token in an audit record or ordinary log body.

Also prove that CLI login does not revoke an active Web session, while a second CLI login revokes the prior CLI session only.

- [ ] **Step 2: Run the auth tests and verify they fail**

Run: `npm test -w @panshi/api -- --run tests/cli-auth.test.ts`

Expected: FAIL because bearer authentication and session kinds are absent.

- [ ] **Step 3: Add session kind through an append-only migration**

Migration requirements:

```sql
ALTER TABLE "sessions"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'web';
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_kind_check" CHECK ("kind" IN ('web', 'cli', 'admin_web', 'admin_cli'));
CREATE INDEX "sessions_user_kind_active_idx"
  ON "sessions" ("user_id", "kind") WHERE "revoked_at" IS NULL;
```

Do not edit prior migrations. Add `kind` to the Drizzle schema and repository selection.

- [ ] **Step 4: Make session rotation kind-scoped**

Change `login` to receive a session kind and revoke only active sessions of that kind. Keep password reset, forced reset, and account disable revoking all session kinds.

```ts
loginStudentWeb(phone, password)  // web
loginStudentCli(phone, password)  // cli
loginAdminWeb(phone, password)    // admin_web
loginAdminCli(phone, password)    // admin_cli
```

- [ ] **Step 5: Add dedicated CLI login/logout endpoints**

Add:

- `POST /api/v1/auth/cli/login`
- `POST /api/v1/auth/cli/logout`

The login response exposes the raw bearer token only in this dedicated response and sets `Cache-Control: no-store`. It must never set a cookie. Browser login keeps its current HttpOnly cookie behavior.

```ts
response.setHeader('Cache-Control', 'no-store')
response.json(CliLoginResponseSchema.parse({
  apiVersion: 'v1',
  data: { token: result.token, expiresAt: result.expiresAt.toISOString(), user: result.user },
}))
```

- [ ] **Step 6: Resolve exactly one credential source**

Replace cookie-only token extraction with a request-aware function. If both Cookie and Bearer are present, fail closed with `AUTH_CREDENTIALS_AMBIGUOUS`. Accept only `Bearer <64 lowercase hex characters>`.

- [ ] **Step 7: Add safe audit actions**

Record `auth.cli_login_succeeded` and `auth.cli_logout` with only `{ clientKind: 'cli' }`. Extend audit-policy negative tests using the actual strings `token`, `cookie`, `password`, and a 64-character token to prove the sanitizer rejects leakage.

- [ ] **Step 8: Run unit, integration, migration, and browser-regression tests**

Run:

```bash
npm test -w @panshi/api -- --run tests/cli-auth.test.ts
npm run test:integration:migrations -w @panshi/api
npm run test:integration:student-auth -w @panshi/api
npm run e2e:student-auth
```

Expected: all PASS; Web login remains cookie-based; CLI login returns a bearer token and leaves the Web session active.

- [ ] **Step 9: Commit**

```bash
git add apps/api/drizzle/0022_cli_sessions.sql apps/api/src/db/schema.ts apps/api/src/modules/identity apps/api/src/middleware/require-user.ts apps/api/src/app.ts apps/api/tests/cli-auth.test.ts apps/api/tests/cli-auth.integration.test.ts apps/api/package.json
git commit -m "feat(auth): add isolated CLI sessions"
```

---

### Task 3: Implement server-owned confirmation intents

**Files:**

- Create: `apps/api/drizzle/0023_confirmation_intents.sql`
- Create: `apps/api/src/modules/confirmations/confirmation.repository.ts`
- Create: `apps/api/src/modules/confirmations/confirmation.service.ts`
- Create: `apps/api/src/modules/confirmations/confirmation.routes.ts`
- Create: `apps/api/src/modules/confirmations/confirmation-handlers.ts`
- Create: `apps/api/tests/confirmation-intents.test.ts`
- Create: `apps/api/tests/confirmation-intents.integration.test.ts`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/audit/audit-policy.ts`

- [ ] **Step 1: Write adversarial confirmation tests before implementation**

Construct and reject:

1. Intent prepared by user A and executed by user B.
2. Intent executed with a different capability ID, payload hash, target ID, or revision.
3. Expired intent.
4. Previously consumed intent replayed with the same idempotency key.
5. Concurrent double execution; exactly one request may reach the business handler.
6. Unknown capability IDs and a capability that is read-only.
7. An anonymous intent with a different client binding.
8. Secret-looking fields (`password`, `code`, `token`, `cookie`) in canonical preview payload.

- [ ] **Step 2: Run and observe failure**

Run: `npm test -w @panshi/api -- --run tests/confirmation-intents.test.ts`

Expected: FAIL because the confirmation module does not exist.

- [ ] **Step 3: Add the confirmation table and constraints**

Create `confirmation_intents` with:

- UUID primary key;
- nullable `actor_user_id`;
- `site_id = 'panshi-ai4s-camp'`;
- capability ID;
- SHA-256 payload digest;
- JSON preview containing no secret values;
- nullable target type, target ID, expected revision;
- client-binding digest;
- UUID idempotency key;
- `pending | executing | consumed | expired | failed` status;
- created, expires, consumed timestamps;
- a partial unique `(actor_user_id, idempotency_key)` for authenticated intents;
- a partial unique `(client_binding_digest, idempotency_key)` for anonymous intents;
- indexes for actor/status/expiry.

Use a five-minute TTL. A cleanup query may mark stale intents expired, but no scheduled job is required in this phase.

- [ ] **Step 4: Implement canonicalization and allowlisted handlers**

Canonical JSON must sort object keys recursively and reject `undefined`, functions, symbols, non-finite numbers, and prototype-bearing objects. Hash UTF-8 bytes with SHA-256.

```ts
const canonical = canonicalJson(payload)
const payloadSha256 = createHash('sha256').update(canonical).digest('hex')
```

`confirmation-handlers.ts` must be a closed map keyed by `LearnerCapabilityId`, not a URL or arbitrary module name supplied by the caller.

- [ ] **Step 5: Add prepare and execute routes**

Add:

- `POST /api/v1/confirmations/prepare`
- `POST /api/v1/confirmations/:id/execute`
- `POST /api/v1/confirmations/:id/upload` for the single confirmed multipart upload path

Both authenticated and anonymous intent preparation use rate limiting. Anonymous intents are allowed only for `auth.verification.send`, `auth.register`, `auth.login`, and `auth.password_reset` and must bind to a client-generated 256-bit nonce digest.

Execution claims the intent with an atomic `pending -> executing` transition, validates all bindings, calls the allowlisted operation, then stores a redacted result summary and marks the intent consumed. A second call never invokes the handler again: consumed intents return the stored safe result, while an intent left `executing` after an interrupted process returns `CONFIRMATION_EXECUTION_INDETERMINATE` and instructs the caller to reread business state. The multipart endpoint follows the same state machine and is the only confirmation execution route that accepts a stream.

- [ ] **Step 6: Extend audit policy**

Add `confirmation.prepared`, `confirmation.consumed`, and `confirmation.rejected` with metadata limited to capability ID, result code, and target type. Do not record canonical payload, client binding, QR payload, password, verification code, or bearer token.

- [ ] **Step 7: Run unit, integration, and concurrent replay tests**

Run:

```bash
npm test -w @panshi/api -- --run tests/confirmation-intents.test.ts
npm run test:integration:schema -w @panshi/api
npm test -w @panshi/api -- --run tests/confirmation-intents.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: PASS, including the concurrent replay test reporting one business call and one `CONFIRMATION_ALREADY_USED` response.

- [ ] **Step 8: Commit**

```bash
git add apps/api/drizzle/0023_confirmation_intents.sql apps/api/src/db/schema.ts apps/api/src/modules/confirmations apps/api/src/app.ts apps/api/src/modules/audit/audit-policy.ts apps/api/tests/confirmation-intents.test.ts apps/api/tests/confirmation-intents.integration.test.ts
git commit -m "feat(api): add confirmed mutation intents"
```

---

### Task 4: Route learner mutations through the confirmation protocol

**Files:**

- Create: `apps/api/tests/confirmed-learner-mutations.test.ts`
- Modify: `apps/api/src/modules/confirmations/confirmation-handlers.ts`
- Modify: `apps/api/src/modules/registration/application.routes.ts`
- Modify: `apps/api/src/modules/files/file.routes.ts`
- Modify: `apps/api/src/modules/identity/auth.routes.ts`
- Modify: `apps/api/src/modules/identity/admin-users.routes.ts`
- Modify: `apps/web/src/api/application-client.ts`
- Modify: `apps/web/src/api/auth-client.ts`
- Modify: `packages/contracts/src/confirmation.ts`

- [ ] **Step 1: Write failing behavior tests for every learner mutation**

For each capability below, prove direct mutation without a valid confirmation returns `409 CONFIRMATION_REQUIRED`, while prepare + execute succeeds:

- verification-code send;
- registration;
- login;
- password reset;
- password change;
- logout;
- application draft save;
- application reopen;
- application submit;
- file upload;
- file hide;
- file delete.

Also prove existing Web clients can use the same prepare/execute API and preserve current UI behavior.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -w @panshi/api -- --run tests/confirmed-learner-mutations.test.ts`

Expected: FAIL because direct routes still mutate.

- [ ] **Step 3: Register application handlers with revision binding**

For draft save, canonical preview lists changed top-level profile fields, answer IDs, attachment slot IDs, and expected revision—not full free-text answers. Execution reparses the operation-specific Zod schema and rechecks `expectedRevision` in the repository transaction.

- [ ] **Step 4: Register authentication handlers without hashing secrets**

Prepare payloads contain normalized/masked phone and purpose. Execution supplies password/code directly to the operation handler after confirmation validation. Never persist or audit execution secrets.

- [ ] **Step 5: Register file handlers with content binding**

Before prepare, the client computes SHA-256, size, normalized filename, slot, and MIME type. Prepare binds those metadata. Upload execute sends multipart data to `/api/v1/confirmations/:id/upload` plus idempotency key and client binding. The server recomputes SHA-256 while streaming and refuses mismatches before finalizing storage. All other confirmed writes execute through `/api/v1/confirmations/:id/execute`; the old mutation routes reject unconfirmed direct calls.

Adversarial file tests must cover:

- symlink input on the CLI side;
- filename traversal such as `../../resume.pdf`;
- content changed between prepare and execute;
- MIME/extension mismatch;
- temporary file cleanup when confirmation validation or content validation fails;
- deleting another user's file;
- double delete replay.

- [ ] **Step 6: Keep browser flows functional through the same protocol**

Temporarily adapt the three existing browser clients to prepare and immediately show their existing explicit action UI before execute. Do not add an invisible auto-confirm path.

- [ ] **Step 7: Run focused and existing regression suites**

Run:

```bash
npm test -w @panshi/api -- --run tests/confirmed-learner-mutations.test.ts tests/files.test.ts tests/application.test.ts
npm test -w @panshi/web
npm run e2e:student-auth
npm run e2e:application
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/confirmations/confirmation-handlers.ts apps/api/src/modules/registration/application.routes.ts apps/api/src/modules/files/file.routes.ts apps/api/src/modules/identity apps/api/tests/confirmed-learner-mutations.test.ts apps/web/src/api/application-client.ts apps/web/src/api/auth-client.ts packages/contracts/src/confirmation.ts
git commit -m "feat(api): require confirmation for learner writes"
```

---

### Task 5: Build the shared TypeScript client

**Files:**

- Create: `packages/camp-client/package.json`
- Create: `packages/camp-client/tsconfig.json`
- Create: `packages/camp-client/tsconfig.build.json`
- Create: `packages/camp-client/src/http.ts`
- Create: `packages/camp-client/src/public.ts`
- Create: `packages/camp-client/src/auth.ts`
- Create: `packages/camp-client/src/application.ts`
- Create: `packages/camp-client/src/files.ts`
- Create: `packages/camp-client/src/check-in.ts`
- Create: `packages/camp-client/src/confirmations.ts`
- Create: `packages/camp-client/src/index.ts`
- Create: `packages/camp-client/src/*.test.ts`
- Modify: `tests/workspaces.test.mjs`
- Modify: `package-lock.json`

- [ ] **Step 1: Write transport tests before the package exists**

Use an injected `fetch` and credential adapter. Test:

- strict base URL validation;
- no-argument default resolves to `http://127.0.0.1:3001` and never production;
- production HTTP URL rejected;
- URL credentials/query/fragment rejected;
- bearer token never appears in thrown errors;
- response bodies are parsed through contract schemas;
- `429 Retry-After`, request ID, and stable API error details are preserved;
- downloads stream to a caller-provided sink rather than buffering unbounded content.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -w @panshi/camp-client`

Expected: npm reports the workspace does not exist.

- [ ] **Step 3: Add the workspace package and safe transport**

```ts
export type CampClientOptions = {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  credentialProvider?: { getToken(): Promise<string | null> }
}

export const createCampClient = (options: CampClientOptions = {}) => {
  const baseUrl = resolveCliBaseUrl(options.baseUrl)
  const transport = createTransport({ baseUrl, fetch: options.fetch ?? fetch, credentialProvider: options.credentialProvider })
  return {
    public: createPublicApi(transport), auth: createAuthApi(transport),
    application: createApplicationApi(transport), files: createFilesApi(transport),
    checkIn: createCheckInApi(transport), confirmations: createConfirmationApi(transport),
  }
}
```

Do not read environment variables inside the package. The CLI or Web adapter supplies the base URL and credentials.

- [ ] **Step 4: Implement all public and learner methods against current routes**

Every method must declare its capability ID and parse the response through `@panshi/contracts`. Download methods accept an `onHeaders` callback and return a `ReadableStream<Uint8Array>` or pipe to a supplied sink.

- [ ] **Step 5: Add a confirmation helper without automatic execution**

```ts
const prepared = await client.confirmations.prepare(capabilityId, payload, context)
// The library returns here. Only the caller may display preview and request confirmation.
const result = await client.confirmations.execute(prepared.confirmationId, executionBody, context)
```

There must be no `prepareAndExecute` convenience function.

- [ ] **Step 6: Run package tests/typecheck/build and workspace test**

Run:

```bash
npm install
npm test -w @panshi/camp-client
npm run typecheck -w @panshi/camp-client
npm run build -w @panshi/camp-client
node tests/workspaces.test.mjs
```

Expected: PASS and workspace test recognizes `camp-client` as a private package.

- [ ] **Step 7: Commit**

```bash
git add packages/camp-client tests/workspaces.test.mjs package-lock.json
git commit -m "feat(client): add shared camp API client"
```

---

### Task 6: Replace Web API duplication with the shared client and bind Web capability IDs

**Files:**

- Create: `apps/web/src/capabilities.ts`
- Create: `apps/web/src/capabilities.test.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/api/public-client.ts`
- Modify: `apps/web/src/api/auth-client.ts`
- Modify: `apps/web/src/api/application-client.ts`
- Modify: `apps/web/src/pages/*.tsx`
- Modify: `apps/web/src/features/**/*.tsx`
- Modify: `package-lock.json`

- [ ] **Step 1: Write a failing Web capability-binding test**

Require every route/action represented in the current Web app to declare a learner capability ID. Test the exact browser routes from `App.tsx` and button operations in registration, account, files, resources, and check-in.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -w @panshi/web -- --run src/capabilities.test.ts`

Expected: FAIL because `apps/web/src/capabilities.ts` does not exist.

- [ ] **Step 3: Add Web bindings**

```ts
export const webCapabilities = defineWebCapabilities({
  '/': ['public.site.show', 'public.application_count.show'],
  '/schedule': ['public.schedule.list'],
  '/travel': ['public.travel.show'],
  '/contact': ['public.contacts.show'],
  '/resources': ['resource.list', 'resource.download'],
  '/register': ['auth.verification.send', 'auth.register'],
  '/login': ['auth.login'],
  '/forgot-password': ['auth.verification.send', 'auth.password_reset'],
  '/application': ['public.registration_form.show', 'public.institutions.search', 'application.show', 'application.draft.save', 'application.reopen', 'application.submit', 'file.upload', 'file.download', 'file.delete'],
  '/account': ['auth.status', 'auth.logout', 'account.password_change', 'application.show', 'check_in.show'],
})
```

The file must only bind IDs; it must not copy endpoint paths.

- [ ] **Step 4: Make existing Web adapters thin wrappers**

Retain current exported names to keep page changes small, but delegate HTTP, auth errors, downloads, and Zod parsing to `@panshi/camp-client`. Browser credential provider remains cookie-based and never sees raw session tokens.

- [ ] **Step 5: Run Web regressions**

Run:

```bash
npm test -w @panshi/web
npm run typecheck -w @panshi/web
npm run build -w @panshi/web
npm run e2e:student-auth
npm run e2e:application
```

Expected: PASS with no visible page regression.

- [ ] **Step 6: Commit**

```bash
git add apps/web package-lock.json
git commit -m "refactor(web): use shared camp client"
```

---

### Task 7: Create the safe CLI shell, configuration, and keychain credential store

**Files:**

- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/tsconfig.build.json`
- Create: `apps/cli/src/main.ts`
- Create: `apps/cli/src/argv.ts`
- Create: `apps/cli/src/config.ts`
- Create: `apps/cli/src/credentials.ts`
- Create: `apps/cli/src/io.ts`
- Create: `apps/cli/src/output.ts`
- Create: `apps/cli/src/errors.ts`
- Create: `apps/cli/src/*.test.ts`
- Modify: `tests/workspaces.test.mjs`
- Modify: `package-lock.json`

- [ ] **Step 1: Write safe-default and secret-leak tests first**

Test these concrete failures:

1. `panshi-camp` with no command prints help and performs no network or filesystem mutation.
2. No configured endpoint defaults to `http://127.0.0.1:3001`, never the live domain.
3. `--password`, `--verification-code`, `--token`, and `--cookie` are unknown options.
4. Non-TTY secret prompts fail with `INTERACTIVE_INPUT_REQUIRED` unless secrets arrive through a dedicated inherited file descriptor—not stdin mixed with JSON.
5. Keychain reads/writes are behind an adapter and test doubles; errors never include secret values.
6. Config files containing `token`, `cookie`, `password`, or verification code keys are rejected.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -w @panshi/cli`

Expected: npm reports the workspace does not exist.

- [ ] **Step 3: Add package metadata and binary entry**

Use `node:util.parseArgs`; do not add a command parser dependency. Package metadata:

```json
{
  "name": "@panshi/cli",
  "private": true,
  "type": "module",
  "bin": { "panshi-camp": "./dist/main.js" }
}
```

Depend on `@panshi/camp-client`, `@panshi/contracts`, `@napi-rs/keyring@1.3.0`, `qr@0.6.0`, and no general command-parser dependency.

- [ ] **Step 4: Implement configuration with safe precedence**

Order: explicit `--base-url` → named local profile → `PANSHI_CAMP_BASE_URL` → `http://127.0.0.1:3001`.

Production URLs require both an explicit profile and `--environment production`; a bare URL is insufficient. Config contains only profile name, URL, and masked phone hint. Use mode `0600`, reject symlinks, and refuse a config directory not owned by the current user.

- [ ] **Step 5: Implement keychain adapter**

Use `@napi-rs/keyring` behind:

```ts
export interface CredentialStore {
  get(profile: string): Promise<string | null>
  set(profile: string, token: string): Promise<void>
  delete(profile: string): Promise<void>
}
```

Service name: `cn.ac.tashan.panshi-camp`. Account key: `<profile>:cli-session`. Never offer plaintext fallback. If the keychain is unavailable, return `KEYCHAIN_UNAVAILABLE` and stop.

- [ ] **Step 6: Implement human and JSON output**

`--json` writes exactly one JSON document to stdout. Human progress and prompts go to stderr. JSON mode never emits ANSI color. Map every API/client error to the stable CLI failure schema and preserve request IDs.

- [ ] **Step 7: Run tests/typecheck/build**

Run:

```bash
npm install
npm test -w @panshi/cli
npm run typecheck -w @panshi/cli
npm run build -w @panshi/cli
node tests/workspaces.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/cli tests/workspaces.test.mjs package-lock.json
git commit -m "feat(cli): add safe command runtime"
```

---

### Task 8: Implement public, authentication, and read-only learner commands

**Files:**

- Create: `apps/cli/src/commands/public.ts`
- Create: `apps/cli/src/commands/resources.ts`
- Create: `apps/cli/src/commands/auth.ts`
- Create: `apps/cli/src/commands/application.ts`
- Create: `apps/cli/src/commands/check-in.ts`
- Create: `apps/cli/src/commands/*.test.ts`
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: Write command-contract tests**

Cover every read command from the approved design:

```text
info show
content get <key>
schedule list [--date] [--topic]
travel show
contacts show
institutions search <query>
application form
resources list
resources download <id> --output <path>
auth login
auth status
application show
application validate --input <path|->
files download <id> --output <path>
check-in show
check-in qr export --output <path>
```

Tests must prove JSON schema validity and exact capability ID for every command.

- [ ] **Step 2: Add download path rejection tests**

Reject:

- existing output files;
- output paths whose parent is a symlink;
- directories;
- `/`, the workspace root, home directory, and unresolved environment-variable strings;
- a server-supplied filename containing traversal.

On interrupted download, remove only the CLI-created temporary file; never remove a pre-existing target.

- [ ] **Step 3: Implement the commands**

Use one command registry:

```ts
export const learnerCommands = defineCommands([
  command('public.site.show', ['info', 'show'], runInfoShow),
  command('public.schedule.list', ['schedule', 'list'], runScheduleList),
  // every learner capability is registered here exactly once
])
```

`auth login` prompts for phone and hidden password, requests a CLI session, stores the bearer token in keychain, and outputs only the public profile and expiry. `auth status` verifies the token against `/api/v1/me/profile`.

`check-in show --json` redacts `qrPayload`. `check-in qr export` obtains the payload in memory, writes the QR image with mode `0600`, and zeroes/discards the buffer reference immediately after generation.

- [ ] **Step 4: Run command tests and a read-only local smoke test**

Run:

```bash
npm test -w @panshi/cli -- --run src/commands
npm run build -w @panshi/cli
node apps/cli/dist/main.js --json info show
node apps/cli/dist/main.js --json schedule list --date 2026-09-04
```

Expected: tests PASS; smoke commands return one valid JSON document each and make only GET requests.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src
git commit -m "feat(cli): add public and learner read commands"
```

---

### Task 9: Implement confirmed learner write and delete commands

**Files:**

- Create: `apps/cli/src/confirmation-flow.ts`
- Create: `apps/cli/src/commands/files.ts`
- Create: `apps/cli/src/commands/account.ts`
- Create: `apps/cli/src/confirmation-flow.test.ts`
- Modify: `apps/cli/src/commands/auth.ts`
- Modify: `apps/cli/src/commands/application.ts`
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: Write failing two-stage flow tests**

Verify:

- prepare never executes the mutation;
- preview is printed before the confirmation prompt;
- EOF, timeout, `n`, or nonmatching target identifier cancels safely;
- `--json` without `--confirmation-id` returns `CONFIRMATION_REQUIRED` and the prepared preview, never auto-executes;
- a second invocation with `--confirmation-id` executes only the exact bound operation;
- revision conflict requires a fresh read and a new intent;
- delete requires typing the exact file ID;
- no `--yes`, `--force`, or environment-variable bypass exists.

- [ ] **Step 2: Implement the generic confirmation flow**

Interactive mode:

```ts
const prepared = await client.confirmations.prepare(capabilityId, payload, context)
io.printPreview(prepared.preview)
await io.requireConfirmation(prepared.confirmation)
return client.confirmations.execute(prepared.confirmationId, executionBody, context)
```

Agent/JSON mode is intentionally two invocations: prepare returns a confirmation record; execute requires the record ID and exact idempotency/client binding context.

- [ ] **Step 3: Implement all learner writes**

Commands:

```text
auth verification send
auth register
auth logout
auth password-reset
account password-change
application save --input <path|->
application reopen
application submit
files upload <path> --slot <slot-id>
files hide <id>
files delete <id>
```

`application save` dynamically fetches the currently published registration form, validates field IDs and attachment slots, and requires the input document to include the last-read `expectedRevision`.

- [ ] **Step 4: Add deterministic stdin/file input handling**

`--input -` consumes JSON only. Secrets cannot share stdin; secret-requiring commands in JSON mode require an inherited descriptor named by `PANSHI_SECRET_FD`. Validate that it is an integer descriptor greater than 2, opened by the parent, and never log its contents. Interactive mode uses hidden TTY prompts.

- [ ] **Step 5: Run tests and full CLI workflow against a test API**

Run:

```bash
npm test -w @panshi/cli
npm run typecheck -w @panshi/cli
npm run build -w @panshi/cli
npm run test:integration:application -w @panshi/api
npm run test:integration:files -w @panshi/api
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src
git commit -m "feat(cli): add confirmed learner mutations"
```

---

### Task 10: Package the learner Skill and safe installer

**Files:**

- Create: `skills/panshi-camp/SKILL.md`
- Create: `skills/panshi-camp/capabilities.json`
- Create: `skills/panshi-camp/examples/register-and-apply.md`
- Create: `skills/panshi-camp/examples/check-status-and-check-in.md`
- Create: `apps/cli/src/commands/skill.ts`
- Create: `apps/cli/src/commands/skill.test.ts`
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: Write failing Skill-package tests**

Tests must verify:

- frontmatter name is `panshi-camp`;
- Skill references CLI commands, not copied endpoint URLs or schemas;
- no fixed dates, speakers, contacts, phone numbers, application status, password, code, token, cookie, or QR payload appear;
- all learner capability IDs appear exactly once in `capabilities.json`;
- no admin capability appears;
- every write example stops after prepare and asks the user before execute.

- [ ] **Step 2: Write the Skill**

Required sections:

1. Trigger and scope.
2. Install/check CLI.
3. Authentication check.
4. Read-task command selection.
5. Dynamic registration-form collection.
6. Prepare/preview/confirm/execute protocol.
7. Stable error-code recovery.
8. Attachment and download safety.
9. Prohibited behavior.

The Skill must tell an Agent to use `--json`, preserve `expectedRevision`, show the entire server preview, and never infer user confirmation from earlier conversation.

- [ ] **Step 3: Add a safe installer command**

Commands:

```text
skill path
skill install --agent codex
skill install --agent claude-code
```

`skill install` first prints source/target/diff and exits with `CONFIRMATION_REQUIRED`. A second explicit confirmation installs by copying into the agent's standard Skill directory. Refuse symlink targets, existing nonmatching directories, broad targets such as home/root, and unsupported agents. Never overwrite silently.

- [ ] **Step 4: Test Skill behavior with fixture Agent transcripts**

Create fixtures for:

- “帮我看看日程” → read command only;
- “帮我提交报名” → fetch form, validate, prepare, stop for confirmation;
- “删掉附件” → prepare, show exact target, require typed file ID;
- prompt injection inside a content field → treated as data, not instructions;
- request for admin review data → refused by learner Skill.

- [ ] **Step 5: Run tests**

Run: `npm test -w @panshi/cli -- --run src/commands/skill.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/panshi-camp apps/cli/src/commands/skill.ts apps/cli/src/commands/skill.test.ts apps/cli/src/main.ts
git commit -m "feat(skill): package learner camp operations"
```

---

### Task 11: Implement the Web–CLI–Skill parity gate and its real negative self-test

**Files:**

- Create: `scripts/check-web-cli-parity.mjs`
- Create: `scripts/check-web-cli-parity.self-test.mjs`
- Create: `tests/web-cli-parity.test.mjs`
- Modify: `package.json`
- Modify: `scripts/run-release-tests.mjs`

- [ ] **Step 1: Write the gate self-test before the gate**

The self-test must construct temporary real-shape registry fixtures and assert these exact failures:

1. `CLI_MISSING_CAPABILITY public.schedule.list`
2. `SKILL_MISSING_CAPABILITY application.submit`
3. `LEARNER_SKILL_REFERENCES_ADMIN_CAPABILITY admin.application.review`
4. `CONFIRMATION_LEVEL_MISMATCH file.delete`
5. `DUPLICATE_CAPABILITY_ID resource.download`
6. A complete fixture exits zero.

It must invoke the real gate module, not copy its comparison logic.

- [ ] **Step 2: Run the self-test and observe failure**

Run: `node scripts/check-web-cli-parity.self-test.mjs`

Expected: FAIL because the gate does not exist.

- [ ] **Step 3: Implement the gate**

The gate reads:

- canonical registry from built `@panshi/contracts`;
- `apps/web/src/capabilities.ts` through a generated JSON export command;
- CLI command registry through `panshi-camp internal capabilities --json`;
- `skills/panshi-camp/capabilities.json`.

Do not parse TypeScript with regex. Compare sets, roles, phase, effect, and confirmation level. Report all differences in deterministic sorted order and exit nonzero.

- [ ] **Step 4: Wire the gate to test and release**

Add:

```json
"check:parity": "node scripts/check-web-cli-parity.mjs",
"test:parity": "node scripts/check-web-cli-parity.self-test.mjs && node --test tests/web-cli-parity.test.mjs"
```

Make root `test` and `scripts/run-release-tests.mjs` run `test:parity`. The release runner test must assert parity is included.

- [ ] **Step 5: Prove the gate catches real checked-in drift**

In the self-test temp copy, delete `application.submit` from CLI output and verify nonzero. Then restore and delete it from Skill index and verify nonzero. Finally run the clean repository and verify zero.

Run:

```bash
node scripts/check-web-cli-parity.self-test.mjs
npm run check:parity
npm run test:parity
```

Expected: self-test prints each expected rejection and `parity self-test ok`; repository gate prints `web-cli-skill parity ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-web-cli-parity.mjs scripts/check-web-cli-parity.self-test.mjs tests/web-cli-parity.test.mjs package.json scripts/run-release-tests.mjs
git commit -m "test(parity): enforce Web CLI Skill coverage"
```

---

### Task 12: Add no-browser end-to-end acceptance and operator documentation

**Files:**

- Create: `e2e/cli-learner-workflow.spec.ts`
- Create: `playwright.cli.config.ts`
- Create: `scripts/run-cli-e2e.mjs`
- Create: `docs/cli.md`
- Create: `docs/cli-release-checklist.md`
- Modify: `package.json`
- Modify: `docs/api.md`

- [ ] **Step 1: Write the E2E test as a user story**

The test must use only API fixtures and the built CLI process—never browser page objects—to:

1. Read public site, schedule, contacts, travel, institutions, form, and resources.
2. Request a test verification code, register, and login.
3. Read the dynamic form and institution directory.
4. Prepare and confirm a draft save.
5. Prepare and confirm an attachment upload.
6. Re-read and submit the application with the latest revision.
7. Observe `submitted` and timeline entries.
8. Move the fixture application through the existing admin test helper to `admitted`.
9. Read check-in status and export a QR image without raw payload in stdout/stderr.
10. Logout and verify protected reads fail with `UNAUTHORIZED`.

- [ ] **Step 2: Add failure-path E2E cases**

Include:

- stale application revision;
- expired confirmation;
- replayed confirmation;
- changed upload after prepare;
- inaccessible admitted-only resource before admission;
- existing output file;
- keychain unavailable test adapter;
- server unavailable.

- [ ] **Step 3: Document exact installation and operation**

`docs/cli.md` must include:

- supported Node/npm versions;
- build/install commands;
- local profile setup;
- keychain behavior;
- human vs JSON mode;
- complete learner command reference generated from the command registry;
- confirmation semantics;
- exit-code table;
- no plaintext credential fallback;
- Skill installation and verification.

Generate the command reference during tests and fail on documentation drift instead of asking maintainers to remember updates.

- [ ] **Step 4: Run layered verification**

Run in this order and record outputs separately:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:parity
npm test
npm run e2e:cli
npm run e2e:student-auth
npm run e2e:application
npm run test:release
```

Expected: all commands PASS. If a workspace has no lint script, root ESLint remains the lint evidence; do not claim a nonexistent workspace lint command.

- [ ] **Step 5: Manually verify safe defaults in a clean temporary profile**

Run:

```bash
panshi_test_profile_root="$(mktemp -d)"
env -i PATH="$PATH" PANSHI_CAMP_PROFILE_ROOT="$panshi_test_profile_root" node apps/cli/dist/main.js
env -i PATH="$PATH" PANSHI_CAMP_PROFILE_ROOT="$panshi_test_profile_root" node apps/cli/dist/main.js --json info show
```

Expected:

- first command prints help and performs no write;
- second attempts only `http://127.0.0.1:3001`;
- neither command references the production domain or creates plaintext credentials.

- [ ] **Step 6: Review the complete diff against the approved design**

Check:

- every approved learner capability exists in Web, CLI, and Skill;
- every mutation uses confirmation and server authorization;
- no password/code/token/cookie/QR payload appears in logs, JSON, config, docs examples, test snapshots, or audit metadata;
- the Admin phase is explicitly marked uncovered rather than falsely passing;
- no copied endpoint/schema drift remains in Web clients or Skill;
- all new gates have real negative self-tests.

- [ ] **Step 7: Commit**

```bash
git add e2e/cli-learner-workflow.spec.ts playwright.cli.config.ts scripts/run-cli-e2e.mjs docs/cli.md docs/cli-release-checklist.md docs/api.md package.json
git commit -m "test(cli): verify no-browser learner workflow"
```

---

## Final acceptance boundary

This phase is complete only when all of the following are true:

- A learner can complete the full public, account, registration, attachment, resource, and check-in workflow with CLI + Skill and no browser.
- Existing public/learner Web flows still pass and use the same shared client contracts.
- Every server mutation requires a valid one-time confirmation intent and remains protected by server-side role/state/revision checks.
- CLI credentials exist only in the OS keychain; the CLI has no plaintext fallback.
- The default CLI target is local and read-safe.
- The parity gate passes, and its negative self-test proves it catches missing commands, missing Skill entries, wrong roles, duplicate IDs, and confirmation drift.
- JSON output is stable, single-document, secret-free, and carries capability and request IDs.
- Admin Web parity is explicitly deferred to a separate Admin CLI/Admin Skill plan and cannot be mistaken for completed coverage.

After this phase is accepted, create a separate implementation plan for the reusable Claude Agent SDK service and website floating assistant. That service must call `@panshi/camp-client` directly and load this learner Skill; it must not shell out to the CLI.
