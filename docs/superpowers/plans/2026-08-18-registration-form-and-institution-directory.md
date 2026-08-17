# Registration Form and Institution Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the source-aligned camp registration form and add searchable university/UCAS training-unit selectors while preserving the existing account, draft, submission, attachment, review, and export workflows.

**Architecture:** Keep application persistence backward-compatible by storing canonical organization and department strings. Add a versioned institution catalog in the API, expose it through a public read-only endpoint, and render it through an accessible frontend combobox. Publish the official dynamic questions as a new immutable registration-form version.

**Tech Stack:** React 19, TypeScript, Express, Zod, Drizzle/PostgreSQL, Vitest, Testing Library, Playwright.

---

### Task 1: Versioned official institution catalog

**Files:**
- Create: `apps/api/src/data/institutions/universities-2025.json`
- Create: `apps/api/src/data/institutions/ucas-training-units-2026.json`
- Create: `apps/api/src/modules/institutions/institution.service.ts`
- Create: `apps/api/src/modules/institutions/institution.routes.ts`
- Modify: `packages/contracts/src/registration.ts`
- Modify: `apps/api/src/app.ts`
- Test: `packages/contracts/src/registration-form.test.ts`
- Test: `apps/api/tests/institution.routes.test.ts`

- [ ] Add a failing contract test that rejects duplicate/empty institution names and accepts a response with `version`, `sources`, `universities`, and `ucasTrainingUnits`.
- [ ] Run `npm test -w @panshi/contracts -- --run src/registration-form.test.ts` and verify RED.
- [ ] Add `InstitutionDirectoryResponseSchema` and exported types.
- [ ] Import the official 2919-school Ministry list and the official UCAS training-unit list into normalized JSON with source metadata.
- [ ] Add a failing route test for `GET /api/v1/public/institutions`.
- [ ] Run `npm test -w @panshi/api -- --run tests/institution.routes.test.ts` and verify RED.
- [ ] Implement the read-only service/router and mount it at `/api/v1/public/institutions`.
- [ ] Re-run both targeted test files and verify GREEN.

### Task 2: Source-aligned published registration form

**Files:**
- Create: `apps/api/src/db/seeds/authoritative-registration-form.ts`
- Modify: `apps/api/src/db/seeds/initial-content.ts` only if a shared seed runner is required
- Modify: `apps/api/package.json`
- Test: `apps/api/tests/registration-form.test.ts`
- Test: `apps/api/tests/application.test.ts`

- [ ] Add a failing test asserting the nine V1.3 questions, stable UUIDs, required flags, course-topic choices, participation choices, and optional PDF/DOCX attachment.
- [ ] Run `npm test -w @panshi/api -- --run tests/registration-form.test.ts` and verify RED.
- [ ] Define `AUTHORITATIVE_REGISTRATION_FORM` with exact labels/help text and a safe seed that creates an immutable version and publishes only over an untouched/default draft.
- [ ] Add a failing application-service test requiring a valid UCAS training unit when organization is 中国科学院大学.
- [ ] Implement submission validation using the same authoritative directory service.
- [ ] Run the targeted form/application tests and verify GREEN.

### Task 3: Accessible searchable selectors

**Files:**
- Create: `apps/web/src/features/registration/SearchableSelect.tsx`
- Create: `apps/web/src/api/institution-client.ts`
- Modify: `apps/web/src/features/registration/CoreFields.tsx`
- Modify: `apps/web/src/features/registration/ApplicationForm.tsx`
- Modify: `apps/web/src/pages/RegistrationPage.tsx`
- Modify: `apps/web/src/styles/public.css`
- Test: `apps/web/tests/institution-select.test.tsx`
- Test: `apps/web/tests/application-form.test.tsx`

- [ ] Add failing tests for search filtering, keyboard selection, “其他单位”, UCAS conditional training-unit display, and saved-draft rehydration.
- [ ] Run `npm test -w @panshi/web -- --run tests/institution-select.test.tsx tests/application-form.test.tsx` and verify RED.
- [ ] Implement an ARIA combobox/listbox with a 50-result display limit and full-catalog filtering.
- [ ] Load the directory in `RegistrationPage`; show a blocking error if unavailable.
- [ ] Render identity type and education stage as controlled selects; render organization/department according to the confirmed rules.
- [ ] Add responsive styles matching the public site.
- [ ] Re-run targeted tests and verify GREEN.

### Task 4: Admin detail and export verification

**Files:**
- Modify: `apps/admin/src/pages/ApplicationReviewPage.tsx` only if labels require adjustment
- Modify: `apps/api/src/modules/registration/review.service.ts` only if export labels require adjustment
- Test: `apps/admin/tests/application-review-page.test.tsx`
- Test: `apps/api/tests/review.test.ts`

- [ ] Add failing tests that show the canonical university and UCAS training unit in review details and CSV output.
- [ ] Run targeted admin/API tests and verify RED only if current behavior is insufficient.
- [ ] Make the minimal label/export changes required.
- [ ] Re-run targeted tests and verify GREEN.

### Task 5: Local publication and end-to-end acceptance

**Files:**
- Modify: `e2e/application-submit.spec.ts`
- Modify: `content-source/README.md`

- [ ] Add an E2E path: register/login with mock code `123456`, search and select 中国科学院大学, select 中国科学院物理研究所, complete required questions, save, reload, upload optional attachment, submit, and verify read-only state/admin visibility.
- [ ] Migrate the local preview database, publish the authoritative form, and restart services if required.
- [ ] Run `npm run typecheck`, targeted tests, workspace tests, and `npm run build`.
- [ ] Run the application E2E against the local PostgreSQL preview database.
- [ ] Inspect desktop and mobile registration pages in the browser, including keyboard search, long dropdown names, validation errors, and post-submit lock.
- [ ] Record catalog source/version and local verification results in `content-source/README.md`.

