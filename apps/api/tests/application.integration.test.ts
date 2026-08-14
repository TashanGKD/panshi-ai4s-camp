import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { DEFAULT_REGISTRATION_FORM, type JsonObject, type RegistrationForm } from '@panshi/contracts'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { applications, applicationVersions, auditLogs, contentModules, contentVersions, files, registrationFormDrafts, registrationFormVersions, users } from '../src/db/schema.js'
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
const form: RegistrationForm = { ...DEFAULT_REGISTRATION_FORM, questions: [{ id: questionId, type: 'short_text', label: '研究问题', helpText: '', required: true, order: 0, active: true, validation: { minLength: 2, maxLength: 30 } }], attachments: [{ id: slotId, label: '简历', helpText: '', required: true, order: 0, active: true, allowedExtensions: ['pdf'], maxSizeBytes: 1_000_000 }] }
const profile = { name: '张三', email: 'z@example.com', organization: '物理所', department: '研究生部', identityType: '研究生', educationStage: '博士', majorResearchDirection: '凝聚态' }

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

  it('persists one optimistic draft and does not count it as submitted', async () => {
    const service = createApplicationService(createApplicationRepository(database.db, { now: () => new Date('2026-08-15T00:00:00Z') }))
    const initial = await service.getMine(student)
    await service.saveDraft(student, { expectedRevision: initial.data.application.revision, profile, answers: {}, attachments: [] })
    await expect(service.saveDraft(student, { expectedRevision: initial.data.application.revision, profile, answers: {}, attachments: [] })).rejects.toMatchObject({ code: 'APPLICATION_REVISION_CONFLICT' })
    const counts = await database.db.select({ count: sql<number>`count(*)` }).from(applications).where(eq(applications.status, 'submitted'))
    expect(Number(counts[0]?.count)).toBe(0)
    await expect(database.db.insert(applications).values({ userId: student.id, formVersionId: initial.data.application.formVersionId })).rejects.toThrow()
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
    const v2: RegistrationForm = { ...form, questions: [{ ...form.questions[0]!, label: '新版问题' }] }
    await database.db.insert(registrationFormVersions).values({ version: 2, schema: v2 as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date() })
    const [snapshotAfter] = await database.db.select({ snapshot: applicationVersions.snapshot }).from(applicationVersions).where(eq(applicationVersions.id, submitted.data.versionId))
    expect(snapshotAfter).toEqual(snapshotBefore)
    await expect(database.pool.query('UPDATE application_versions SET reason = $1 WHERE id = $2', ['tamper', submitted.data.versionId])).rejects.toThrow(/immutable/iu)
    const logs = JSON.stringify(await database.db.select().from(auditLogs))
    expect(logs).not.toContain('绝密研究问题'); expect(logs).not.toContain('private-name.pdf')
    const fileService = createFileService(createFileRepository(database.db), { createStorageKey: () => '', put: async () => { throw new Error('unused') }, open: async () => { throw new Error('unused') }, remove: async () => { throw new Error('submitted files must not reach storage removal') } })
    await expect(fileService.remove(file!.id, student)).rejects.toMatchObject({ code: 'FILE_LOCKED_BY_APPLICATION', status: 409 })
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
})
