import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_REGISTRATION_FORM, type JsonObject } from '@panshi/contracts'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { applications, auditLogs, checkInCredentials, checkIns, registrationFormVersions, users } from '../src/db/schema.js'
import { createCheckInRepository } from '../src/modules/check-in/check-in.repository.js'
import { createCheckInService } from '../src/modules/check-in/check-in.service.js'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).pathname !== '/panshi_ai4s_camp_test') throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
const database = createDatabaseClient(url)
const admin = { id: '10000000-0000-4000-8000-000000000001', displayName: '会务组01', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'admin' as const, disabledAt: null }
const student = { id: '10000000-0000-4000-8000-000000000002', displayName: '郑博元', phoneNormalized: '+8618811132625', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const applicationId = '30000000-0000-4000-8000-000000000001'
const profile = {
  name: '郑博元', phone: student.phoneNormalized, email: '', organization: '中国科学院大学', department: '中国科学院物理研究所',
  identityType: '博士研究生', educationStage: '博士研究生', majorResearchDirection: '凝聚态物理', major: '物理学', researchInterest: '',
  researchDirection: '凝聚态物理', postdocStation: '', disciplineField: '', supervisor: '', jobPosition: '', professionalTitleLevel: '', specificTitle: '', identityDescription: '',
}

describe('check-in PostgreSQL workflow', () => {
  beforeAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
  })

  beforeEach(async () => {
    await database.pool.query('TRUNCATE check_ins, check_in_credentials, applications, registration_form_versions, audit_logs, sessions, users CASCADE')
    await database.db.insert(users).values([admin, student])
    const [version] = await database.db.insert(registrationFormVersions).values({ version: 1, schema: DEFAULT_REGISTRATION_FORM as unknown as JsonObject, createdBy: admin.id, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
    await database.db.insert(applications).values({ id: applicationId, userId: student.id, formVersionId: version!.id, status: 'admitted', revision: 4, coreFields: profile, answers: {}, submittedAt: new Date('2026-08-18T00:00:00Z') })
  })

  afterAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await database.close()
  })

  it('issues, confirms once, reports duplicates, revokes, and reconfirms with an audit trail', async () => {
    const service = createCheckInService(createCheckInRepository(database.db, {
      now: (() => {
        const values = [
          new Date('2026-09-04T00:30:00Z'), new Date('2026-09-04T01:00:00Z'),
          new Date('2026-09-04T02:00:00Z'), new Date('2026-09-04T03:00:00Z'),
        ]
        return () => values.shift() ?? new Date('2026-09-04T04:00:00Z')
      })(),
      createPublicId: () => '20000000-0000-4000-8000-000000000001',
    }), { tokenSecret: '55'.repeat(32) })

    const issued = await service.getStudentCredential(student)
    expect(issued.data).toMatchObject({ availability: 'available', displayCode: '20000000' })
    if (issued.data.availability === 'unavailable') throw new Error('credential was not issued')

    const lookup = await service.lookup(admin, { code: issued.data.qrPayload })
    expect(lookup.data).toMatchObject({ name: '郑博元', checkInState: 'not_checked_in', revision: 0 })

    const confirmed = await service.confirm(admin, lookup.data.credentialId, { expectedRevision: lookup.data.revision })
    expect(confirmed.data).toMatchObject({ checkInState: 'checked_in', duplicate: false, revision: 0, firstCheckedInAt: '2026-09-04T01:00:00.000Z' })

    const duplicate = await service.confirm(admin, lookup.data.credentialId, { expectedRevision: 0 })
    expect(duplicate.data).toMatchObject({ checkInState: 'checked_in', duplicate: true, firstCheckedInAt: confirmed.data.firstCheckedInAt })
    await service.lookup(admin, { code: issued.data.qrPayload })

    const revoked = await service.revoke(admin, lookup.data.credentialId, { expectedRevision: confirmed.data.revision, reason: '现场误操作' })
    expect(revoked.data).toMatchObject({ checkInState: 'revoked', revision: 1, revokeReason: '现场误操作' })

    const reconfirmed = await service.confirm(admin, lookup.data.credentialId, { expectedRevision: revoked.data.revision })
    expect(reconfirmed.data).toMatchObject({ checkInState: 'checked_in', duplicate: false, revision: 2, firstCheckedInAt: confirmed.data.firstCheckedInAt })

    expect(await database.db.select().from(checkInCredentials)).toHaveLength(1)
    expect(await database.db.select().from(checkIns)).toHaveLength(1)
    expect((await database.db.select().from(auditLogs)).map((row) => row.action)).toEqual([
      'check_in.credential_issued', 'check_in.confirmed', 'check_in.repeated_lookup', 'check_in.revoked', 'check_in.reconfirmed',
    ])
  })
})
