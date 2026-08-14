import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseClient } from '../src/db/client.js'
import { auditLogs, contentModules, contentVersions, resources, users } from '../src/db/schema.js'
import { createContentPublishingRepository } from '../src/modules/content/content.repository.js'
import { createContentPublishingService, ContentConflictError } from '../src/modules/content/publish.service.js'
import { ContentValidationError } from '../src/modules/content/content.validators.js'

const requiredUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
if (process.env.TEST_DATABASE_URL !== requiredUrl) {
  throw new Error(`TEST_DATABASE_URL must equal exactly ${requiredUrl}`)
}

const database = createDatabaseClient(requiredUrl)
const repository = createContentPublishingRepository(database.db)
const service = createContentPublishingService(repository)

const oldBasic = {
  title: '第一版标题',
  dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
  venue: '第一版地点',
  intro: ['第一版敏感正文'],
}
const newBasic = { ...oldBasic, title: '第二版标题', intro: ['第二版敏感正文'] }
const publishableImportantDates = {
  items: [
    { label: '开放', value: '2026-07-01', machineKey: 'registrationOpen' },
    { label: '截止', value: '2026-07-31', machineKey: 'registrationDeadline' },
    { label: '开始', value: '2026-08-23', machineKey: 'campStart' },
    { label: '结束', value: '2026-08-27', machineKey: 'campEnd' },
  ],
}
const importantDatesFor = (start: string, end: string) => ({
  items: publishableImportantDates.items.map((item) => item.machineKey === 'campStart' ? { ...item, value: start }
    : item.machineKey === 'campEnd' ? { ...item, value: end } : item),
})
let adminA: string
let adminB: string

const createAdmin = async (suffix: string) => {
  const [user] = await database.db.insert(users).values({
    displayName: `内容管理员${suffix}`,
    phoneNormalized: `+86139${suffix.padStart(8, '0')}`,
    passwordHash: 'test-only-hash',
    role: 'admin',
  }).returning({ id: users.id })
  if (!user) throw new Error('Failed to create content test administrator')
  return user.id
}

