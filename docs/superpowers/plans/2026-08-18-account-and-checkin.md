# Account and Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished three-section student account center and a secure, auditable admission-only QR check-in workflow in the existing Panshi camp system.

**Architecture:** Extend the existing modular monolith with a focused `check-in` module and shared Zod contracts. The web app renders account navigation, editable profile fields, status presentation, and admission-only QR codes; the admin app scans or accepts check-in codes, then performs explicit confirm or reasoned revoke operations. PostgreSQL remains the single source of truth, and the API enforces all admission, idempotency, authorization, and audit rules.

**Tech Stack:** TypeScript 6, React 19, Express 5, PostgreSQL, Drizzle ORM, Zod, Vitest, Testing Library, Playwright, `qrcode.react`, `@zxing/browser`.

---

## File map

**Create**

- `apps/api/drizzle/0021_check_in.sql` — check-in credentials and check-in records.
- `apps/api/src/modules/check-in/check-in.repository.ts` — transactional persistence and concurrency control.
- `apps/api/src/modules/check-in/check-in.service.ts` — HMAC credential issue/verify and business rules.
- `apps/api/src/modules/check-in/check-in.routes.ts` — student and administrator HTTP endpoints.
- `apps/api/tests/check-in.test.ts` — service and route behavior.
- `apps/api/tests/check-in.integration.test.ts` — real database issue/confirm/repeat/revoke flow.
- `apps/web/src/features/account/application-status.ts` — one source for user-facing status labels and flow.
- `apps/web/src/features/account/AccountNavigation.tsx` — three-section account navigation.
- `apps/web/src/features/account/ProfilePanel.tsx` — row-aligned profile display/edit form.
- `apps/web/src/features/account/SecurityPanel.tsx` — styled password and logout controls.
- `apps/web/src/features/account/CheckInPanel.tsx` — admission-gated QR presentation.
- `apps/web/tests/account-page.test.tsx` — account layout, editing, states, and QR tests.
- `apps/admin/src/pages/CheckInPage.tsx` — scanner/manual-code workflow.
- `apps/admin/tests/check-in-page.test.tsx` — scanner state and mutations.
- `e2e/check-in.spec.ts` — admitted student and administrator end-to-end flow.

**Modify**

- `packages/contracts/src/registration.ts` — profile update and student check-in response schemas.
- `packages/contracts/src/registration.ts` — administrator check-in schemas colocated with application contracts.
- `packages/contracts/src/contracts.test.ts` — contract acceptance/rejection cases.
- `apps/api/src/db/schema.ts` — Drizzle check-in tables and relations.
- `apps/api/src/config/env.ts`, `.env.example` — `CHECK_IN_TOKEN_SECRET` validation and documentation.
- `apps/api/src/app.ts`, `apps/api/src/server.ts` — wire check-in services and routes.
- `apps/api/src/modules/audit/audit-policy.ts` — allowlisted check-in audit actions and safe metadata.
- `apps/api/src/modules/registration/application.repository.ts` — profile update persistence without altering frozen versions.
- `apps/api/src/modules/registration/application.service.ts` and routes — validated profile update endpoint.
- `apps/web/package.json`, root `package-lock.json` — `qrcode.react`.
- `apps/web/src/api/application-client.ts` — profile and check-in client calls.
- `apps/web/src/pages/AccountPage.tsx` — sectioned account composition.
- `apps/web/src/features/account/ApplicationTimeline.tsx` — shared labels and polished timeline.
- `apps/web/src/styles/public.css` — account cards, rows, tabs, status flow, mobile layout.
- `apps/admin/package.json`, root `package-lock.json` — `@zxing/browser`.
- `apps/admin/src/api/admin-client.ts` — check-in lookup/confirm/revoke calls.
- `apps/admin/src/app/AdminApp.tsx`, `apps/admin/src/layout/AdminLayout.tsx` — route and navigation.
- `apps/admin/src/styles/admin.css` — check-in layout and responsive scanner styles.
- `docs/api.md`, `docs/content-model.md`, `docs/operations.md` — API, data, and event-day operation notes.

