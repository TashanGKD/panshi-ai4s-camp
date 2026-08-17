# Registration Profile and AI4S Problem Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat registration profile and free-text AI background/problem fields with the approved conditional identity form, three-level proficiency matrix, optional experience field, and 19-item AI4S problem pool.

**Architecture:** Preserve the existing applications JSONB, account, draft, attachment, submission, and review architecture. Extend the shared contract with backward-compatible profile-detail fields, a generic proficiency-matrix question, option descriptions, and multiple-choice cardinality; publish a new immutable authoritative form version and render it through the decoupled Web/Admin clients.

**Tech Stack:** React 19, TypeScript, Express, Zod, Drizzle/PostgreSQL JSONB, Vitest, Testing Library, Playwright.

---

## File structure

- `packages/contracts/src/registration.ts`: shared profile, question, validation, and answer schemas.
- `apps/api/src/db/seeds/authoritative-problem-pool.ts`: stable IDs, approved titles, academic descriptions, and optional internal metadata for all 19 problems.
- `apps/api/src/db/seeds/authoritative-registration-form.ts`: authoritative published question order and configuration.
- `apps/api/src/modules/registration/application.service.ts`: conditional profile, proficiency, and 1–3 problem validation.
- `apps/api/src/modules/registration/application.repository.ts`: blank-name creation, legacy draft normalization, and legacy user-profile persistence.
- `apps/web/src/features/registration/CoreFields.tsx`: identity-first conditional fixed fields.
- `apps/web/src/features/registration/DynamicQuestion.tsx`: proficiency matrix and expandable problem descriptions.
- `apps/web/src/features/registration/ApplicationForm.tsx`: answer defaults and profile normalization wiring.
- `apps/admin/src/pages/RegistrationFormPage.tsx`: matrix/options/cardinality editor and preview.
- `apps/admin/src/pages/ApplicationReviewPage.tsx`: readable profile and structured-answer output.

### Task 1: Extend shared registration contracts

**Files:**
- Modify: `packages/contracts/src/registration.ts`
- Modify: `packages/contracts/src/registration-form.test.ts`
- Modify: `packages/contracts/src/contracts.test.ts`

- [ ] **Step 1: Add failing contract tests**

Add tests that require:

```ts
expect(ApplicationCoreFieldsSchema.parse(legacyProfile)).toMatchObject({
  jobPosition: '', professionalTitleLevel: '', specificTitle: '',
  major: '', researchInterest: '', researchDirection: '',
  postdocStation: '', disciplineField: '', supervisor: '', identityDescription: '',
})
expect(RegistrationDynamicQuestionSchema.parse(problemQuestion).validation).toEqual({ minSelections: 1, maxSelections: 3 })
expect(RegistrationDynamicQuestionSchema.parse(proficiencyQuestion).type).toBe('proficiency_matrix')
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -w @panshi/contracts -- --run src/registration-form.test.ts src/contracts.test.ts`

Expected: failures for unknown profile fields, unknown matrix type, option descriptions, or unsupported selection limits.

- [ ] **Step 3: Add the shared types**

Extend profile values with default-empty strings:

```ts
const OptionalProfileValueSchema = z.string().trim().max(2_000).default('')
// major, researchInterest, researchDirection, postdocStation, disciplineField,
// supervisor, jobPosition, professionalTitleLevel, specificTitle, identityDescription
```

Export six canonical identity values and three proficiency levels. Extend choice options with `description?: string`; extend choice validation with `minSelections` and `maxSelections`. Add `proficiency_matrix` with stable `items`, three `levels`, `allowOther: true`, and an answer object `{ ratings, otherLabel, otherLevel }`.

- [ ] **Step 4: Run the contract tests and verify GREEN**

Run: `npm test -w @panshi/contracts -- --run src/registration-form.test.ts src/contracts.test.ts`

