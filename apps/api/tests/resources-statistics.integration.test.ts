import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { applications, contentModules, contentVersions, files, registrationFormVersions, resources, users } from '../src/db/schema.js'
import { createResourceRepository } from '../src/modules/resources/resource.repository.js'
import { createResourceService } from '../src/modules/resources/resource.service.js'
import { createStatisticsRepository } from '../src/modules/statistics/statistics.repository.js'
import { createStatisticsService } from '../src/modules/statistics/statistics.service.js'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).pathname !== '/panshi_ai4s_camp_test') throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
const database = createDatabaseClient(url)
const admin = { id: '10000000-0000-4000-8000-000000000001', displayName: '管理员', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'admin' as const, disabledAt: null }
const student = { id: '10000000-0000-4000-8000-000000000002', displayName: '学员', phoneNormalized: '+8613900139000', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const admitted = { ...student, id: '10000000-0000-4000-8000-000000000003', phoneNormalized: '+8613700137000' }

describe('resources and statistics PostgreSQL truth', () => {
  beforeAll(async () => { await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined }) })
  beforeEach(async () => {
    await database.pool.query('TRUNCATE application_files, application_status_history, application_versions, applications, resources, files, registration_form_drafts, registration_form_versions, content_versions, content_modules, audit_logs, sessions, users CASCADE')
    await database.db.insert(users).values([admin, student, admitted])
  })
  afterAll(async () => { await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await database.close() })

  it('filters public, authenticated and admitted records and removes hidden files immediately', async () => {
    const insertedFiles = await database.db.insert(files).values(['public', 'authenticated', 'admitted'].map((scope, index) => ({
      id: `20000000-0000-4000-8000-00000000000${index + 1}`, storageKey: `aa/bb/${scope}`, originalName: `${scope}.pdf`, mimeType: 'application/pdf', sizeBytes: 100,
      sha256: String(index + 1).repeat(64), uploadedBy: admin.id, ownerUserId: admin.id, purpose: 'resource' as const, visibility: scope as 'public' | 'authenticated' | 'admitted',
    }))).returning({ id: files.id, visibility: files.visibility })
    await database.db.insert(resources).values(insertedFiles.map((file, index) => ({ key: `r${index}`, title: `资料${index}`, fileId: file.id, accessLevel: file.visibility as 'public' | 'authenticated' | 'admitted', sortOrder: index, active: true })))
    const [form] = await database.db.insert(registrationFormVersions).values({ version: 1, schema: {}, createdBy: admin.id, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
    await database.db.insert(applications).values({ userId: admitted.id, formVersionId: form!.id, status: 'admitted', coreFields: {}, answers: {} })
    const service = createResourceService(createResourceRepository(database.db), { openPublishedResource: async () => { throw new Error('unused') } } as never)
    expect((await service.list(null)).map((item) => item.accessScope)).toEqual(['public'])
    expect((await service.list(student)).map((item) => item.accessScope)).toEqual(['public', 'authenticated'])
    expect((await service.list(admitted)).map((item) => item.accessScope)).toEqual(['public', 'authenticated', 'admitted'])
    await database.db.update(files).set({ hiddenAt: new Date() }).where(eq(files.id, insertedFiles[0]!.id))
    expect(await service.list(null)).toEqual([])
  })

  it('keeps a resource private until an administrator explicitly publishes it', async () => {
    const [file] = await database.db.insert(files).values({ id: '20000000-0000-4000-8000-000000000010', storageKey: 'aa/bb/draft', originalName: 'guide.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'a'.repeat(64), uploadedBy: admin.id, ownerUserId: admin.id, purpose: 'resource', visibility: 'public' }).returning({ id: files.id })
    const repository = createResourceRepository(database.db)
    const draft = await repository.createDraft({ key: 'guide', title: '报名指南', description: null, fileId: file!.id, accessScope: 'public', sortOrder: 0 }, admin.id)
    expect(draft.active).toBe(false); expect(await repository.listAvailable()).toEqual([])
    const service = createResourceService(repository, { openPublishedResource: async () => ({ record: { id: file!.id }, stream: 'stream' }) } as never)
    await expect(service.open(draft.id, null)).rejects.toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
    await expect(service.open(draft.id, admin)).rejects.toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
    await expect(service.preview(draft.id, admin)).resolves.toMatchObject({ record: { id: file!.id }, isPublished: false, isAdminPreview: true })
    await repository.setPublished(draft.id, true, admin.id)
    expect((await repository.listAvailable()).map((item) => item.key)).toEqual(['guide'])
  })

  it('counts every submitted-or-later status, excludes drafts, and obeys the published switch without a side channel', async () => {
    await database.db.insert(contentModules).values({ key: 'display', draft: {}, draftRevision: 0 })
    const [off] = await database.db.insert(contentVersions).values({ moduleKey: 'display', version: 1, payload: { showRegistrationCount: false }, createdBy: admin.id }).returning({ id: contentVersions.id })
    await database.db.update(contentModules).set({ publishedVersionId: off!.id }).where(eq(contentModules.key, 'display'))
    const [form] = await database.db.insert(registrationFormVersions).values({ version: 1, schema: {}, createdBy: admin.id, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
    const statuses = ['draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] as const
    const extraUsers = statuses.map((status, index) => ({ id: `30000000-0000-4000-8000-00000000000${index + 1}`, displayName: status, phoneNormalized: `+8615${String(index).padStart(9, '0')}`, passwordHash: 'x', role: 'user' as const }))
    await database.db.insert(users).values(extraUsers)
    await database.db.insert(applications).values(statuses.map((status, index) => ({ userId: extraUsers[index]!.id, formVersionId: form!.id, status, coreFields: {}, answers: {}, updatedAt: new Date(`2026-08-15T12:0${index}:00.000Z`) })))
    const service = createStatisticsService(createStatisticsRepository(database.db))
    expect(await service.readPublic()).toEqual({ visible: false })
    const [on] = await database.db.insert(contentVersions).values({ moduleKey: 'display', version: 2, payload: { showRegistrationCount: true }, createdBy: admin.id }).returning({ id: contentVersions.id })
    await database.db.update(contentModules).set({ publishedVersionId: on!.id }).where(eq(contentModules.key, 'display'))
    expect(await service.readPublic()).toEqual({ visible: true, submittedCount: 6, updatedAt: '2026-08-15T12:06:00.000Z' })
  })
})
