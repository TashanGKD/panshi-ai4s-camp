import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { DEFAULT_REGISTRATION_FORM, type RegistrationForm } from '@panshi/contracts'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { applications, auditLogs, registrationFormDrafts, registrationFormVersions, users } from '../src/db/schema.js'
import { createRegistrationFormRepository } from '../src/modules/registration/form.repository.js'
import { createRegistrationFormService } from '../src/modules/registration/form.service.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const parsed = testDatabaseUrl ? new URL(testDatabaseUrl) : undefined
if (!testDatabaseUrl || !parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const database = createDatabaseClient(testDatabaseUrl)
const adminId = '00000000-0000-4000-8000-000000000030'
const studentId = '00000000-0000-4000-8000-000000000031'
const versionForm = (label: string): RegistrationForm => ({
  ...DEFAULT_REGISTRATION_FORM,
  questions: [{ id: '11111111-1111-4111-8111-111111111111', type: 'short_text', label, helpText: '', required: true, order: 0, active: true, validation: {} }],
})

describe('registration form PostgreSQL integration', () => {
  let migrationSeed: RegistrationForm | undefined
  beforeAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
    const [seed] = await database.db.select({ schema: registrationFormDrafts.schema }).from(registrationFormDrafts)
    migrationSeed = seed?.schema as RegistrationForm | undefined
  })
  beforeEach(async () => {
    await database.pool.query('TRUNCATE applications, registration_form_drafts, registration_form_versions, audit_logs, users CASCADE')
    await database.db.insert(registrationFormDrafts).values({ id: '00000000-0000-4000-8000-000000000010', schema: DEFAULT_REGISTRATION_FORM })
    await database.db.insert(users).values([
      { id: adminId, displayName: '管理员', phoneNormalized: '+8613800138000', passwordHash: 'unused', role: 'admin' },
      { id: studentId, displayName: '学员', phoneNormalized: '+8613900139000', passwordHash: 'unused', role: 'user' },
    ])
  })
  afterAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await database.close()
  })

  it('seeds one deterministic default attachment and audit metadata excludes question text', async () => {
    expect(migrationSeed?.attachments).toEqual([expect.objectContaining({ id: '00000000-0000-4000-8000-000000000001', required: false })])
    const service = createRegistrationFormService(createRegistrationFormRepository(database.db))
    const draft = await service.getDraft()
    expect(draft.data.form.attachments).toEqual([expect.objectContaining({ id: '00000000-0000-4000-8000-000000000001', required: false })])
    await database.db.update(registrationFormDrafts).set({ schema: versionForm('private question text') })
    await service.publish(0, adminId)
    const logs = await database.db.select().from(auditLogs)
    expect(JSON.stringify(logs)).not.toContain('private question text')
  })

  it('keeps an application bound to v1 after v2 is published', async () => {
    const repository = createRegistrationFormRepository(database.db)
    const service = createRegistrationFormService(repository)
    await service.saveDraft(versionForm('v1 question'), 0, adminId)
    const v1 = (await service.publish(1, adminId)).data.formVersionId
    await database.db.insert(applications).values({ userId: studentId, formVersionId: v1, status: 'submitted' })
    await service.saveDraft(versionForm('v2 question'), 1, adminId)
    await service.publish(2, adminId)
    const [application] = await database.db.select({ formVersionId: applications.formVersionId }).from(applications).where(eq(applications.userId, studentId))
    const [boundForm] = await database.db.select({ schema: registrationFormVersions.schema }).from(registrationFormVersions).where(eq(registrationFormVersions.id, application!.formVersionId))
    expect((boundForm?.schema as RegistrationForm).questions[0]?.label).toBe('v1 question')
  })

  it('rejects update and delete of published versions in the database', async () => {
    const service = createRegistrationFormService(createRegistrationFormRepository(database.db))
    const v1 = (await service.publish(0, adminId)).data.formVersionId
    await expect(database.pool.query('UPDATE registration_form_versions SET schema = $1 WHERE id = $2', [DEFAULT_REGISTRATION_FORM, v1])).rejects.toThrow(/immutable/iu)
    await expect(database.pool.query('DELETE FROM registration_form_versions WHERE id = $1', [v1])).rejects.toThrow(/immutable/iu)
  })

  it('publishes a saved draft once under concurrent PostgreSQL calls', async () => {
    const service = createRegistrationFormService(createRegistrationFormRepository(database.db))
    const results = await Promise.allSettled([
      service.publish(0, adminId),
      service.publish(0, adminId),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toMatchObject({ name: 'RegistrationFormConflictError' })
    await expect(service.publish(0, adminId)).rejects.toMatchObject({ name: 'RegistrationFormConflictError' })

    const versions = await database.db.select({ version: registrationFormVersions.version }).from(registrationFormVersions)
    expect(versions).toEqual([{ version: 1 }])
  })
})
