import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { ApiErrorSchema, PublicSiteResponseSchema } from '@panshi/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { auditLogs, contentModules, contentVersions, users } from '../src/db/schema.js'
import { createContentRepository } from '../src/modules/content/content.repository.js'
import { eq } from 'drizzle-orm'

type PublishedRow = {
  key: string
  payload: unknown
  version: number
}

const basic = {
  title: '正式标题',
  dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
  venue: '中国科学院物理研究所',
  intro: ['正式简介'],
}

const publishedSiteRows: PublishedRow[] = [
  { key: 'basic', payload: basic, version: 1 },
  { key: 'importantDates', payload: { items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }] }, version: 1 },
  { key: 'contacts', payload: { items: [] }, version: 1 },
  { key: 'display', payload: { series: '磐石科学智能实训营', footer: '磐石·科学智能（AI for Science）实训营' }, version: 1 },
]

const schedule = {
  days: [
    { date: '2026-08-23', label: '第一天', theme: '科研智能体', sessions: [] },
  ],
}

const createPublicApp = (rows: readonly PublishedRow[]) => createApp({
  checkDatabase: async () => undefined,
  config: { allowedOrigins: [], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
  contentRepository: {
    findPublishedByKeys: async (keys: readonly string[]) => rows.filter((row) => keys.includes(row.key)),
  },
} as Parameters<typeof createApp>[0])

describe('public published content', () => {
  it('ships a source-aligned initial seed without unconfirmed public facts', async () => {
    const { initialPublishedContent } = await import('../src/db/seeds/initial-content.js')

    expect(initialPublishedContent.basic.dates).toEqual({
      start: '2026-08-23',
      end: '2026-08-27',
      label: '2026-08-23 至 2026-08-27',
    })
    expect(initialPublishedContent.basic.venue).toBe('中国科学院物理研究所')
    expect(initialPublishedContent.schedule.days.map((day) => day.theme)).toEqual([
      '科研智能体',
      'AI4S 科研方法论',
      '科学模型',
      '自驱动的端到端科研闭环',
      '参访交流与结营',
    ])
    expect(initialPublishedContent.contacts.items).toEqual([])
    expect('travel' in initialPublishedContent).toBe(false)
    expect(JSON.stringify(initialPublishedContent)).not.toMatch(/报名截止|手机号|电子邮箱|待定/u)
  })

  it('never exposes drafts from the public site endpoint', async () => {
    const app = createPublicApp([
      ...publishedSiteRows,
      { key: 'schedule', payload: schedule, version: 1 },
      { key: 'draft-only-marker', payload: { title: '草稿标题' }, version: 1 },
    ])

    const response = await request(app).get('/api/v1/public/site')

    expect(response.status).toBe(200)
    expect(PublicSiteResponseSchema.parse(response.body).data.basic.title).toBe('正式标题')
    expect(JSON.stringify(response.body)).not.toContain('草稿标题')
  })

  it('omits unpublished modules instead of falling back to draft JSON', async () => {
    const response = await request(createPublicApp(publishedSiteRows)).get('/api/v1/public/schedule')

    expect(response.status).toBe(404)
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('CONTENT_NOT_FOUND')
    expect(JSON.stringify(response.body)).not.toContain('draft')
  })

  it('returns a controlled server error for an invalid published payload', async () => {
    const rows = publishedSiteRows.map((row) => row.key === 'basic'
      ? { ...row, payload: { title: '内部损坏数据', secret: 'raw-database-secret' } }
      : row)

    const response = await request(createPublicApp(rows)).get('/api/v1/public/site')

    expect(response.status).toBe(500)
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(response.body)).not.toMatch(/内部损坏数据|raw-database-secret/u)
  })

  it('aggregates only published shell modules and keeps schedule separate', async () => {
    const app = createPublicApp([
      ...publishedSiteRows,
      { key: 'schedule', payload: schedule, version: 3 },
    ])

    const siteResponse = await request(app).get('/api/v1/public/site')
    const scheduleResponse = await request(app).get('/api/v1/public/schedule')

    const site = PublicSiteResponseSchema.parse(siteResponse.body)
    expect(siteResponse.status).toBe(200)
    expect(Object.keys(site.data).sort()).toEqual([
      'basic', 'contacts', 'contentVersion', 'display', 'importantDates',
    ])
    expect(JSON.stringify(site)).not.toContain('科研智能体')

    expect(scheduleResponse.status).toBe(200)
    expect(scheduleResponse.body).toEqual({
      apiVersion: 'v1',
      data: { contentVersion: 'schedule:3', schedule },
    })
  })
})

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (testDatabaseUrl && new URL(testDatabaseUrl).pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}
const testDatabase = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : undefined

describe.skipIf(!testDatabase)('public content PostgreSQL boundary', () => {
  beforeEach(async () => {
    await testDatabase?.pool.query('truncate table audit_logs, content_modules, content_versions, users cascade')
  })

  afterAll(async () => {
    await testDatabase?.close()
  })

  const createCreator = async () => {
    const [creator] = await testDatabase!.db.insert(users).values({
      phoneNormalized: '+8613900000000',
      passwordHash: 'test-only-non-login-hash',
      role: 'user',
    }).returning({ id: users.id })
    if (!creator) throw new Error('Failed to create seed test actor')
    return creator.id
  }

  it('is idempotent and reads only versions selected by published_version_id', async () => {
    const { seedInitialContent } = await import('../src/db/seeds/initial-content.js')
    const creatorId = await createCreator()
    await seedInitialContent(testDatabase!.db, creatorId)
    await seedInitialContent(testDatabase!.db, creatorId)
    await testDatabase!.db.update(contentModules).set({ draft: { title: '数据库草稿标题' } }).where(eq(contentModules.key, 'basic'))
    await testDatabase!.db.update(contentModules).set({ draft: { directions: '虚构交通路线' } }).where(eq(contentModules.key, 'travel'))

    const app = createApp({
      checkDatabase: async () => undefined,
      contentRepository: createContentRepository(testDatabase!.db),
      config: { allowedOrigins: [], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
    })
    const siteResponse = await request(app).get('/api/v1/public/site')
    const travelResponse = await request(app).get('/api/v1/public/content/travel')

    expect(siteResponse.status).toBe(200)
    expect(JSON.stringify(siteResponse.body)).not.toContain('数据库草稿标题')
    expect(travelResponse.status).toBe(404)
    expect(JSON.stringify(travelResponse.body)).not.toContain('虚构交通路线')
    expect(await testDatabase!.db.select().from(contentModules)).toHaveLength(8)
    expect(await testDatabase!.db.select().from(contentVersions)).toHaveLength(6)
    expect(await testDatabase!.db.select().from(auditLogs)).toHaveLength(6)
  })

  it('reuses a matching pre-existing version instead of pointing at a missing deterministic id', async () => {
    const { initialPublishedContent, seedInitialContent } = await import('../src/db/seeds/initial-content.js')
    const creatorId = await createCreator()
    await testDatabase!.db.insert(contentModules).values({ key: 'basic', draft: {}, draftRevision: 0 })
    const existingId = randomUUID()
    await testDatabase!.db.insert(contentVersions).values({
      id: existingId,
      moduleKey: 'basic',
      version: 1,
      payload: initialPublishedContent.basic,
      createdBy: creatorId,
    })

    await expect(seedInitialContent(testDatabase!.db, creatorId)).resolves.toBeUndefined()
    const [module] = await testDatabase!.db.select({ publishedVersionId: contentModules.publishedVersionId })
      .from(contentModules).where(eq(contentModules.key, 'basic'))
    expect(module?.publishedVersionId).toBe(existingId)
  })
})