### Task 1: Shared contracts and database model

**Files:**
- Modify: `packages/contracts/src/registration.ts`
- Modify: `packages/contracts/src/registration.ts`
- Test: `packages/contracts/src/contracts.test.ts`
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0021_check_in.sql`

- [ ] **Step 1: Write failing contract tests**

Add assertions that student check-in data accepts `unavailable`, `available`, and `checked_in`, that no QR payload exists for unavailable status, and that administrator confirm/revoke bodies reject missing expected revision or an empty revoke reason.

```ts
expect(StudentCheckInResponseSchema.parse({
  apiVersion: 'v1',
  data: { availability: 'unavailable', reason: '录取后开放报到二维码' },
}).data.availability).toBe('unavailable')

expect(() => AdminCheckInRevokeRequestSchema.parse({ expectedRevision: 2, reason: ' ' })).toThrow()
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `npm test -w @panshi/contracts -- --run contracts.test.ts`

Expected: FAIL because the new schemas are not exported.

- [ ] **Step 3: Add exact contracts**

Define:

```ts
export const StudentProfileUpdateRequestSchema = ApplicationCoreFieldsSchema
  .omit({ phone: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项信息')

export const StudentCheckInResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.discriminatedUnion('availability', [
    z.object({ availability: z.literal('unavailable'), reason: z.string() }).strict(),
    z.object({ availability: z.literal('available'), qrPayload: z.string().min(32), displayCode: z.string().min(6), checkedInAt: z.null() }).strict(),
    z.object({ availability: z.literal('checked_in'), qrPayload: z.string().min(32), displayCode: z.string().min(6), checkedInAt: z.iso.datetime() }).strict(),
  ]),
}).strict()

export const AdminCheckInLookupRequestSchema = z.object({ code: z.string().trim().min(16).max(512) }).strict()
export const AdminCheckInConfirmRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict()
export const AdminCheckInRevokeRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), reason: z.string().trim().min(2).max(500) }).strict()
```

The lookup response exposes only name, phone, organization, training unit, admission status, check-in state, first confirmation metadata, and revision.

- [ ] **Step 4: Add database tables and migration**

Create `check_in_credentials` with unique `application_id`, random `public_id`, integer `revision`, `revoked_at`, timestamps; create `check_ins` with unique `application_id`, first confirmation fields, current validity, revocation fields, integer revision, and timestamps. Add checks requiring a reason and actor when revoked. Add indexes on `public_id`, `application_id`, and active state.

The QR credential is `publicId.signature`, where signature is HMAC-SHA256 over `panshi-check-in-v1:${publicId}`. PostgreSQL stores only the random public ID, not the signature or a PII-bearing payload.

- [ ] **Step 5: Run contract, type, and migration tests**

Run:

```bash
npm test -w @panshi/contracts -- --run contracts.test.ts
npm run typecheck -w @panshi/contracts
npm run test:integration:schema -w @panshi/api
```

Expected: all pass and the new tables satisfy schema checks.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src apps/api/src/db/schema.ts apps/api/drizzle/0021_check_in.sql
git commit -m "feat: define check-in contracts and schema"
```

### Task 2: Check-in service, API, and audit trail

**Files:**
- Create: `apps/api/src/modules/check-in/check-in.repository.ts`
- Create: `apps/api/src/modules/check-in/check-in.service.ts`
- Create: `apps/api/src/modules/check-in/check-in.routes.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`
- Modify: `apps/api/src/modules/audit/audit-policy.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/tests/check-in.test.ts`
- Test: `apps/api/tests/check-in.integration.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover admission-only issue, signature verification, invalid token non-enumeration, explicit confirm, duplicate confirm idempotency, reason-required revoke, re-confirm after revoke, and disabled administrator rejection.