describe('content publishing PostgreSQL transactions', () => {
  beforeEach(async () => {
    await database.pool.query('truncate table audit_logs, resources, content_modules, content_versions, users cascade')
    adminA = await createAdmin('1')
    adminB = await createAdmin('2')
    await database.db.insert(contentModules).values([
      { key: 'basic', draft: {}, draftRevision: 0 },
      { key: 'importantDates', draft: {}, draftRevision: 0 },
      { key: 'schedule', draft: {}, draftRevision: 0 },
      { key: 'contacts', draft: {}, draftRevision: 0 },
    ])
  })

  afterAll(async () => database.close())

  it('atomically rejects stale and concurrent draft saves', async () => {
    const first = await service.saveDraft('basic', oldBasic, 0, adminA)
    expect(first.data.revision).toBe(1)
    await expect(service.saveDraft('basic', newBasic, 0, adminB)).rejects.toBeInstanceOf(ContentConflictError)

    await database.db.update(contentModules).set({ draft: {}, draftRevision: 0 }).where(eq(contentModules.key, 'basic'))
    const concurrent = await Promise.allSettled([
      service.saveDraft('basic', oldBasic, 0, adminA),
      service.saveDraft('basic', newBasic, 0, adminB),
    ])
    expect(concurrent.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter(({ status }) => status === 'rejected')).toHaveLength(1)
  })

  it('leaves the published pointer and version history unchanged when validation fails', async () => {
    await service.saveDraft('basic', oldBasic, 0, adminA)
    const published = await service.publish('basic', 1, adminA)
    const [beforeModule] = await database.db.select().from(contentModules).where(eq(contentModules.key, 'basic'))
    const beforeVersions = await database.db.select().from(contentVersions).where(eq(contentVersions.moduleKey, 'basic'))

    await service.saveDraft('basic', { title: 'invalid internal draft' }, 1, adminB)
    await expect(service.publish('basic', 2, adminB)).rejects.toBeInstanceOf(ContentValidationError)

    const [afterModule] = await database.db.select().from(contentModules).where(eq(contentModules.key, 'basic'))
    const afterVersions = await database.db.select().from(contentVersions).where(eq(contentVersions.moduleKey, 'basic'))
    expect(published.data.version).toBe(1)
    expect(afterModule?.publishedVersionId).toBe(beforeModule?.publishedVersionId)
    expect(afterVersions).toEqual(beforeVersions)
  })

  it('allows incomplete important-date drafts but rejects publishing them with field details', async () => {
    const saved = await service.saveDraft('importantDates', { items: [] }, 0, adminA)
    expect(saved.data.payload).toEqual({ items: [] })
    await expect(service.publish('importantDates', 1, adminA)).rejects.toMatchObject({
      details: { fields: expect.arrayContaining([
        expect.objectContaining({ path: 'items.registrationOpen', code: 'MACHINE_DATE_REQUIRED' }),
        expect.objectContaining({ path: 'items.campEnd', code: 'MACHINE_DATE_REQUIRED' }),
      ]) },
    })
    expect((await service.getHistory('importantDates')).data.versions).toHaveLength(0)
  })

  it('publishes a new authoritative basic date range before matching important dates', async () => {
    await service.saveDraft('basic', oldBasic, 0, adminA)
    await service.publish('basic', 1, adminA)
    await service.saveDraft('importantDates', publishableImportantDates, 0, adminA)
    await service.publish('importantDates', 1, adminA)

    const movedBasic = {
      ...oldBasic,
      dates: { start: '2026-09-01', end: '2026-09-05', label: '2026-09-01 至 2026-09-05' },
    }
    await service.saveDraft('basic', movedBasic, 1, adminB)
    await expect(service.publish('basic', 2, adminB)).resolves.toMatchObject({ data: { version: 2 } })

    await service.saveDraft('importantDates', importantDatesFor('2026-09-01', '2026-09-05'), 1, adminB)
    await expect(service.publish('importantDates', 2, adminB)).resolves.toMatchObject({ data: { version: 2 } })
  })

  it('serializes concurrent publishes and allocates unique increasing versions', async () => {
    await service.saveDraft('basic', oldBasic, 0, adminA)
    const results = await Promise.all([
      service.publish('basic', 1, adminA),
      service.publish('basic', 1, adminB),
    ])
    expect(results.map(({ data }) => data.version).sort()).toEqual([1, 2])
    const history = await service.getHistory('basic')
    expect(history.data.versions.map(({ version }) => version)).toEqual([2, 1])
    expect(history.data.publishedVersion).toBe(2)
  })

  it('keeps historical rows immutable and rollback creates a new copied version', async () => {
    await service.saveDraft('basic', oldBasic, 0, adminA)
    await service.publish('basic', 1, adminA)
    await service.saveDraft('basic', newBasic, 1, adminB)
    await service.publish('basic', 2, adminB)

    const rollback = await service.rollback('basic', 1, adminA)
    const versions = await database.db.select().from(contentVersions).where(eq(contentVersions.moduleKey, 'basic'))
    expect(rollback.data).toMatchObject({ version: 3, sourceVersion: 1 })
    expect(versions.find(({ version }) => version === 1)?.payload).toEqual(oldBasic)
    expect(versions.find(({ version }) => version === 2)?.payload).toEqual(newBasic)
    expect(versions.find(({ version }) => version === 3)?.payload).toEqual(oldBasic)

    await expect(database.pool.query(
      'update content_versions set payload = $1 where module_key = $2 and version = $3',
      [newBasic, 'basic', 1],
    )).rejects.toThrow(/immutable/u)
    await expect(database.pool.query(
      'delete from content_versions where module_key = $1 and version = $2',
      ['basic', 1],
    )).rejects.toThrow(/immutable/u)
  })

  it('validates rollback payload and preserves pointer/history when a legacy version is no longer publishable', async () => {
    const [legacy] = await database.db.insert(contentVersions).values({
      moduleKey: 'importantDates', version: 1, payload: { items: [] }, createdBy: adminA,
    }).returning({ id: contentVersions.id })
    await database.db.update(contentModules).set({ publishedVersionId: legacy!.id }).where(eq(contentModules.key, 'importantDates'))
    await service.saveDraft('importantDates', publishableImportantDates, 0, adminA)
    await service.publish('importantDates', 1, adminA)

    const before = await service.getHistory('importantDates')
    await expect(service.rollback('importantDates', 1, adminB)).rejects.toBeInstanceOf(ContentValidationError)
    const after = await service.getHistory('importantDates')
    expect(after.data.publishedVersion).toBe(2)
    expect(after.data.versions).toEqual(before.data.versions)
  })

  it('audits save, publish and rollback with redacted structural summaries', async () => {
    const arbitraryKey = 'private-contact-13800138000'
    await service.saveDraft('basic', { ...oldBasic, [arbitraryKey]: ['第一版敏感正文'] }, 0, adminA)
    await service.saveDraft('basic', oldBasic, 1, adminA)
    await service.publish('basic', 2, adminA)
    await service.rollback('basic', 1, adminB)
    const audits = await database.db.select().from(auditLogs).where(eq(auditLogs.entityId, 'basic'))
    expect(audits.map(({ action }) => action)).toEqual([
      'content.draft_saved', 'content.draft_saved', 'content.published', 'content.rolled_back',
    ])
    expect(audits.map(({ actorUserId }) => actorUserId)).toEqual([adminA, adminA, adminA, adminB])
    expect(audits[0]?.metadata).toMatchObject({ moduleKey: 'basic', before: { revision: 0 }, after: { revision: 1 } })
    expect(audits[2]?.metadata).toMatchObject({ moduleKey: 'basic', revision: 2, version: 1 })
    expect(audits[3]?.metadata).toMatchObject({ moduleKey: 'basic', sourceVersion: 1, version: 2 })
    expect(JSON.stringify(audits)).not.toMatch(/第一版标题|第一版地点|第一版敏感正文|private-contact-13800138000/u)
  })

  it('leaves public resource completeness to the future Task 15 visibility boundary', async () => {
    await database.pool.query("insert into resources (key, title, access_level) values ('public-guide', '公开指南', 'public')")
    await service.saveDraft('basic', oldBasic, 0, adminA)
    await expect(service.publish('basic', 1, adminA)).resolves.toMatchObject({ data: { version: 1 } })
    expect(await database.db.select().from(resources)).toHaveLength(1)
  })
})
