import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as clientApi from '../src/db/client.js'
import { createDatabaseClient } from '../src/db/client.js'
import {
  applicationStatusHistory,
  applications,
  auditLogs,
  contentModules,
  contentVersions,
  registrationFormVersions,
  users,
} from '../src/db/schema.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const parsedTestDatabaseUrl = new URL(testDatabaseUrl)
const testDatabaseName = parsedTestDatabaseUrl.pathname.slice(1)

if (!/^panshi_ai4s_camp(?:_[a-z0-9]+)*_test$/u.test(testDatabaseName)) {
  throw new Error('TEST_DATABASE_URL must target a dedicated panshi_ai4s_camp_*_test database')
}

const { db, pool, close } = createDatabaseClient(testDatabaseUrl)

const requiredTables = [
  'application_files',
  'application_status_history',
  'application_versions',
  'applications',
  'audit_logs',
  'content_modules',
  'content_versions',
  'files',
  'registration_form_versions',
  'resources',
  'sessions',
  'system_settings',
  'users',
  'verification_codes',
] as const

const createUser = async () => {
  const [user] = await db.insert(users).values({
    phoneNormalized: `+8613${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0')}`,
    passwordHash: 'test-password-hash',
    role: 'user',
  }).returning({ id: users.id })

  if (!user) {
    throw new Error('Failed to create test user')
  }

  return user.id
}

const createFormVersion = async () => {
  const [formVersion] = await db.insert(registrationFormVersions).values({
    schema: { fields: [] },
    publishedAt: new Date(),
  }).returning({ id: registrationFormVersions.id })

  if (!formVersion) {
    throw new Error('Failed to create registration form version')
  }

  return formVersion.id
}

describe('initial PostgreSQL schema', () => {
  beforeAll(async () => {
    const result = await pool.query<{ current_database: string }>('select current_database()')
    expect(result.rows[0]?.current_database).toBe(testDatabaseName)
  })

  beforeEach(async () => {
    await pool.query(`truncate table ${requiredTables.map((table) => `"${table}"`).join(', ')} cascade`)
  })

  afterAll(async () => {
    await close()
  })

  it('creates every required table and database enforcement object', async () => {
    const tables = await pool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name
    `, [requiredTables])

    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([...requiredTables].sort())

    const constraints = await pool.query<{ conname: string }>(`
      select conname
      from pg_constraint
      where conname = any($1::text[])
      order by conname
    `, [[
      'applications_form_version_id_registration_form_versions_id_fk',
      'applications_user_id_unique',
      'content_modules_published_version_id_content_versions_id_fk',
      'users_phone_normalized_unique',
    ]])

    expect(constraints.rows.map(({ conname }) => conname)).toEqual([
      'applications_form_version_id_registration_form_versions_id_fk',
      'applications_user_id_unique',
      'content_modules_published_version_id_content_versions_id_fk',
      'users_phone_normalized_unique',
    ])

    const triggers = await pool.query<{ trigger_name: string }>(`
      select distinct trigger_name
      from information_schema.triggers
      where event_object_schema = 'public'
        and trigger_name = any($1::text[])
      order by trigger_name
    `, [['audit_logs_append_only', 'content_versions_immutable']])

    expect(triggers.rows.map(({ trigger_name }) => trigger_name)).toEqual([
      'audit_logs_append_only',
      'content_versions_immutable',
    ])
  })

  it('requires unique normalized phone numbers', async () => {
    const phoneNormalized = '+8613800000000'
    await db.insert(users).values({ phoneNormalized, passwordHash: 'hash-one', role: 'user' })

    await expect(db.insert(users).values({
      phoneNormalized,
      passwordHash: 'hash-two',
      role: 'user',
    })).rejects.toThrow()
  })

  it('rejects a second application for the same user', async () => {
    const userId = await createUser()
    const formVersionId = await createFormVersion()

    await db.insert(applications).values({ userId, status: 'draft', formVersionId })
    await expect(db.insert(applications).values({ userId, status: 'draft', formVersionId })).rejects.toThrow()
  })

  it('rejects UPDATE and DELETE for immutable content versions', async () => {
    const createdBy = await createUser()
    await db.insert(contentModules).values({ key: 'basic' })
    const [version] = await db.insert(contentVersions).values({
      moduleKey: 'basic',
      version: 1,
      payload: { title: 'Original' },
      createdBy,
    }).returning({ id: contentVersions.id })

    if (!version) {
      throw new Error('Failed to create content version')
    }

    await expect(pool.query(
      'update content_versions set payload = $1 where id = $2',
      [{ title: 'Changed' }, version.id],
    )).rejects.toThrow(/immutable/iu)
    await expect(pool.query(
      'delete from content_versions where id = $1',
      [version.id],
    )).rejects.toThrow(/immutable/iu)
  })

  it('requires applications to reference a published registration form version', async () => {
    const userId = await createUser()

    await expect(db.insert(applications).values({
      userId,
      status: 'draft',
      formVersionId: randomUUID(),
    })).rejects.toThrow()
  })

  it('records application status transitions tied to an application', async () => {
    const userId = await createUser()
    const formVersionId = await createFormVersion()
    const [application] = await db.insert(applications).values({
      userId,
      formVersionId,
      status: 'draft',
    }).returning({ id: applications.id })

    if (!application) {
      throw new Error('Failed to create application')
    }

    const [transition] = await db.insert(applicationStatusHistory).values({
      applicationId: application.id,
      fromStatus: 'draft',
      toStatus: 'submitted',
      changedBy: userId,
    }).returning()

    expect(transition).toMatchObject({
      applicationId: application.id,
      fromStatus: 'draft',
      toStatus: 'submitted',
    })
  })

  it('keeps audit logs append-only and exports no update helper', async () => {
    expect(clientApi).not.toHaveProperty('updateAuditLog')
    expect(clientApi).not.toHaveProperty('deleteAuditLog')

    const [log] = await db.insert(auditLogs).values({
      action: 'application.created',
      entityType: 'application',
      entityId: randomUUID(),
      metadata: { source: 'schema-test' },
    }).returning({ id: auditLogs.id })

    if (!log) {
      throw new Error('Failed to create audit log')
    }

    await expect(pool.query(
      'update audit_logs set action = $1 where id = $2',
      ['application.changed', log.id],
    )).rejects.toThrow(/append-only/iu)
    await expect(pool.query(
      'delete from audit_logs where id = $1',
      [log.id],
    )).rejects.toThrow(/append-only/iu)
  })
})