```ts
await expect(service.getStudentCredential(student)).resolves.toMatchObject({ availability: 'available' })
await expect(service.confirm(admin, lookup.credentialId, { expectedRevision: 0 })).resolves.toMatchObject({ state: 'checked_in' })
await expect(service.confirm(admin, lookup.credentialId, { expectedRevision: 0 })).resolves.toMatchObject({ state: 'checked_in', duplicate: true })
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -w @panshi/api -- --run tests/check-in.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement repository transactions**

Implement repository methods to find admitted applications, create or load one credential, look up by public ID, insert first check-in atomically, return the existing row on unique conflict, revoke with revision matching, and reconfirm a revoked row with revision matching. Use a transaction and row lock for writes.

- [ ] **Step 4: Implement service credential signing and rules**

Use `createHmac` and `timingSafeEqual`. Never log the full credential. Reject invalid signatures with one generic `CHECK_IN_CODE_INVALID` response. Re-check `application.status === 'admitted'` during lookup and confirm. Use the existing audit service to record:

```ts
'check_in.confirmed'
'check_in.repeated_lookup'
'check_in.revoked'
'check_in.reconfirmed'
```

Audit metadata includes application ID, check-in record ID, revision, and reason only; it excludes phone and credential text.

- [ ] **Step 5: Add routes and runtime wiring**

Expose:

```text
GET  /api/v1/me/check-in
POST /api/v1/admin/check-in/lookup
POST /api/v1/admin/check-in/:id/confirm
POST /api/v1/admin/check-in/:id/revoke
```

Mount them under existing student/admin sessions and `private, no-store`. Validate `CHECK_IN_TOKEN_SECRET` as 64 hexadecimal characters and construct the service in `server.ts`.

- [ ] **Step 6: Run unit and integration tests**

Run:

```bash
npm test -w @panshi/api -- --run tests/check-in.test.ts
npm run test:integration:application -w @panshi/api
npm run typecheck -w @panshi/api
```

Expected: all new tests pass; any pre-existing stale-fixture failure is recorded separately and not masked.

- [ ] **Step 7: Commit**

```bash
git add .env.example apps/api/src/config/env.ts apps/api/src/modules/check-in apps/api/src/modules/audit/audit-policy.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/tests/check-in.test.ts apps/api/tests/check-in.integration.test.ts
git commit -m "feat: add secure check-in API"
```

### Task 3: Editable student profile API

**Files:**
- Modify: `apps/api/src/modules/registration/application.repository.ts`
- Modify: `apps/api/src/modules/registration/application.service.ts`
- Modify: `apps/api/src/modules/registration/application.routes.ts`
- Test: `apps/api/tests/application.test.ts`
- Test: `apps/api/tests/application.integration.test.ts`

- [ ] **Step 1: Write failing profile update tests**

Assert that a student can update non-phone core profile fields, that omitted fields remain unchanged, that `phone` is rejected, that updates do not mutate an existing `application_versions.snapshot`, and that the current application increments revision.

- [ ] **Step 2: Run the targeted tests and verify failure**

Run: `npm test -w @panshi/api -- --run tests/application.test.ts`

Expected: FAIL because `updateProfile` does not exist.

- [ ] **Step 3: Implement profile update**

Add `PATCH /api/v1/me/application/profile`. Parse the profile update contract, merge it with current `coreFields`, validate against the current form and UCAS training-unit rule, update only `applications.core_fields`, increment revision, and append a new `application_versions` row with reason `profile_updated`. Do not alter prior snapshots or the login phone.

- [ ] **Step 4: Verify profile behavior**

Run:

```bash
npm test -w @panshi/api -- --run tests/application.test.ts
npm run test:integration:application -w @panshi/api
```

Expected: targeted unit and integration cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/registration/application.repository.ts apps/api/src/modules/registration/application.service.ts apps/api/src/modules/registration/application.routes.ts apps/api/tests/application.test.ts apps/api/tests/application.integration.test.ts
git commit -m "feat: allow audited profile updates"
```

