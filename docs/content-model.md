# Content model

## Registration form

Every published form has exactly eight fixed, required core fields. Their order and labels are contractual; only the phone is read-only because it comes from the authenticated account.

| Key | Public label | Editable by student |
| --- | --- | --- |
| `name` | 姓名 | Yes |
| `phone` | 手机号 | No |
| `email` | 电子邮箱 | Yes |
| `organization` | 所在单位 | Yes |
| `department` | 院系/部门 | Yes |
| `identityType` | 身份类型 | Yes |
| `educationStage` | 学历阶段 | Yes |
| `majorResearchDirection` | 专业及研究方向 | Yes |

Administrators may add up to 50 active/inactive dynamic questions. Each has a stable UUID, label, help text, required flag, normalized zero-based order, and type `short_text`, `long_text`, `single_choice`, or `multiple_choice`. Text questions may set minimum/maximum lengths; choice questions use stable UUID options and stored values. Up to ten attachment requirements may be configured with stable UUIDs, PDF/DOCX allowlists, required flags, size limits, and normalized order. An application stores answers by question UUID and attachment links by slot UUID, and remains bound to the form version with which it was created.

## Page content modules

| Module key | Administrator fields | Public consumers |
| --- | --- | --- |
| `basic` | title, start/end/label, venue, tagline, intro paragraphs, target | site banner, home, shared page shell |
| `features` | ordered title/description items | home feature cards, module preview |
| `organizations` | ordered role/name items | home organization cards, module preview |
| `importantDates` | label/value and optional machine key | home dates; registration open/deadline rules |
| `schedule` | days, themes, sessions, times/details, speakers and references | `/schedule` |
| `contacts` | contact people, responsibility, phone/email methods, consultation note | `/contact`, site aggregate |
| `travel` | ordered title/body sections | `/travel` |
| `display` | series, footer, count visibility, optional navigation and home-section order | shared banner/navigation/footer, home ordering, count visibility |

`GET /api/v1/public/site` aggregates published `basic`, `importantDates`, `contacts`, and `display`. Schedule has its own published endpoint. Other public pages read their module endpoint. The admin SPA edits structured fields only; it has no arbitrary JSON editor. Rich text fields are allowlist-sanitized before persistence and rendering.

## Drafts and published revisions

Each content module owns one mutable draft, a monotonically increasing draft revision, and a pointer to an immutable published version. Saves require the last-read `expectedRevision`. Publish validates the complete payload, creates a numbered version, and moves the pointer atomically. Rollback does not mutate history: it validates an old payload under current rules and copies it into a new version. Protected preview reads the draft but renders through the public components. The registration form follows the same revision/publish principle with separate form draft/version tables.

The source-of-truth publishing rule is: edit the structured admin draft, preview it, publish it, and let public APIs consume the published pointer. Direct database edits, static frontend copies, and changes to historical versions are not publishing mechanisms.

## Applications and reviews

Applications contain fixed `coreFields`, UUID-keyed dynamic `answers`, one file link per configured attachment slot, status, revision, and submission timestamps. Statuses are `draft`, `submitted`, `reviewing`, `needs_supplement`, `admitted`, `waitlisted`, and `rejected`. Submission and resubmission create immutable snapshots and timeline entries. Supplement requests carry a student-visible message/deadline plus exact editable field and attachment IDs; all other submitted values remain read-only.

## Resources and registration count

Resources have a stable key, title, optional description, sort order, file reference, draft/published state, and access scope:

- `public`: visible and downloadable without a session.
- `authenticated`: any active student or administrator session.
- `admitted`: admitted students and administrators only.

Authorization is applied to both listing and download. Hidden, deleted, draft, missing, and unauthorized resource objects are not exposed. Registration count visibility is controlled only by the published `display.showRegistrationCount`. When disabled, the public response contains neither count nor update timestamp. When enabled, the count represents submitted applications according to the statistics repository, not draft accounts or page views.

## Sensitive fields

Never expose password hashes, session tokens or token hashes, verification-code hashes, HMAC secrets, physical storage keys/roots, deletion recovery details, internal review notes, audit metadata intended only for administrators, database URLs, backup credentials, or stack traces. Public application/status responses may include only the student's own profile, answers, safe attachment metadata/download endpoint, public supplement message, and public timeline reason. Original filenames are shown only to the owning student or an authorized administrator and are never used as storage paths.

The normalized public home contract combines the published `basic`, `features`, `organizations`, `schedule`, and `display` modules. `display.visibleNavigation` accepts only the fixed keys `home`, `schedule`, `register`, `travel`, `contacts`, `resources`, and `account`; the API always emits them in this safe canonical order. `display.homeSectionOrder` may order `intro`, `target`, `scale`, `features`, `scheduleOverview`, `organizations`, `registrationCta`, and `registrationCount` without duplicates. The schedule overview is derived from the first six structured schedule days so the reporting day and all five camp days remain visible, and the CTA route is fixed to `/application`. Older revisions without these fields use conservative defaults rather than a second hard-coded content record.
