import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseClient } from '../src/db/client.js'
import { applications, auditLogs, contentModules, contentVersions, registrationFormVersions, users } from '../src/db/schema.js'
import { createAdminSummaryRepository } from '../src/modules/admin-summary/admin-summary.repository.js'
import { createAdminSummaryService } from '../src/modules/admin-summary/admin-summary.service.js'

const requiredUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
if (process.env.TEST_DATABASE_URL !== requiredUrl) throw new Error(`TEST_DATABASE_URL must equal exactly ${requiredUrl}`)
const database = createDatabaseClient(requiredUrl)

describe('administrator summary PostgreSQL aggregation', () => {
  beforeEach(async () => {
    await database.pool.query('truncate table audit_logs, applications, registration_form_versions, content_modules, content_versions, users cascade')
  })
  afterAll(async () => {
    await database.pool.query('truncate table audit_logs, applications, registration_form_versions, content_modules, content_versions, users cascade')
    await database.close()
  })

  it('reads status, draft and audit aggregates without audit metadata', async () => {
    const [admin, student] = await database.db.insert(users).values([
      { displayName: '管理员', phoneNormalized: '+8613900000001', passwordHash: 'x', role: 'admin' },
      { displayName: '学员', phoneNormalized: '+8613900000002', passwordHash: 'x', role: 'user' },
    ]).returning({ id: users.id })
    const [form] = await database.db.insert(registrationFormVersions).values({ schema: {}, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
    await database.db.insert(applications).values({ userId: student!.id, formVersionId: form!.id, status: 'submitted' })
    await database.db.insert(contentModules).values({ key: 'basic', draft: { title: '未公开正文' }, draftRevision: 2 })
    await database.db.insert(contentModules).values({ key: 'importantDates', draft: {}, draftRevision: 0 })
    const [datesVersion] = await database.db.insert(contentVersions).values({ moduleKey: 'importantDates', version: 1, createdBy: admin!.id, payload: { items: [
      { label: '报名截止', value: '2099-08-20', machineKey: 'registrationDeadline' },
      { label: '已过日期', value: '2000-08-01', machineKey: 'registrationOpen' },
    ] } }).returning({ id: contentVersions.id })
    await database.pool.query('update content_modules set published_version_id = $1 where key = $2', [datesVersion!.id, 'importantDates'])
    await database.db.insert(auditLogs).values({
      actorUserId: admin!.id, action: 'content.draft_saved', entityType: 'content_module', entityId: 'basic', metadata: { secret: '不得返回' },
    })

    const result = await createAdminSummaryService(createAdminSummaryRepository(database.db)).getSummary()
    expect(result.data.applications).toMatchObject({ total: 1, pendingReview: 1, byStatus: { submitted: 1 } })
    expect(result.data.unpublishedDrafts).toContainEqual(expect.objectContaining({ key: 'basic', revision: 2 }))
    expect(result.data.upcomingDates).toEqual([{ machineKey: 'registrationDeadline', label: '报名截止', date: '2099-08-20' }])
    expect(result.data.recentOperations).toContainEqual(expect.objectContaining({ action: 'content.draft_saved', actorDisplayName: '管理员' }))
    expect(JSON.stringify(result)).not.toContain('不得返回')
  })
})