Expected: all selected contract tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/registration.ts packages/contracts/src/registration-form.test.ts packages/contracts/src/contracts.test.ts
git commit -m "feat: extend registration form contracts"
```

### Task 2: Publish the approved proficiency question and 19-item problem pool

**Files:**
- Create: `apps/api/src/db/seeds/authoritative-problem-pool.ts`
- Modify: `apps/api/src/db/seeds/authoritative-registration-form.ts`
- Modify: `apps/api/tests/authoritative-registration-form.test.ts`

- [ ] **Step 1: Add failing authoritative-content tests**

Assert that the form contains one `proficiency_matrix`, that project experience is optional, and that the problem question has exactly 19 uniquely identified options with `minSelections: 1`, `maxSelections: 3`. Assert exact industry titles:

```ts
expect(problem.options.slice(8, 11).map(({ label }) => label)).toEqual([
  '（产业赛题）数据共情者——面向消费者需求理解的 AI 管家',
  '（产业赛题）信任守护师——面向美妆内容真实性识别的 AI 卫士',
  '（产业赛题）无界体验家——人工智能驱动的未来美妆体验',
])
expect(problem.options.every(({ description }) => Boolean(description?.trim()))).toBe(true)
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -w @panshi/api -- --run tests/authoritative-registration-form.test.ts`

Expected: current free-text questions and missing problem options fail the assertions.

- [ ] **Step 3: Add the authoritative problem source**

Create 19 stable entries in the exact order and with the exact title/description text frozen in `docs/superpowers/specs/2026-08-18-registration-profile-and-problem-pool-design.md` section five. Keep proposer names out of public option objects. Store the three Tianchi links only as internal `sourceUrl` metadata.

- [ ] **Step 4: Replace the two free-text questions**

Configure:

```ts
{
  id: '71000000-0000-4000-8000-000000000001',
  type: 'proficiency_matrix',
  label: '编程、数据分析和人工智能基础',
  required: true,
  items: ['Python', 'C/C++', 'R', 'MATLAB', 'SQL/数据库', 'Linux/Shell', 'Git/版本控制', '数据分析与可视化', '机器学习/深度学习', '大语言模型', '智能体开发'],
  levels: ['不了解', '了解并会简单使用', '熟练使用并掌握相关原理'],
  allowOther: true,
}
```

Make “已有科研、竞赛、工程或项目经历” optional. Replace the old free-text problem question with a required 19-option multiple choice using `{ minSelections: 1, maxSelections: 3 }`, followed by an optional long-text self-proposed problem.

- [ ] **Step 5: Run the authoritative-form test and verify GREEN**

Run: `npm test -w @panshi/api -- --run tests/authoritative-registration-form.test.ts`

Expected: all assertions pass and `RegistrationFormSchema.parse` succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/seeds/authoritative-problem-pool.ts apps/api/src/db/seeds/authoritative-registration-form.ts apps/api/tests/authoritative-registration-form.test.ts
git commit -m "feat: publish AI4S registration problem pool"
```

### Task 3: Enforce conditional profile and structured-answer validation

**Files:**
- Modify: `apps/api/src/modules/registration/application.service.ts`
- Modify: `apps/api/src/modules/registration/application.repository.ts`
- Modify: `apps/api/tests/application.test.ts`

- [ ] **Step 1: Add failing service/repository tests**

Cover blank new names, clearing only the exact legacy placeholder `实训营学员`, six identity branches, UCAS training-unit validation for student identities, complete fixed-skill ratings, optional “其他”, 1–3 problem choices, and rejection of four choices.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -w @panshi/api -- --run tests/application.test.ts`

Expected: failures for placeholder name, flat profile validation, matrix answers, and cardinality.

- [ ] **Step 3: Normalize profile storage**

Keep phone read-only. Compute legacy compatibility values before save:

```ts
educationStage = {
  本科生: '本科生', 硕士研究生: '硕士研究生', 博士研究生: '博士研究生',
  在站博士后: '博士后', 在职人员: '已毕业／在职', 其他: '其他',
}[identityType]
majorResearchDirection = [major, researchInterest, researchDirection, disciplineField].filter(Boolean).join('；')
```

Persist new detail fields in `applications.core_fields`; keep `user_profiles` writes limited to its existing seven columns.

- [ ] **Step 4: Add conditional validation**

Require only the fields named in the approved design for the selected identity. Validate UCAS units only for undergraduate/master/doctoral applicants who choose 中国科学院大学. Validate matrix item and level IDs, and enforce multiple-choice minimum/maximum values from the published form.

- [ ] **Step 5: Run API tests and verify GREEN**

Run: `npm test -w @panshi/api -- --run tests/application.test.ts tests/authoritative-registration-form.test.ts`

Expected: all selected API tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/registration/application.service.ts apps/api/src/modules/registration/application.repository.ts apps/api/tests/application.test.ts
git commit -m "feat: validate conditional registration profiles"
```

### Task 4: Render the identity-first Web form and structured questions

**Files:**
- Modify: `apps/web/src/features/registration/CoreFields.tsx`
- Modify: `apps/web/src/features/registration/DynamicQuestion.tsx`
- Modify: `apps/web/src/features/registration/ApplicationForm.tsx`
- Modify: `apps/web/src/styles/public.css`
- Modify: `apps/web/tests/registration-components.test.tsx`
- Modify: `apps/web/tests/registration-page-navigation.test.tsx`

- [ ] **Step 1: Add failing Web tests**