### Task 4: Student account center and QR panel

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Create: `apps/web/src/features/account/application-status.ts`
- Create: `apps/web/src/features/account/AccountNavigation.tsx`
- Create: `apps/web/src/features/account/ProfilePanel.tsx`
- Create: `apps/web/src/features/account/SecurityPanel.tsx`
- Create: `apps/web/src/features/account/CheckInPanel.tsx`
- Modify: `apps/web/src/features/account/ApplicationTimeline.tsx`
- Modify: `apps/web/src/api/application-client.ts`
- Modify: `apps/web/src/pages/AccountPage.tsx`
- Modify: `apps/web/src/styles/public.css`
- Create: `apps/web/tests/account-page.test.tsx`

- [ ] **Step 1: Add `qrcode.react`**

Run: `npm install qrcode.react -w @panshi/web`

Expected: dependency and lockfile update only.

- [ ] **Step 2: Write failing account page tests**

Test the three navigation items, one-row label/value presentation, `submitted` rendered as “待审核”, actual timeline entries, profile editing with phone disabled, unavailable QR for non-admitted users, and QR rendering for admitted users.

```ts
expect(await screen.findByText('待审核')).toBeVisible()
expect(screen.getByRole('button', { name: '编辑信息' })).toBeVisible()
expect(screen.getByRole('tab', { name: '报到二维码' })).toBeVisible()
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -w @panshi/web -- --run account-page.test.tsx`

Expected: FAIL because the components and check-in client do not exist.

- [ ] **Step 4: Implement shared status presentation**

Export one label map with `submitted: '待审核'` and a flow definition. Reuse it in profile summary and timeline. The timeline renders only returned history; the flow component renders possible stages without fake timestamps.

- [ ] **Step 5: Implement three account panels**

Compose `AccountPage` with tab-like navigation and accessible panels. `ProfilePanel` uses row wrappers containing `dt` and `dd` on the same line, with an edit button in the heading. `SecurityPanel` retains existing behavior in a styled vertical form. `CheckInPanel` fetches only when opened, renders `QRCodeSVG` for admitted users, and never displays a QR for unavailable state.

- [ ] **Step 6: Add restrained responsive styling**

Use a 180px desktop sidebar, compact 14–16px body typography, 44px minimum controls, thin borders, and mobile horizontal tabs. Ensure every label/value row aligns and wraps without overflow.

- [ ] **Step 7: Run web verification**

Run:

```bash
npm test -w @panshi/web
npm run typecheck -w @panshi/web
npm run build -w @panshi/web
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json package-lock.json apps/web/src/features/account/application-status.ts apps/web/src/features/account/AccountNavigation.tsx apps/web/src/features/account/ProfilePanel.tsx apps/web/src/features/account/SecurityPanel.tsx apps/web/src/features/account/CheckInPanel.tsx apps/web/src/features/account/ApplicationTimeline.tsx apps/web/src/api/application-client.ts apps/web/src/pages/AccountPage.tsx apps/web/src/styles/public.css apps/web/tests/account-page.test.tsx
git commit -m "feat: redesign student account center"
```

### Task 5: Administrator scanner and check-in controls

**Files:**
- Modify: `apps/admin/package.json`
- Modify: `package-lock.json`
- Modify: `apps/admin/src/api/admin-client.ts`
- Create: `apps/admin/src/pages/CheckInPage.tsx`
- Modify: `apps/admin/src/app/AdminApp.tsx`
- Modify: `apps/admin/src/layout/AdminLayout.tsx`
- Modify: `apps/admin/src/styles/admin.css`
- Create: `apps/admin/tests/check-in-page.test.tsx`

- [ ] **Step 1: Add scanner dependency**

Run: `npm install @zxing/browser -w @panshi/admin`

Expected: dependency and lockfile update only.

- [ ] **Step 2: Write failing administrator page tests**

