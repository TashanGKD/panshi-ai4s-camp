import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { DEFAULT_REGISTRATION_FORM, type ApplicationCoreFields, type JsonObject, type RegistrationForm } from '@panshi/contracts'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { applications, applicationFiles, applicationVersions, auditLogs, contentModules, contentVersions, files, registrationFormDrafts, registrationFormVersions, smsNotificationOutbox, users } from '../src/db/schema.js'
import { createApplicationRepository } from '../src/modules/registration/application.repository.js'
import { createApplicationService } from '../src/modules/registration/application.service.js'
import { createFileRepository } from '../src/modules/files/file.repository.js'
import { createFileService } from '../src/modules/files/file.service.js'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).pathname !== '/panshi_ai4s_camp_test') throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
const database = createDatabaseClient(url)
const student = { id: '10000000-0000-4000-8000-000000000001', displayName: '张三', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const other = { ...student, id: '10000000-0000-4000-8000-000000000002', phoneNormalized: '+8613900139000' }
const admin = { ...student, id: '10000000-0000-4000-8000-000000000003', phoneNormalized: '+8613700137000', role: 'admin' as const }
const questionId = '20000000-0000-4000-8000-000000000001'
const slotId = '20000000-0000-4000-8000-000000000002'
const newQuestionId = '20000000-0000-4000-8000-000000000003'
const form: RegistrationForm = { ...DEFAULT_REGISTRATION_FORM, questions: [{ id: questionId, type: 'short_text', label: '研究问题', helpText: '', required: true, order: 0, active: true, validation: { minLength: 2, maxLength: 30 } }], attachments: [{ id: slotId, label: '简历', helpText: '', required: true, order: 0, active: true, allowedExtensions: ['pdf'], maxSizeBytes: 1_000_000 }] }
const profile: Omit<ApplicationCoreFields, 'phone'> = {
  name: '张三', email: 'z@example.com', organization: '中国科学院物理研究所', department: '研究生部',
  identityType: '博士研究生', educationStage: '博士研究生', majorResearchDirection: '凝聚态物理', major: '物理学',
  researchInterest: '', researchDirection: '凝聚态物理', postdocStation: '', disciplineField: '', supervisor: '',
  jobPosition: '', professionalTitleLevel: '', specificTitle: '', identityDescription: '',
}

describe('application PostgreSQL workflow', () => {
  beforeAll(async () => { await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined }) })
  beforeEach(async () => {
    await database.pool.query('TRUNCATE application_files, application_status_history, application_versions, applications, files, user_profiles, registration_form_drafts, registration_form_versions, content_versions, content_modules, audit_logs, sessions, users CASCADE')
    await database.db.insert(users).values([student, other, admin])
    const [version] = await database.db.insert(registrationFormVersions).values({ version: 1, schema: form as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
    await database.db.insert(registrationFormDrafts).values({ id: '00000000-0000-4000-8000-000000000010', schema: form, baseVersionId: version!.id })
    await database.db.insert(contentModules).values({ key: 'importantDates', draft: {}, draftRevision: 0 })
    const [dates] = await database.db.insert(contentVersions).values({ moduleKey: 'importantDates', version: 1, payload: { items: [{ label: '开放', value: '2026-08-01', machineKey: 'registrationOpen' }, { label: '截止', value: '2026-08-31', machineKey: 'registrationDeadline' }] }, createdBy: admin.id }).returning({ id: contentVersions.id })
    await database.db.update(contentModules).set({ publishedVersionId: dates!.id }).where(eq(contentModules.key, 'importantDates'))
  })
  afterAll(async () => { await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await database.close() })

  const prepareSubmittableDraft = async () => {
    const repository = createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') })
    const service = createApplicationService(repository)
    let mine = await service.getMine(student)
    const [file] = await database.db.insert(files).values({
      storageKey: `aa/bb/${crypto.randomUUID()}`, originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 100,
      sha256: 'e'.repeat(64), uploadedBy: student.id, ownerUserId: student.id, purpose: 'registration_attachment',
      visibility: 'owner_admin', attachmentSlot: slotId,
    }).returning({ id: files.id })
    mine = await service.saveDraft(student, {
      expectedRevision: mine.data.application.revision, profile, answers: { [questionId]: '并发研究问题' },
      attachments: [{ slotId, fileId: file!.id }],
    })
    return { service, mine, file: file! }
  }

  const publishFormVersion = async (nextForm: RegistrationForm) => {
    const [published] = await database.db.insert(registrationFormVersions).values({
      version: 2, schema: nextForm as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date(),
    }).returning({ id: registrationFormVersions.id })
    await database.db.update(registrationFormDrafts).set({
      baseVersionId: published!.id, schema: nextForm,
    }).where(eq(registrationFormDrafts.id, '00000000-0000-4000-8000-000000000010'))
    return published!
  }

  const prepareDraftWithPdf = async (sizeBytes: number) => {
    const repository = createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') })
    const service = createApplicationService(repository)
    let mine = await service.getMine(student)
    const [file] = await database.db.insert(files).values({
      storageKey: `aa/bb/${crypto.randomUUID()}`, originalName: 'untrusted-name.docx', mimeType: 'application/pdf', sizeBytes,
      sha256: 'f'.repeat(64), uploadedBy: student.id, ownerUserId: student.id, purpose: 'registration_attachment',
      visibility: 'owner_admin', attachmentSlot: slotId,
    }).returning({ id: files.id })
    mine = await service.saveDraft(student, {
      expectedRevision: mine.data.application.revision, profile, answers: { [questionId]: '附件规则迁移测试' },
      attachments: [{ slotId, fileId: file!.id }],
    })
    return { repository, service, mine, file: file! }
  }

  const waitForBlockedTransactions = async (minimum: number) => {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      const result = await database.pool.query<{ count: string }>("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")
      if (Number(result.rows[0]?.count) >= minimum) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`Expected at least ${minimum} blocked PostgreSQL transactions`)
  }

  it('persists one optimistic draft and does not count it as submitted', async () => {
    const service = createApplicationService(createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') }))
    const initial = await service.getMine(student)
    await service.saveDraft(student, { expectedRevision: initial.data.application.revision, profile, answers: {}, attachments: [] })
    await expect(service.saveDraft(student, { expectedRevision: initial.data.application.revision, profile, answers: {}, attachments: [] })).rejects.toMatchObject({ code: 'APPLICATION_REVISION_CONFLICT' })
    const counts = await database.db.select({ count: sql<number>`count(*)` }).from(applications).where(eq(applications.status, 'submitted'))
    expect(Number(counts[0]?.count)).toBe(0)
    await expect(database.db.insert(applications).values({ userId: student.id, formVersionId: initial.data.application.formVersionId })).rejects.toThrow()
  })

  it.each([
    ['开放日前一秒', '2026-07-31T15:59:59.999Z', false, 'REGISTRATION_NOT_OPEN'],
    ['开放日北京时间 00:00', '2026-07-31T16:00:00.000Z', true, undefined],
    ['开放日北京时间 07:59', '2026-07-31T23:59:00.000Z', true, undefined],
    ['开放日北京时间 08:00', '2026-08-01T00:00:00.000Z', true, undefined],
    ['截止日北京时间 00:00', '2026-08-30T16:00:00.000Z', true, undefined],
    ['截止日北京时间 07:59', '2026-08-30T23:59:00.000Z', true, undefined],
    ['截止日北京时间 08:00', '2026-08-31T00:00:00.000Z', true, undefined],
    ['截止日北京时间 23:59', '2026-08-31T15:59:59.999Z', true, undefined],
    ['截止日后北京时间 00:00', '2026-08-31T16:00:00.000Z', false, 'REGISTRATION_CLOSED'],
  ] as const)('uses the inclusive Asia/Shanghai business date at %s', async (_label, instant, open, reason) => {
    const repository = createApplicationRepository(database.db, { now: () => new Date(instant) })
    await expect(repository.registrationWindow()).resolves.toEqual(reason === undefined ? { open } : { open, reason })
  })

  it('rejects missing required data and inactive or foreign attachments at submit time', async () => {
    const service = createApplicationService(createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') }))
    let mine = await service.getMine(student)
    mine = await service.saveDraft(student, { expectedRevision: mine.data.application.revision, profile, answers: { [questionId]: '问题' }, attachments: [] })
    await expect(service.submit(student, { expectedRevision: mine.data.application.revision })).rejects.toMatchObject({ code: 'APPLICATION_INCOMPLETE' })
    const [foreignFile] = await database.db.insert(files).values({ storageKey: 'aa/bb/foreign', originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'a'.repeat(64), uploadedBy: other.id, ownerUserId: other.id, purpose: 'registration_attachment', visibility: 'owner_admin', attachmentSlot: slotId }).returning({ id: files.id })
    await expect(service.saveDraft(student, { expectedRevision: mine.data.application.revision, profile, answers: { [questionId]: '问题' }, attachments: [{ slotId, fileId: foreignFile!.id }] })).rejects.toThrow()
    const [ownFile] = await database.db.insert(files).values({ storageKey: 'aa/bb/own', originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'b'.repeat(64), uploadedBy: student.id, ownerUserId: student.id, purpose: 'registration_attachment', visibility: 'owner_admin', attachmentSlot: slotId }).returning({ id: files.id })
    mine = await service.saveDraft(student, { expectedRevision: mine.data.application.revision, profile, answers: { [questionId]: '问题' }, attachments: [{ slotId, fileId: ownFile!.id }] })
    await database.db.update(files).set({ hiddenAt: new Date() }).where(eq(files.id, ownFile!.id))
    await expect(service.submit(student, { expectedRevision: mine.data.application.revision })).rejects.toMatchObject({ code: 'APPLICATION_INCOMPLETE' })
  })

  it('submits atomically, locks changes, keeps the v1 snapshot after v2 publication, and audits no answers or filenames', async () => {
    const service = createApplicationService(createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') }))
    let mine = await service.getMine(student)
    const [file] = await database.db.insert(files).values({ storageKey: 'aa/bb/valid', originalName: 'private-name.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'c'.repeat(64), uploadedBy: student.id, ownerUserId: student.id, purpose: 'registration_attachment', visibility: 'owner_admin', attachmentSlot: slotId }).returning({ id: files.id })
    mine = await service.saveDraft(student, { expectedRevision: mine.data.application.revision, profile, answers: { [questionId]: '绝密研究问题' }, attachments: [{ slotId, fileId: file!.id }] })
    const submitted = await service.submit(student, { expectedRevision: mine.data.application.revision })
    await expect(service.saveDraft(student, { expectedRevision: mine.data.application.revision + 1, profile, answers: {}, attachments: [] })).rejects.toMatchObject({ code: 'APPLICATION_LOCKED' })
    const [snapshotBefore] = await database.db.select({ snapshot: applicationVersions.snapshot }).from(applicationVersions).where(eq(applicationVersions.id, submitted.data.versionId))
    expect(snapshotBefore?.snapshot).toMatchObject({ attachments: [{ fileId: file!.id, sha256: 'c'.repeat(64), validatedType: 'pdf' }] })
    const fileService = createFileService(createFileRepository(database.db), { createStorageKey: () => '', put: async () => { throw new Error('unused') }, open: async () => { throw new Error('unused') }, remove: async () => { throw new Error('submitted files must not reach storage removal') } })
    await expect(fileService.hide(file!.id, other)).rejects.toMatchObject({ code: 'FILE_NOT_AVAILABLE', status: 404 })
    await expect(fileService.remove(file!.id, other)).rejects.toMatchObject({ code: 'FILE_NOT_AVAILABLE', status: 404 })
    await expect(fileService.hide(file!.id, student)).rejects.toMatchObject({ code: 'FILE_LOCKED_BY_APPLICATION', status: 409 })
    await expect(fileService.remove(file!.id, student)).rejects.toMatchObject({ code: 'FILE_LOCKED_BY_APPLICATION', status: 409 })
    await database.db.update(files).set({
      originalName: 'changed.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 999, sha256: 'd'.repeat(64), lifecycleState: 'deleted', deletedAt: new Date(),
    }).where(eq(files.id, file!.id))
    const v2: RegistrationForm = { ...form, questions: [{ ...form.questions[0]!, label: '新版问题' }] }
    await database.db.insert(registrationFormVersions).values({ version: 2, schema: v2 as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date() })
    const [snapshotAfter] = await database.db.select({ snapshot: applicationVersions.snapshot }).from(applicationVersions).where(eq(applicationVersions.id, submitted.data.versionId))
    expect(snapshotAfter).toEqual(snapshotBefore)
    await expect(database.pool.query('UPDATE application_versions SET reason = $1 WHERE id = $2', ['tamper', submitted.data.versionId])).rejects.toThrow(/immutable/iu)
    const logs = JSON.stringify(await database.db.select().from(auditLogs))
    expect(logs).not.toContain('绝密研究问题'); expect(logs).not.toContain('private-name.pdf'); expect(logs).not.toContain('c'.repeat(64))
  })

  it('reopens a submitted application without losing data and records the resubmission as a new version', async () => {
    const { service, mine, file } = await prepareSubmittableDraft()
    await service.submit(student, { expectedRevision: mine.data.application.revision })
    const submitted = await service.getMine(student)

    const reopened = await service.reopen(student, { expectedRevision: submitted.data.application.revision })
    expect(reopened.data.application).toMatchObject({
      status: 'draft',
      profile: {
        name: profile.name,
        organization: profile.organization,
        department: profile.department,
        identityType: profile.identityType,
        major: profile.major,
        researchDirection: profile.researchDirection,
      },
      answers: { [questionId]: '并发研究问题' },
      attachments: [{ slotId, id: file.id }],
    })

    const saved = await service.saveDraft(student, {
      expectedRevision: reopened.data.application.revision,
      profile: { ...profile, majorResearchDirection: '凝聚态物理与人工智能' },
      answers: { [questionId]: '修改后的研究问题' },
      attachments: [{ slotId, fileId: file.id }],
    })
    await service.submit(student, { expectedRevision: saved.data.application.revision })
    const resubmitted = await service.getMine(student)
    expect(resubmitted.data.application).toMatchObject({ status: 'submitted', answers: { [questionId]: '修改后的研究问题' } })

    const versions = await database.db.select({ reason: applicationVersions.reason, snapshot: applicationVersions.snapshot })
      .from(applicationVersions).where(eq(applicationVersions.applicationId, resubmitted.data.application.id))
      .orderBy(applicationVersions.createdAt)
    expect(versions.map(({ reason }) => reason)).toEqual(['initial_submission', 'resubmission'])
    expect(versions[0]?.snapshot).toMatchObject({ answers: { [questionId]: '并发研究问题' } })
    expect(versions[1]?.snapshot).toMatchObject({ answers: { [questionId]: '修改后的研究问题' } })

    const notifications = await database.db.select().from(smsNotificationOutbox)
      .where(eq(smsNotificationOutbox.applicationId, resubmitted.data.application.id))
      .orderBy(smsNotificationOutbox.createdAt)
    expect(notifications).toHaveLength(2)
    expect(notifications.map(({ eventType }) => eventType)).toEqual([
      'application_submitted',
      'application_submitted',
    ])
    expect(new Set(notifications.map(({ eventKey }) => eventKey)).size).toBe(2)
  })

  it('rejects closed windows and disabled accounts', async () => {
    const closed = createApplicationService(createApplicationRepository(database.db, { now: () => new Date('2026-09-01T00:00:00Z') }))
    const mine = await closed.getMine(student)
    await expect(closed.submit(student, { expectedRevision: mine.data.application.revision })).rejects.toMatchObject({ code: 'REGISTRATION_CLOSED' })
    await expect(closed.getMine({ ...student, disabledAt: new Date() })).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' })
    await expect(closed.saveDraft({ ...student, disabledAt: new Date() }, { expectedRevision: mine.data.application.revision, profile, answers: {}, attachments: [] })).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' })
  })

  it('moves an unsubmitted draft to the latest form without silently dropping retired answers', async () => {
    const service = createApplicationService(createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') }))
    let mine = await service.getMine(student)
    mine = await service.saveDraft(student, { expectedRevision: mine.data.application.revision, profile, answers: { [questionId]: '保留的旧答案' }, attachments: [] })
    const v2: RegistrationForm = { ...form, questions: [] }
    const [published] = await database.db.insert(registrationFormVersions).values({ version: 2, schema: v2 as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
    await database.db.update(registrationFormDrafts).set({ baseVersionId: published!.id, schema: v2 }).where(eq(registrationFormDrafts.id, '00000000-0000-4000-8000-000000000010'))
    const migrated = await service.getMine(student)
    expect(migrated.data.application.formVersion).toBe(2)
    expect(migrated.data.application.answers[questionId]).toBe('保留的旧答案')
    expect(migrated.data.application.retiredAnswerIds).toEqual([questionId])
    expect(migrated.data.application.revision).toBe(mine.data.application.revision + 1)
  })

  it('migrates a draft before parsing a historical fixed-field definition', async () => {
    const historicalForm = {
      ...form,
      coreFields: form.coreFields.map((field) => field.key === 'email' ? { ...field, required: true } : field),
    }
    const [historical] = await database.db.insert(registrationFormVersions).values({
      version: 2, schema: historicalForm as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date(),
    }).returning({ id: registrationFormVersions.id })
    const [published] = await database.db.insert(registrationFormVersions).values({
      version: 3, schema: form as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date(),
    }).returning({ id: registrationFormVersions.id })
    await database.db.update(registrationFormDrafts).set({ baseVersionId: published!.id, schema: form })
      .where(eq(registrationFormDrafts.id, '00000000-0000-4000-8000-000000000010'))
    await database.db.insert(applications).values({
      userId: student.id,
      formVersionId: historical!.id,
      status: 'draft',
      revision: 0,
      coreFields: { ...profile, phone: student.phoneNormalized },
      answers: {},
    })
    const service = createApplicationService(createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') }))

    await expect(service.getMine(student)).resolves.toMatchObject({
      data: {
        application: {
          formVersionId: published!.id,
          formVersion: 3,
          revision: 1,
        },
      },
    })
  })

  it('preserves an inactive answer as retired history while saving and submitting a new required answer', async () => {
    const { service, file } = await prepareDraftWithPdf(100)
    const v2: RegistrationForm = {
      ...form,
      questions: [
        { ...form.questions[0]!, active: false, required: false },
        { id: newQuestionId, type: 'short_text', label: '新版必填问题', helpText: '', required: true, order: 1, active: true, validation: { minLength: 2, maxLength: 30 } },
      ],
    }
    await publishFormVersion(v2)
    const migrated = await service.getMine(student)
    expect(migrated.data.application.retiredAnswerIds).toEqual([questionId])

    const saved = await service.saveDraft(student, {
      expectedRevision: migrated.data.application.revision,
      profile,
      answers: { [newQuestionId]: '新版研究问题' },
      attachments: [{ slotId, fileId: file.id }],
    })
    expect(saved.data.application.answers).toEqual({ [questionId]: '附件规则迁移测试', [newQuestionId]: '新版研究问题' })
    const submitted = await service.submit(student, { expectedRevision: saved.data.application.revision })
    const [version] = await database.db.select({ snapshot: applicationVersions.snapshot }).from(applicationVersions).where(eq(applicationVersions.id, submitted.data.versionId))
    expect(version?.snapshot).toMatchObject({
      answers: { [newQuestionId]: '新版研究问题' },
      retiredAnswers: { [questionId]: '附件规则迁移测试' },
      retiredAnswerIds: [questionId],
    })
  })

  it('unlinks a draft attachment whose slot is disabled in v2 without deleting the owner file', async () => {
    const repository = createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') })
    const service = createApplicationService(repository)
    const mine = await service.getMine(student)
    const [file] = await database.db.insert(files).values({
      storageKey: 'aa/bb/retired', originalName: 'old-resume.pdf', mimeType: 'application/pdf', sizeBytes: 100,
      sha256: 'd'.repeat(64), uploadedBy: student.id, ownerUserId: student.id, purpose: 'registration_attachment',
      visibility: 'owner_admin', attachmentSlot: slotId,
    }).returning({ id: files.id })
    await service.saveDraft(student, {
      expectedRevision: mine.data.application.revision, profile, answers: {}, attachments: [{ slotId, fileId: file!.id }],
    })
    const v2: RegistrationForm = { ...form, attachments: [{ ...form.attachments[0]!, active: false, required: false }] }
    const [published] = await database.db.insert(registrationFormVersions).values({ version: 2, schema: v2 as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
    await database.db.update(registrationFormDrafts).set({ baseVersionId: published!.id, schema: v2 }).where(eq(registrationFormDrafts.id, '00000000-0000-4000-8000-000000000010'))

    const migrated = await service.getMine(student)
    expect(migrated.data.application.formVersion).toBe(2)
    expect(migrated.data.application.attachments).toEqual([])
    expect((migrated.data.application as typeof migrated.data.application & { unlinkedAttachments?: Array<{ id: string }> }).unlinkedAttachments).toEqual([
      expect.objectContaining({ id: file!.id }),
    ])
    expect(await database.db.select().from(applicationFiles)).toEqual([])
    expect(await database.db.select().from(files).where(eq(files.id, file!.id))).toEqual([
      expect.objectContaining({ id: file!.id, ownerUserId: student.id, lifecycleState: 'active', hiddenAt: null, deletedAt: null }),
    ])
    const updated = await service.saveDraft(student, { expectedRevision: migrated.data.application.revision, profile, answers: { [questionId]: '新版答案' }, attachments: [] })
    await expect(service.submit(student, { expectedRevision: updated.data.application.revision })).resolves.toMatchObject({ data: { status: 'submitted' } })
    await expect(createFileService(createFileRepository(database.db), {
      createStorageKey: () => '', put: async () => { throw new Error('unused') },
      open: async () => ({ [Symbol.asyncIterator]: async function* () { yield Buffer.from('pdf') } }) as never,
      remove: async () => { throw new Error('unused') },
    }).openForDownload(file!.id, student)).resolves.toMatchObject({ record: { id: file!.id, ownerUserId: student.id } })
  })

  it('revalidates a migrated attachment by validated MIME when v2 changes the same slot from PDF to DOCX', async () => {
    const { service, file } = await prepareDraftWithPdf(100)
    const v2: RegistrationForm = { ...form, attachments: [{ ...form.attachments[0]!, allowedExtensions: ['docx'] }] }
    await publishFormVersion(v2)
    const migrated = await service.getMine(student)

    await expect(service.submit(student, { expectedRevision: migrated.data.application.revision })).rejects.toMatchObject({
      code: 'APPLICATION_ATTACHMENT_INVALID',
      fields: [{ path: `attachments.${slotId}`, message: expect.stringMatching(/DOCX/u) }],
    })
    await expect(database.db.select().from(files).where(eq(files.id, file.id))).resolves.toEqual([
      expect.objectContaining({ id: file.id, mimeType: 'application/pdf', lifecycleState: 'active', deletedAt: null }),
    ])
  })

  it('revalidates a migrated attachment size when v2 tightens the same slot limit', async () => {
    const { service, file } = await prepareDraftWithPdf(900_000)
    const v2: RegistrationForm = { ...form, attachments: [{ ...form.attachments[0]!, maxSizeBytes: 100_000 }] }
    await publishFormVersion(v2)
    const migrated = await service.getMine(student)

    await expect(service.submit(student, { expectedRevision: migrated.data.application.revision })).rejects.toMatchObject({
      code: 'APPLICATION_ATTACHMENT_INVALID',
      fields: [{ path: `attachments.${slotId}`, message: expect.stringMatching(/大小/u) }],
    })
    await expect(database.db.select().from(files).where(eq(files.id, file.id))).resolves.toEqual([
      expect.objectContaining({ id: file.id, sizeBytes: 900_000, lifecycleState: 'active', deletedAt: null }),
    ])
  })

  it('returns a recoverable conflict and migrates the draft if v2 is published after submit preflight', async () => {
    const { repository, mine } = await prepareDraftWithPdf(100)
    let enterSubmit!: () => void
    let releaseSubmit!: () => void
    const enteredSubmit = new Promise<void>((resolve) => { enterSubmit = resolve })
    const releasedSubmit = new Promise<void>((resolve) => { releaseSubmit = resolve })
    const service = createApplicationService({
      ...repository,
      submit: async (input) => {
        enterSubmit()
        await releasedSubmit
        return repository.submit(input)
      },
    })
    const submission = service.submit(student, { expectedRevision: mine.data.application.revision })
    await enteredSubmit
    const v2: RegistrationForm = { ...form, questions: [{ ...form.questions[0]!, label: '新版问题' }] }
    const published = await publishFormVersion(v2)
    releaseSubmit()

    await expect(submission).rejects.toMatchObject({ code: 'APPLICATION_FORM_VERSION_CHANGED', status: 409 })
    await expect(service.getMine(student)).resolves.toMatchObject({
      data: { application: { formVersionId: published.id, formVersion: 2, status: 'draft' } },
    })
  })

  it('submits a compliant migrated attachment under the current published v2 rules', async () => {
    const { service } = await prepareDraftWithPdf(90_000)
    const v2: RegistrationForm = { ...form, attachments: [{ ...form.attachments[0]!, allowedExtensions: ['pdf'], maxSizeBytes: 100_000 }] }
    const published = await publishFormVersion(v2)
    const migrated = await service.getMine(student)

    await expect(service.submit(student, { expectedRevision: migrated.data.application.revision })).resolves.toMatchObject({ data: { status: 'submitted' } })
    const [version] = await database.db.select({ snapshot: applicationVersions.snapshot }).from(applicationVersions)
    expect(version?.snapshot).toMatchObject({ formVersionId: published.id })
  })

  it('serializes submit before a concurrent delete so the submitted attachment cannot disappear', async () => {
    const { service, mine, file } = await prepareSubmittableDraft()
    const lock = await database.pool.connect()
    await lock.query('begin')
    await lock.query('select id from applications where user_id = $1 for update', [student.id])
    await lock.query('select id from files where id = $1 for update', [file.id])
    try {
      const submit = service.submit(student, { expectedRevision: mine.data.application.revision })
      await waitForBlockedTransactions(1)
      const remove = createFileService(createFileRepository(database.db), {
        createStorageKey: () => '', put: async () => { throw new Error('unused') }, open: async () => { throw new Error('unused') }, remove: async () => undefined,
      }).remove(file.id, student)
      await waitForBlockedTransactions(2)
      await lock.query('commit')
      const [submitted, removed] = await Promise.allSettled([submit, remove])
      const application = (await database.db.select().from(applications).where(eq(applications.userId, student.id)))[0]!
      const storedFile = (await database.db.select().from(files).where(eq(files.id, file.id)))[0]!
      if (submitted.status === 'fulfilled') {
        expect(removed).toMatchObject({ status: 'rejected', reason: { code: 'FILE_LOCKED_BY_APPLICATION', status: 409 } })
        expect(application).toMatchObject({ status: 'submitted' })
        expect(storedFile).toMatchObject({ lifecycleState: 'active', hiddenAt: null, deletedAt: null })
      } else {
        expect(removed.status).toBe('fulfilled')
        expect(application).toMatchObject({ status: 'draft' })
        expect(storedFile).toMatchObject({ lifecycleState: 'deleted', deletedAt: expect.any(Date) })
      }
    } finally {
      await lock.query('rollback').catch(() => undefined)
      lock.release()
    }
  })

  it('serializes hide before a concurrent submit and rejects submission with an unavailable attachment', async () => {
    const { service, mine, file } = await prepareSubmittableDraft()
    const lock = await database.pool.connect()
    await lock.query('begin')
    await lock.query('select id from applications where user_id = $1 for update', [student.id])
    await lock.query('select id from files where id = $1 for update', [file.id])
    try {
      const hide = createFileService(createFileRepository(database.db), {
        createStorageKey: () => '', put: async () => { throw new Error('unused') }, open: async () => { throw new Error('unused') }, remove: async () => { throw new Error('unused') },
      }).hide(file.id, student)
      await waitForBlockedTransactions(1)
      const submit = service.submit(student, { expectedRevision: mine.data.application.revision })
      await waitForBlockedTransactions(2)
      await lock.query('commit')
      const [hidden, submitted] = await Promise.allSettled([hide, submit])
      const application = (await database.db.select().from(applications).where(eq(applications.userId, student.id)))[0]!
      const storedFile = (await database.db.select().from(files).where(eq(files.id, file.id)))[0]!
      if (hidden.status === 'fulfilled') {
        expect(submitted.status).toBe('rejected')
        expect(application).toMatchObject({ status: 'draft' })
        expect(storedFile).toMatchObject({ lifecycleState: 'active', hiddenAt: expect.any(Date), deletedAt: null })
      } else {
        expect(hidden).toMatchObject({ status: 'rejected', reason: { code: 'FILE_LOCKED_BY_APPLICATION', status: 409 } })
        expect(submitted.status).toBe('fulfilled')
        expect(application).toMatchObject({ status: 'submitted' })
        expect(storedFile).toMatchObject({ lifecycleState: 'active', hiddenAt: null, deletedAt: null })
      }
    } finally {
      await lock.query('rollback').catch(() => undefined)
      lock.release()
    }
  })
})