Test that identity is selected before unit fields; students receive searchable schools and education-specific fields; postdocs, employed applicants, and “其他” receive only their approved fields; name starts blank; the matrix exposes three radios per fixed skill and a text-based “其他”; problem cards expose descriptions and prevent selecting more than three.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -w @panshi/web -- --run tests/registration-components.test.tsx tests/registration-page-navigation.test.tsx`

Expected: current flat fields and generic dynamic renderer fail.

- [ ] **Step 3: Implement conditional core fields**

Render order: name, phone, email, current identity, then identity-specific unit/profile fields. Reuse the existing searchable university and UCAS selectors only for student branches. Do not render `educationStage` or `majorResearchDirection` as separate controls; keep them synchronized as compatibility fields.

- [ ] **Step 4: Implement the structured dynamic controls**

Render proficiency rows with three radio choices; show an optional custom skill name and its level. Render problem choices as cards with checkbox, title, and `<details><summary>查看简介</summary>…</details>`. Disable unchecked options after three selections while allowing selected options to be removed.

- [ ] **Step 5: Add responsive styling**

Use the existing form typography and spacing. On narrow screens stack matrix labels and level controls vertically; problem descriptions remain readable without hover.

- [ ] **Step 6: Run Web tests and verify GREEN**

Run: `npm test -w @panshi/web -- --run tests/registration-components.test.tsx tests/registration-page-navigation.test.tsx`

Expected: all selected Web tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/registration/CoreFields.tsx apps/web/src/features/registration/DynamicQuestion.tsx apps/web/src/features/registration/ApplicationForm.tsx apps/web/src/styles/public.css apps/web/tests/registration-components.test.tsx apps/web/tests/registration-page-navigation.test.tsx
git commit -m "feat: render conditional camp application form"
```

### Task 5: Keep administration and exports readable

**Files:**
- Modify: `apps/admin/src/pages/RegistrationFormPage.tsx`
- Modify: `apps/admin/src/pages/ApplicationReviewPage.tsx`
- Modify: `apps/admin/tests/registration-form-page.test.tsx`
- Modify: `apps/admin/tests/application-review-page.test.tsx`
- Modify: `apps/api/src/modules/registration/review.service.ts`
- Modify: `apps/api/src/modules/registration/review.repository.ts`
- Modify: `apps/api/tests/review.test.ts`

- [ ] **Step 1: Add failing admin/review tests**

Require matrix preview/editor support, option descriptions, multiple-choice limits, Chinese profile labels, readable proficiency rows, problem titles instead of raw values, and all new profile fields in supplement permissions.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -w @panshi/admin -- --run tests/registration-form-page.test.tsx tests/application-review-page.test.tsx`

Run: `npm test -w @panshi/api -- --run tests/review.test.ts`

Expected: current editors and review formatter do not recognize the new structures.

- [ ] **Step 3: Implement admin editing and review formatting**

Add matrix item/level editors, option-description textareas, min/max selection controls, Chinese profile-label mapping, and structured answer formatting. Keep proposer metadata absent from the public form editor and application review.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run the same Admin and API commands from Step 2.

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/RegistrationFormPage.tsx apps/admin/src/pages/ApplicationReviewPage.tsx apps/admin/tests/registration-form-page.test.tsx apps/admin/tests/application-review-page.test.tsx apps/api/src/modules/registration/review.service.ts apps/api/src/modules/registration/review.repository.ts apps/api/tests/review.test.ts
git commit -m "feat: support structured registration review"
```

### Task 6: Publish locally and verify the complete path

**Files:**
- Modify: `e2e/application-submit.spec.ts`
- Modify: `content-source/README.md`

- [ ] **Step 1: Extend the browser path**

Register/login with mock code `123456`, verify blank name, complete a student application, rate all fixed skills, choose exactly three problems, add a self-proposed problem, save/reload, and submit. Add a second path for an employed applicant with position and optional title.

- [ ] **Step 2: Run static and test verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0. Report any pre-existing unrelated lint debt separately; this workspace does not define a Web lint script.

- [ ] **Step 3: Publish the new form version locally**

Use the existing local admin UUID for `CONTENT_SEED_CREATOR_USER_ID`, run the authoritative registration seed, restart API/Web if needed, and require `GET /api/v1/public/registration-form` and `GET /api/v1/applications/me` to return 200.

- [ ] **Step 4: Run E2E and visual acceptance**

Run the application E2E against the local PostgreSQL preview. Inspect desktop and mobile layouts, identity switches, UCAS search, matrix wrapping, problem description expansion, 1–3 selection behavior, save/reload, and post-submit lock.

- [ ] **Step 5: Record the result**

Update `content-source/README.md` with the form version, the frozen specification path, seed command, test results, and any remaining baseline issues.

- [ ] **Step 6: Commit**

```bash
git add e2e/application-submit.spec.ts content-source/README.md
git commit -m "test: verify complete camp registration flow"
```