Mock the scanner adapter and API client. Test manual lookup, invalid code, admitted/unreported result, explicit confirm, repeated-scan display, revoke modal with required reason, successful revoke, and permission-safe errors.

- [ ] **Step 3: Run test and verify failure**

Run: `npm test -w @panshi/admin -- --run check-in-page.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 4: Implement check-in client methods and page**

Add typed methods for lookup, confirm, and revoke. Build the page with start/stop camera controls, manual code input, a result card, status badge, and explicit actions. Do not automatically confirm after scan. Stop the camera on unmount and after a successful decode.

- [ ] **Step 5: Add navigation and responsive styling**

Register `/check-in` and add “现场报到” to the existing admin navigation. Keep the scanner viewport bounded and present the result card below it on narrow screens.

- [ ] **Step 6: Run admin verification**

Run:

```bash
npm test -w @panshi/admin
npm run typecheck -w @panshi/admin
npm run build -w @panshi/admin
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/package.json package-lock.json apps/admin/src/api/admin-client.ts apps/admin/src/pages/CheckInPage.tsx apps/admin/src/app/AdminApp.tsx apps/admin/src/layout/AdminLayout.tsx apps/admin/src/styles/admin.css apps/admin/tests/check-in-page.test.tsx
git commit -m "feat: add administrator check-in console"
```

### Task 6: Documentation, end-to-end verification, and visual acceptance

**Files:**
- Modify: `docs/api.md`
- Modify: `docs/content-model.md`
- Modify: `docs/operations.md`
- Create: `e2e/check-in.spec.ts`

- [ ] **Step 1: Document data and event-day operation**

Describe the student/administrator endpoints, no-store policy, HMAC credential configuration, one-record idempotency, revoke reason requirement, and operator steps for camera failure and repeated scan.

- [ ] **Step 2: Add an end-to-end check-in scenario**

Create one student, submit and admit the application through the admin API, verify the student QR panel becomes available, look up the code as an administrator, confirm once, verify a repeated lookup returns the original time, revoke with a reason, and confirm again.

- [ ] **Step 3: Run focused and full static verification**

Run:

```bash
npm run typecheck
npm run lint
npm run build
npm test -w @panshi/contracts
npm test -w @panshi/api
npm test -w @panshi/web
npm test -w @panshi/admin
```

Expected: new feature checks pass. Existing baseline failures unrelated to touched files are reported with exact test names and are not described as feature failures.

- [ ] **Step 4: Run database and browser verification**

Apply migration to the local preview database, restart the API, and verify:

```text
GET /healthz -> 200
GET /api/v1/me/check-in as non-admitted -> unavailable
GET /api/v1/me/check-in as admitted -> available or checked_in
POST /api/v1/admin/check-in/lookup -> admitted profile result
POST confirm twice -> one record, same first confirmation time
POST revoke without reason -> 400/422
POST revoke with reason -> revoked
```

Open desktop and mobile widths for `/account` and admin `/check-in`. Confirm row alignment, tabs, status labels, no QR before admission, QR after admission, manual lookup, confirm, repeated scan, revoke, and refreshed persistence.

- [ ] **Step 5: Commit documentation and end-to-end coverage**

```bash
git add docs/api.md docs/content-model.md docs/operations.md e2e/check-in.spec.ts
git commit -m "test: cover admission check-in journey"
```

### Task 7: Final audit

**Files:**
- Review only: all files changed by Tasks 1–6

- [ ] **Step 1: Check scope and secrets**

Verify no QR credential, check-in secret, phone number, password, cookie, or local path is committed to fixtures, logs, screenshots, or audit metadata.

- [ ] **Step 2: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: no whitespace errors; unrelated pre-existing files remain untouched by feature commits.

- [ ] **Step 3: Record verification evidence**

Update this plan’s checkboxes and provide a final handoff separating contract/schema, API, frontend, admin, database, automated tests, and visual-browser evidence.
