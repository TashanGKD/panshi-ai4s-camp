import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { DEFAULT_REGISTRATION_FORM, type ApplicationCoreFields, type JsonObject, type RegistrationForm } from '@panshi/contracts'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { applications, applicationStatusHistory, applicationVersions, auditLogs, registrationFormDrafts, registrationFormVersions, users } from '../src/db/schema.js'
import { createReviewRepository } from '../src/modules/registration/review.repository.js'
import { createReviewService } from '../src/modules/registration/review.service.js'
import { createApplicationRepository } from '../src/modules/registration/application.repository.js'
import { createApplicationService } from '../src/modules/registration/application.service.js'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).pathname !== '/panshi_ai4s_camp_test') throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
const database = createDatabaseClient(url)
const admin = { id: '10000000-0000-4000-8000-000000000001', displayName: '审核员', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'admin' as const, disabledAt: null }
const student = { id: '10000000-0000-4000-8000-000000000002', displayName: '张三', phoneNormalized: '+8613900139000', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const questionId = '20000000-0000-4000-8000-000000000001'; const slotId = '20000000-0000-4000-8000-000000000002'
const form: RegistrationForm = { ...DEFAULT_REGISTRATION_FORM, questions: [{ id: questionId, type: 'long_text', label: '研究计划', helpText: '', required: true, order: 0, active: true, validation: { maxLength: 1000 } }], attachments: [{ ...DEFAULT_REGISTRATION_FORM.attachments[0]!, id: slotId }] }
const profile: Omit<ApplicationCoreFields, 'phone'> = {
  name: '=张三', email: 'z@example.com', organization: '中国科学院物理研究所', department: '研究生部',
  identityType: '博士研究生', educationStage: '博士研究生', majorResearchDirection: '凝聚态物理', major: '物理学',
  researchInterest: '', researchDirection: '凝聚态物理', postdocStation: '', disciplineField: '', supervisor: '',
  jobPosition: '', professionalTitleLevel: '', specificTitle: '', identityDescription: '',
}

describe('review workflow PostgreSQL', () => {
  beforeAll(async () => { await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined }) })
  beforeEach(async () => {
    await database.pool.query('TRUNCATE application_files, application_status_history, application_versions, applications, files, user_profiles, registration_form_drafts, registration_form_versions, content_versions, content_modules, audit_logs, sessions, users CASCADE')
    await database.db.insert(users).values([admin, student])
    const [version] = await database.db.insert(registrationFormVersions).values({ version: 1, schema: form as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
    await database.db.insert(registrationFormDrafts).values({ id: '00000000-0000-4000-8000-000000000010', schema: form, baseVersionId: version!.id })
    await database.db.insert(applications).values({ id: '30000000-0000-4000-8000-000000000001', userId: student.id, formVersionId: version!.id, status: 'submitted', revision: 2, coreFields: { ...profile, phone: student.phoneNormalized }, answers: { [questionId]: '内部答案' }, submittedAt: new Date('2026-08-15T00:00:00Z') })
    await database.db.insert(applicationVersions).values({ applicationId: '30000000-0000-4000-8000-000000000001', snapshot: { profile: { name: '=张三', organization: '物理所' }, answers: { [questionId]: '内部答案' }, attachments: [] }, reason: 'initial_submission' })
    await database.db.insert(applicationStatusHistory).values({ applicationId: '30000000-0000-4000-8000-000000000001', fromStatus: 'draft', toStatus: 'submitted', changedBy: student.id })
  })
  afterAll(async () => { await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await database.close() })

  it('locks revisions and atomically records allowed transitions without sensitive audit text', async () => {
    const service = createReviewService(createReviewRepository(database.db))
    const reviewing = await service.transition(admin, '30000000-0000-4000-8000-000000000001', { expectedRevision: 2, targetStatus: 'reviewing', internalNote: '不可导出的内部备注', editableFieldIds: [], editableAttachmentIds: [] })
    await expect(service.transition(admin, '30000000-0000-4000-8000-000000000001', { expectedRevision: 2, targetStatus: 'admitted', editableFieldIds: [], editableAttachmentIds: [] })).rejects.toMatchObject({ code: 'APPLICATION_REVISION_CONFLICT' })
    await expect(service.transition(admin, '30000000-0000-4000-8000-000000000001', { expectedRevision: reviewing.data.revision, targetStatus: 'needs_supplement', publicMessage: '请补充研究计划', editableFieldIds: [questionId], editableAttachmentIds: [slotId] })).resolves.toMatchObject({ data: { status: 'needs_supplement' } })
    const history = await database.db.select().from(applicationStatusHistory); expect(history.map((row) => row.toStatus)).toEqual(['submitted', 'reviewing', 'needs_supplement'])
    const audit = JSON.stringify(await database.db.select().from(auditLogs)); expect(audit).not.toContain('不可导出的内部备注'); expect(audit).not.toContain('请补充研究计划'); expect(audit).not.toContain('内部答案')
  })

  it('preserves every administrator reason as immutable private status history', async () => {
    const service = createReviewService(createReviewRepository(database.db))
    const reviewing = await service.transition(admin, '30000000-0000-4000-8000-000000000001', {
      expectedRevision: 2,
      targetStatus: 'reviewing',
      internalNote: '第一次审核意见',
      editableFieldIds: [],
      editableAttachmentIds: [],
    })
    await service.transition(admin, '30000000-0000-4000-8000-000000000001', {
      expectedRevision: reviewing.data.revision,
      targetStatus: 'needs_supplement',
      publicMessage: '请向学员公开补充要求',
      internalNote: '第二次内部判断',
      editableFieldIds: [questionId],
      editableAttachmentIds: [],
    })

    const detail = await service.detail(admin, '30000000-0000-4000-8000-000000000001') as unknown as { data: {
      history: Array<{ changedBy: string | null, fromStatus: string | null, toStatus: string, reason: string | null, internalNote: string | null }>
      application: { internalReviewNote: string | null }
    } }
    expect(detail.data.history.slice(-2)).toEqual([
      expect.objectContaining({ changedBy: admin.id, fromStatus: 'submitted', toStatus: 'reviewing', internalNote: '第一次审核意见' }),
      expect.objectContaining({ changedBy: admin.id, fromStatus: 'reviewing', toStatus: 'needs_supplement', reason: '请向学员公开补充要求', internalNote: '第二次内部判断' }),
    ])
    expect(detail.data.application.internalReviewNote).toBe('第二次内部判断')
    const stored = await database.db.select().from(applicationStatusHistory)
    expect(stored.map((row) => row.internalNote).filter(Boolean)).toEqual(['第一次审核意见', '第二次内部判断'])
    const audit = JSON.stringify(await database.db.select().from(auditLogs))
    expect(audit).not.toContain('第一次审核意见')
    expect(audit).not.toContain('第二次内部判断')
    expect(audit).not.toContain('请向学员公开补充要求')
  })

  it('rejects history updates and deletes without changing the row while allowing truncate cleanup', async () => {
    const [original] = await database.db.select().from(applicationStatusHistory)
    expect(original).toBeDefined()

    await expect(database.pool.query(
      'UPDATE application_status_history SET internal_note = $1 WHERE id = $2',
      ['篡改后的说明', original!.id],
    )).rejects.toThrow(/application status history is immutable/iu)
    await expect(database.pool.query(
      'DELETE FROM application_status_history WHERE id = $1',
      [original!.id],
    )).rejects.toThrow(/application status history is immutable/iu)

    const [unchanged] = await database.db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.id, original!.id))
    expect(unchanged).toEqual(original)
    await expect(database.pool.query('TRUNCATE application_status_history')).resolves.toMatchObject({ command: 'TRUNCATE' })
    expect(await database.db.select().from(applicationStatusHistory)).toEqual([])
  })

  it('returns partial bulk results and exports filtered safe CSV with a BOM', async () => {
    const service = createReviewService(createReviewRepository(database.db))
    const bulk = await service.bulkTransition(admin, { applicationIds: ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000099'], targetStatus: 'reviewing' })
    expect(bulk.data.results).toEqual([expect.objectContaining({ success: true }), expect.objectContaining({ success: false, code: 'APPLICATION_NOT_FOUND' })])
    const exported = await service.exportCsv(admin, { status: 'reviewing', organization: '中国科学院物理研究所' })
    expect(exported.csv.startsWith('\uFEFF')).toBe(true); expect(exported.csv).toContain("'=张三"); expect(exported.csv).not.toContain(student.phoneNormalized); expect(exported.csv).not.toContain('内部答案'); expect(exported.csv).not.toContain('内部备注')
    const [row] = await database.db.select().from(applications).where(eq(applications.id, '30000000-0000-4000-8000-000000000001')); expect(row?.status).toBe('reviewing')
  })

  it('opens only whitelisted fields, preserves the first snapshot, and creates a supplement version on resubmission', async () => {
    const reviews = createReviewService(createReviewRepository(database.db))
    const reviewing = await reviews.transition(admin, '30000000-0000-4000-8000-000000000001', { expectedRevision: 2, targetStatus: 'reviewing', editableFieldIds: [], editableAttachmentIds: [] })
    await reviews.transition(admin, '30000000-0000-4000-8000-000000000001', { expectedRevision: reviewing.data.revision, targetStatus: 'needs_supplement', publicMessage: '请完善研究计划', editableFieldIds: [questionId], editableAttachmentIds: [] })
    const applicationsService = createApplicationService(createApplicationRepository(database.db))
    const mine = await applicationsService.getMine(student)
    expect(mine.data.supplementRequest).toMatchObject({ message: '请完善研究计划', editableFieldIds: [questionId] })
    await expect(applicationsService.saveDraft(student, { expectedRevision: mine.data.application.revision, profile: { ...profile, name: '篡改姓名' }, answers: { [questionId]: '补充后的研究计划' }, attachments: [] })).rejects.toMatchObject({ code: 'APPLICATION_VALIDATION_FAILED' })
    const saved = await applicationsService.saveDraft(student, { expectedRevision: mine.data.application.revision, profile, answers: { [questionId]: '补充后的研究计划' }, attachments: [] })
    await expect(applicationsService.submit(student, { expectedRevision: saved.data.application.revision })).resolves.toMatchObject({ data: { status: 'reviewing' } })
    const versions = await database.db.select().from(applicationVersions).where(eq(applicationVersions.applicationId, '30000000-0000-4000-8000-000000000001'))
    expect(versions).toHaveLength(2); expect(versions[0]?.snapshot).toMatchObject({ answers: { [questionId]: '内部答案' } }); expect(versions[1]?.snapshot).toMatchObject({ answers: { [questionId]: '补充后的研究计划' } })
  })

  it('allows only one concurrent transition for the same revision', async () => {
    const service = createReviewService(createReviewRepository(database.db)); const input = { expectedRevision: 2, targetStatus: 'reviewing' as const, editableFieldIds: [], editableAttachmentIds: [] }
    const results = await Promise.allSettled([service.transition(admin, '30000000-0000-4000-8000-000000000001', input), service.transition(admin, '30000000-0000-4000-8000-000000000001', input)])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1); expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1)
  })
})
