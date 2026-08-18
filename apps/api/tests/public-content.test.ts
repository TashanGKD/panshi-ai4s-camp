import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { ApiErrorSchema, PublicSiteResponseSchema } from '@panshi/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { auditLogs, contentModules, contentVersions, users } from '../src/db/schema.js'
import { createContentRepository } from '../src/modules/content/content.repository.js'
import { and, eq } from 'drizzle-orm'

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
  { key: 'features', payload: { items: [{ title: '真实问题', description: '围绕真实科研问题实践' }] }, version: 2 },
  { key: 'organizations', payload: { items: [{ role: '承办单位', name: '测试组织' }] }, version: 3 },
  { key: 'importantDates', payload: { items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }] }, version: 1 },
  { key: 'contacts', payload: { items: [{ label: '报名咨询', value: 'camp@example.org' }] }, version: 1 },
  { key: 'display', payload: { series: '磐石科学智能实训营', footer: '磐石·科学智能（AI for Science）实训营', homeSectionOrder: ['intro', 'features', 'eventDetails', 'scheduleOverview', 'guests', 'organizations'] }, version: 1 },
  { key: 'schedule', payload: { days: [
    { date: '2026-08-23', label: '第一天', theme: '主题一', sessions: [] },
    { date: '2026-08-24', label: '第二天', theme: '主题二', sessions: [] },
    { date: '2026-08-25', label: '第三天', theme: '主题三', sessions: [] },
    { date: '2026-08-26', label: '第四天', theme: '主题四', sessions: [] },
    { date: '2026-08-27', label: '第五天', theme: '主题五', sessions: [] },
  ] }, version: 4 },
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
      start: '2026-09-04',
      end: '2026-09-08',
      label: '2026 年 9月 4 日 — 9 月8日',
    })
    expect(initialPublishedContent.basic.venue).toBe('中国科学院物理研究所')
    expect(initialPublishedContent.basic.eventDetails).toEqual([
      '举办时间：2026 年9 月 4 日至 9 月 8 日，共 5 天。前 4 天分别围绕科研智能体、AI4S 科研方法论、科学模型和自驱动的端到端科研闭环开展课程教学，第 5 天安排科研机构参访、学习成果交流与结营。',
      '报到安排：2026年9月3日全天，以及9月4日8:00—9:00。',
      '举办地点：中国科学院物理研究所。',
      '举办规模：线下集中学习规模原则上控制在 80—100 人；学习后纳入实训项目培育计划的学员规模约 30—50 人。',
      '首届实训营拟采取公开报名、材料审核和分类录取的方式组织。',
    ])
    expect(initialPublishedContent.basic.registrationAndAccommodation).toEqual([
      '本次实训营不收取注册费，食宿自理。',
    ])
    expect(initialPublishedContent.basic.signature).toEqual({
      organization: '磐石·科学智能实训营会务组',
      date: '2026年8月18日',
    })
    expect(initialPublishedContent.schedule.days.map((day) => day.theme)).toEqual([
      '学员报到',
      '专题一\n科研智能体',
      '专题二\nAI4S 科研方法论',
      '专题三\n科学模型',
      '专题四\n自驱动的端到端科研闭环',
      '参访交流与结营',
    ])
    expect(initialPublishedContent.schedule.days.reduce((total, day) => total + day.sessions.length, 0)).toBe(31)
    expect(initialPublishedContent.schedule.introduction).toContain('9月3日全天及9月4日8:00—9:00安排学员报到')
    expect(initialPublishedContent.schedule.days[0]).toMatchObject({
      date: '2026-09-03', label: '9.3（周四）', theme: '学员报到',
      sessions: [{ title: '学员报到', time: '全天' }],
    })
    expect(initialPublishedContent.schedule.days[1]?.sessions[0]).toMatchObject({
      title: '学员报到', timeRange: { start: '08:00', end: '09:00' },
    })
    expect(initialPublishedContent.organizations.items).toContainEqual({ role: '支持单位', name: '腾讯云计算（北京）有限责任公司' })
    expect(initialPublishedContent.organizations.items).toContainEqual({ role: '协办单位', name: '中国科学院国家天文台' })
    expect(initialPublishedContent.organizations.items).toContainEqual({ role: '协办单位', name: '长三角物理研究中心' })
    expect(initialPublishedContent.organizations.items).toContainEqual({ role: '支持单位', name: '中国科学院数学与系统科学研究院研究生会' })
    expect(initialPublishedContent.organizations.items).toContainEqual({ role: '支持单位', name: '国家纳米科学中心研究生会' })
    expect(initialPublishedContent.organizations.items.map((item) => item.role)).not.toContain('共同举办')
    expect(initialPublishedContent.importantDates.items).toEqual([
      { label: '报名时间', value: '2026年8月18日—9月1日' },
      { label: '报到时间', value: '2026年9月3日全天、9月4日8:00—9:00' },
      { label: '实训营时间', value: '2026年9月4日—9月8日' },
      { label: '项目培育', value: '2026年9月4日—10月31日' },
    ])
    expect(initialPublishedContent.importantDates.machineDates).toEqual({
      registrationOpen: '2026-08-18', registrationDeadline: '2026-09-01', campStart: '2026-09-04', campEnd: '2026-09-08',
    })
    expect(initialPublishedContent.display.homeSectionOrder).toEqual([
      'intro', 'features', 'eventDetails', 'scheduleOverview', 'guests', 'organizations', 'registrationAndAccommodation',
    ])
    expect(initialPublishedContent.display.relatedLinks).toEqual([
      { label: '磐石官网', href: 'https://www.scienceone.ai/' },
      { label: '中国科学院大学他山学科交叉创新协会', href: 'https://preview.tashan.ac.cn/' },
    ])
    expect(initialPublishedContent.contacts.items).toEqual([
      { name: '高翔', responsibility: '会务组', methods: [{ type: 'phone', value: '18515181215' }] },
      { name: '周远航', responsibility: '会务组', methods: [{ type: 'phone', value: '18935301004' }] },
    ])
    expect(initialPublishedContent.schedule.speakers?.filter((speaker) => speaker.profile).map((speaker) => speaker.profile?.name)).toEqual([
      '曾大军', '丁鼎', '朱艳春', '周园春', '李凯', '翁红明',
    ])
    const seededSessions: ReadonlyArray<{ title: string, speakerIds?: readonly string[] }> = initialPublishedContent.schedule.days
      .flatMap((day) => day.sessions as ReadonlyArray<{ title: string, speakerIds?: readonly string[] }>)
    expect(seededSessions.find((session) => session.title.includes('机器学习力场与粗粒化建模'))?.speakerIds).toEqual(['pending-chemistry'])
    expect(initialPublishedContent.travel.sections).toContainEqual(expect.objectContaining({
      title: '实训营地址',
      image: expect.objectContaining({ src: '/images/iop-zhongguancun-location-map.png' }),
    }))
    expect(initialPublishedContent.travel.sections.find(({ title }) => title === '住宿安排')?.body).toContain('住宿费用由学员自行承担')
    expect(initialPublishedContent.travel.sections.find(({ title }) => title === '住宿安排')?.body).toContain('北京物科宾馆')
    expect(JSON.stringify(initialPublishedContent)).not.toMatch(/报名截止|手机号|电子邮箱/u)
  })

  it('includes a separate reporting day with all five camp days in the homepage overview', async () => {
    const sixDaySchedule = {
      days: [
        { date: '2026-09-03', label: '9.3（周四）', theme: '学员报到', sessions: [] },
        { date: '2026-09-04', label: '9.4（周五）', theme: '专题一', sessions: [] },
        { date: '2026-09-05', label: '9.5（周六）', theme: '专题二', sessions: [] },
        { date: '2026-09-06', label: '9.6（周日）', theme: '专题三', sessions: [] },
        { date: '2026-09-07', label: '9.7（周一）', theme: '专题四', sessions: [] },
        { date: '2026-09-08', label: '9.8（周二）', theme: '参访交流与结营', sessions: [] },
      ],
    }
    const app = createPublicApp([
      ...publishedSiteRows.filter((row) => row.key !== 'schedule'),
      { key: 'schedule', payload: sixDaySchedule, version: 5 },
    ])

    const response = await request(app).get('/api/v1/public/site')

    expect(response.status).toBe(200)
    expect(PublicSiteResponseSchema.parse(response.body).data.scheduleOverview).toHaveLength(6)
    expect(response.body.data.scheduleOverview.at(-1)).toMatchObject({ date: '2026-09-08' })
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

  it('keeps weak etag validation for public GET responses', async () => {
    const app = createPublicApp(publishedSiteRows)
    const initial = await request(app).get('/api/v1/public/site')

    expect(initial.status).toBe(200)
    expect(initial.headers.etag).toMatch(/^W\//u)
    expect(initial.headers['cache-control']).toBeUndefined()
    const conditional = await request(app).get('/api/v1/public/site').set('If-None-Match', initial.headers.etag as string)
    expect(conditional.status).toBe(304)
    expect(conditional.text).toBe('')
    expect(conditional.headers.etag).toBe(initial.headers.etag)
    expect(conditional.headers['cache-control']).toBeUndefined()
  })

  it('omits unpublished modules instead of falling back to draft JSON', async () => {
    const response = await request(createPublicApp(publishedSiteRows.filter((row) => row.key !== 'schedule'))).get('/api/v1/public/schedule')

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
      ...publishedSiteRows.filter((row) => row.key !== 'schedule'),
      { key: 'schedule', payload: schedule, version: 3 },
    ])

    const siteResponse = await request(app).get('/api/v1/public/site')
    const scheduleResponse = await request(app).get('/api/v1/public/schedule')

    const site = PublicSiteResponseSchema.parse(siteResponse.body)
    expect(siteResponse.status).toBe(200)
    expect(site.data.features.items[0]?.title).toBe('真实问题')
    expect(site.data.organizations.items[0]?.name).toBe('测试组织')
    expect(site.data.guests).toEqual([])
    expect(site.data.scheduleOverview).toEqual([{ date: '2026-08-23', label: '第一天', theme: '科研智能体' }])
    expect(site.data.visibleNavigation).toEqual(['home', 'schedule', 'register', 'travel', 'contacts', 'resources', 'account'])
    expect(site.data.registrationCta).toEqual({ label: '在线注册', to: '/application' })
    expect(site.data.importantDates).toEqual({ items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }] })
    expect(site.data.contacts).toEqual({ items: [{ label: '报名咨询', value: 'camp@example.org' }] })

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
      displayName: '内容测试用户',
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
    expect(await testDatabase!.db.select().from(auditLogs)).toHaveLength(14)
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
    expect(await testDatabase!.db.select().from(contentVersions)).toHaveLength(7)
    expect(await testDatabase!.db.select().from(auditLogs)).toHaveLength(14)
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
    const publicationAudits = await testDatabase!.db.select().from(auditLogs).where(and(
      eq(auditLogs.action, 'content.version_published'),
      eq(auditLogs.entityId, 'basic'),
    ))
    expect(publicationAudits).toHaveLength(1)
    expect(publicationAudits[0]?.metadata).toEqual({
      moduleKey: 'basic',
      previousPublishedVersionId: null,
      source: 'initial_content_seed',
      version: 1,
      versionId: existingId,
    })
    expect(await testDatabase!.db.select().from(auditLogs).where(and(
      eq(auditLogs.action, 'content.version_created'),
      eq(auditLogs.entityId, existingId),
    ))).toHaveLength(0)
  })

  it('serializes concurrent seed calls without duplicate versions or audits', async () => {
    const { seedInitialContent } = await import('../src/db/seeds/initial-content.js')
    const creatorId = await createCreator()

    await expect(Promise.all([
      seedInitialContent(testDatabase!.db, creatorId),
      seedInitialContent(testDatabase!.db, creatorId),
    ])).resolves.toEqual([undefined, undefined])

    expect(await testDatabase!.db.select().from(contentModules)).toHaveLength(8)
    expect(await testDatabase!.db.select().from(contentVersions)).toHaveLength(7)
    const audits = await testDatabase!.db.select().from(auditLogs)
    expect(audits).toHaveLength(14)
    expect(audits.filter(({ action }) => action === 'content.version_created')).toHaveLength(7)
    expect(audits.filter(({ action }) => action === 'content.version_published')).toHaveLength(7)
  })
})
