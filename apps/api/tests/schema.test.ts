import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as clientApi from '../src/db/client.js'
import { createDatabaseClient } from '../src/db/client.js'
import { applyPendingMigrations, runMigrations } from '../src/db/migrate.js'
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

const expectedPrimaryKeys = [
  { tableName: 'application_files', constraintName: 'application_files_pkey', columns: ['application_id', 'file_id'] },
  { tableName: 'application_status_history', constraintName: 'application_status_history_pkey', columns: ['id'] },
  { tableName: 'application_versions', constraintName: 'application_versions_pkey', columns: ['id'] },
  { tableName: 'applications', constraintName: 'applications_pkey', columns: ['id'] },
  { tableName: 'audit_logs', constraintName: 'audit_logs_pkey', columns: ['id'] },
  { tableName: 'content_modules', constraintName: 'content_modules_pkey', columns: ['key'] },
  { tableName: 'content_versions', constraintName: 'content_versions_pkey', columns: ['id'] },
  { tableName: 'files', constraintName: 'files_pkey', columns: ['id'] },
  { tableName: 'registration_form_versions', constraintName: 'registration_form_versions_pkey', columns: ['id'] },
  { tableName: 'resources', constraintName: 'resources_pkey', columns: ['id'] },
  { tableName: 'sessions', constraintName: 'sessions_pkey', columns: ['id'] },
  { tableName: 'system_settings', constraintName: 'system_settings_pkey', columns: ['key'] },
  { tableName: 'users', constraintName: 'users_pkey', columns: ['id'] },
  { tableName: 'verification_codes', constraintName: 'verification_codes_pkey', columns: ['id'] },
] as const

const expectedUniqueConstraints = [
  { tableName: 'applications', constraintName: 'applications_user_id_unique', columns: ['user_id'] },
  { tableName: 'content_versions', constraintName: 'content_versions_module_key_version_unique', columns: ['module_key', 'version'] },
  { tableName: 'files', constraintName: 'files_storage_key_unique', columns: ['storage_key'] },
  { tableName: 'resources', constraintName: 'resources_key_unique', columns: ['key'] },
  { tableName: 'sessions', constraintName: 'sessions_token_hash_unique', columns: ['token_hash'] },
  { tableName: 'users', constraintName: 'users_phone_normalized_unique', columns: ['phone_normalized'] },
] as const

const expectedForeignKeys = [
  { tableName: 'application_files', constraintName: 'application_files_application_id_applications_id_fk', columns: ['application_id'], referencedTableName: 'applications', referencedColumns: ['id'] },
  { tableName: 'application_files', constraintName: 'application_files_file_id_files_id_fk', columns: ['file_id'], referencedTableName: 'files', referencedColumns: ['id'] },
  { tableName: 'application_status_history', constraintName: 'application_status_history_application_id_applications_id_fk', columns: ['application_id'], referencedTableName: 'applications', referencedColumns: ['id'] },
  { tableName: 'application_status_history', constraintName: 'application_status_history_changed_by_users_id_fk', columns: ['changed_by'], referencedTableName: 'users', referencedColumns: ['id'] },
  { tableName: 'application_versions', constraintName: 'application_versions_application_id_applications_id_fk', columns: ['application_id'], referencedTableName: 'applications', referencedColumns: ['id'] },
  { tableName: 'applications', constraintName: 'applications_form_version_id_registration_form_versions_id_fk', columns: ['form_version_id'], referencedTableName: 'registration_form_versions', referencedColumns: ['id'] },
  { tableName: 'applications', constraintName: 'applications_user_id_users_id_fk', columns: ['user_id'], referencedTableName: 'users', referencedColumns: ['id'] },
  { tableName: 'audit_logs', constraintName: 'audit_logs_actor_user_id_users_id_fk', columns: ['actor_user_id'], referencedTableName: 'users', referencedColumns: ['id'] },
  { tableName: 'content_modules', constraintName: 'content_modules_published_version_id_content_versions_id_fk', columns: ['published_version_id'], referencedTableName: 'content_versions', referencedColumns: ['id'] },
  { tableName: 'content_versions', constraintName: 'content_versions_created_by_users_id_fk', columns: ['created_by'], referencedTableName: 'users', referencedColumns: ['id'] },
  { tableName: 'content_versions', constraintName: 'content_versions_module_key_content_modules_key_fk', columns: ['module_key'], referencedTableName: 'content_modules', referencedColumns: ['key'] },
  { tableName: 'resources', constraintName: 'resources_file_id_files_id_fk', columns: ['file_id'], referencedTableName: 'files', referencedColumns: ['id'] },
  { tableName: 'sessions', constraintName: 'sessions_user_id_users_id_fk', columns: ['user_id'], referencedTableName: 'users', referencedColumns: ['id'] },
  { tableName: 'system_settings', constraintName: 'system_settings_updated_by_users_id_fk', columns: ['updated_by'], referencedTableName: 'users', referencedColumns: ['id'] },
] as const

const expectedChecks = [
  { constraintName: 'application_status_history_from_status_check', tokens: ['from_status', 'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] },
  { constraintName: 'application_status_history_to_status_check', tokens: ['to_status', 'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] },
  { constraintName: 'applications_status_check', tokens: ['status', 'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] },
  { constraintName: 'content_modules_draft_revision_check', tokens: ['draft_revision', '>= 0'] },
  { constraintName: 'content_versions_version_check', tokens: ['version', '> 0'] },
  { constraintName: 'files_size_bytes_check', tokens: ['size_bytes', '>= 0'] },
  { constraintName: 'resources_access_level_check', tokens: ['access_level', 'public', 'authenticated', 'admitted'] },
  { constraintName: 'resources_sort_order_check', tokens: ['sort_order', '>= 0'] },
  { constraintName: 'users_role_check', tokens: ['role', 'user', 'admin'] },
  { constraintName: 'verification_codes_failed_attempts_check', tokens: ['failed_attempts', '>= 0'] },
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

  it('creates exactly the required domain tables', async () => {
    const tables = await pool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name <> 'panshi_schema_migrations'
      order by table_name
    `)

    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([...requiredTables].sort())
  })

  it('creates all intended primary key and unique constraints', async () => {
    const constraints = await pool.query<{
      table_name: string
      constraint_name: string
      constraint_type: 'p' | 'u'
      columns: string[]
    }>(`
      select
        relation.relname as table_name,
        constraint_record.conname as constraint_name,
        constraint_record.contype as constraint_type,
        array_agg(attribute.attname order by key_column.ordinality)::text[] as columns
      from pg_constraint constraint_record
      join pg_class relation on relation.oid = constraint_record.conrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral unnest(constraint_record.conkey) with ordinality as key_column(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attnum = key_column.attnum
      where namespace.nspname = 'public'
        and relation.relname <> 'panshi_schema_migrations'
        and constraint_record.contype in ('p', 'u')
      group by relation.relname, constraint_record.conname, constraint_record.contype
      order by relation.relname, constraint_record.conname
    `)

    const primaryKeys = constraints.rows
      .filter(({ constraint_type }) => constraint_type === 'p')
      .map(({ table_name, constraint_name, columns }) => ({ tableName: table_name, constraintName: constraint_name, columns }))
    const uniqueConstraints = constraints.rows
      .filter(({ constraint_type }) => constraint_type === 'u')
      .map(({ table_name, constraint_name, columns }) => ({ tableName: table_name, constraintName: constraint_name, columns }))

    expect(primaryKeys).toEqual(expectedPrimaryKeys)
    expect(uniqueConstraints).toEqual(expectedUniqueConstraints)
    expect(primaryKeys).toContainEqual({ tableName: 'content_modules', constraintName: 'content_modules_pkey', columns: ['key'] })
    expect(primaryKeys).toContainEqual({ tableName: 'application_files', constraintName: 'application_files_pkey', columns: ['application_id', 'file_id'] })
  })

  it('creates every intended foreign key among domain tables', async () => {
    const foreignKeys = await pool.query<{
      table_name: string
      constraint_name: string
      columns: string[]
      referenced_table_name: string
      referenced_columns: string[]
    }>(`
      select
        relation.relname as table_name,
        constraint_record.conname as constraint_name,
        array_agg(attribute.attname order by key_column.ordinality)::text[] as columns,
        referenced_relation.relname as referenced_table_name,
        array_agg(referenced_attribute.attname order by key_column.ordinality)::text[] as referenced_columns
      from pg_constraint constraint_record
      join pg_class relation on relation.oid = constraint_record.conrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      join pg_class referenced_relation on referenced_relation.oid = constraint_record.confrelid
      cross join lateral unnest(constraint_record.conkey, constraint_record.confkey)
        with ordinality as key_column(attnum, referenced_attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attnum = key_column.attnum
      join pg_attribute referenced_attribute on referenced_attribute.attrelid = referenced_relation.oid
        and referenced_attribute.attnum = key_column.referenced_attnum
      where namespace.nspname = 'public'
        and relation.relname <> 'panshi_schema_migrations'
        and constraint_record.contype = 'f'
      group by relation.relname, constraint_record.conname, referenced_relation.relname
      order by relation.relname, constraint_record.conname
    `)

    expect(foreignKeys.rows.map((row) => ({
      tableName: row.table_name,
      constraintName: row.constraint_name,
      columns: row.columns,
      referencedTableName: row.referenced_table_name,
      referencedColumns: row.referenced_columns,
    }))).toEqual(expectedForeignKeys)
  })

  it('creates every intended role, status, access, and numeric check', async () => {
    const checks = await pool.query<{ constraint_name: string, definition: string }>(`
      select
        constraint_record.conname as constraint_name,
        pg_get_expr(constraint_record.conbin, constraint_record.conrelid) as definition
      from pg_constraint constraint_record
      join pg_class relation on relation.oid = constraint_record.conrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname <> 'panshi_schema_migrations'
        and constraint_record.contype = 'c'
      order by constraint_record.conname
    `)

    expect(checks.rows.map(({ constraint_name }) => constraint_name)).toEqual(
      expectedChecks.map(({ constraintName }) => constraintName),
    )

    for (const expectedCheck of expectedChecks) {
      const actual = checks.rows.find(({ constraint_name }) => constraint_name === expectedCheck.constraintName)
      expect(actual, `missing ${expectedCheck.constraintName}`).toBeDefined()
      for (const token of expectedCheck.tokens) {
        expect(actual?.definition).toContain(token)
      }
    }
  })

  it('creates exactly the intended domain immutability triggers', async () => {
    const triggers = await pool.query<{ trigger_name: string }>(`
      select distinct trigger_name
      from information_schema.triggers
      where event_object_schema = 'public'
      order by trigger_name
    `)

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

  it('persists an application status change with its history record', async () => {
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

    await db.transaction(async (transaction) => {
      await transaction.update(applications)
        .set({ status: 'submitted' })
        .where(eq(applications.id, application.id))
      await transaction.insert(applicationStatusHistory).values({
        applicationId: application.id,
        fromStatus: 'draft',
        toStatus: 'submitted',
        changedBy: userId,
      })
    })

    const [persistedApplication] = await db.select({ status: applications.status })
      .from(applications)
      .where(eq(applications.id, application.id))
    const [persistedHistory] = await db.select({
      applicationId: applicationStatusHistory.applicationId,
      fromStatus: applicationStatusHistory.fromStatus,
      toStatus: applicationStatusHistory.toStatus,
    }).from(applicationStatusHistory)
      .where(eq(applicationStatusHistory.applicationId, application.id))

    expect(persistedApplication).toEqual({ status: 'submitted' })
    expect(persistedHistory).toEqual({ applicationId: application.id, fromStatus: 'draft', toStatus: 'submitted' })
  })

  it('cleans up the pool when migration connection acquisition fails', async () => {
    let closeCalls = 0
    const connectionError = new Error('connection unavailable')

    await expect(runMigrations({
      connect: async () => Promise.reject(connectionError),
      close: async () => {
        closeCalls += 1
      },
    })).rejects.toMatchObject({
      message: 'Database migration failed during connection or setup',
      cause: connectionError,
    })

    expect(closeCalls).toBe(1)
  })

  it('names the migration file when SQL execution fails', async () => {
    const migrationDirectory = await mkdtemp(join(tmpdir(), 'panshi-migration-test-'))
    await writeFile(join(migrationDirectory, '0002_broken.sql'), 'this is not valid SQL', 'utf8')
    const client = await pool.connect()

    try {
      await client.query('begin')
      await expect(applyPendingMigrations(client, migrationDirectory)).rejects.toMatchObject({
        message: 'Failed to apply migration 0002_broken.sql',
        cause: expect.any(Error),
      })
    } finally {
      await client.query('rollback').catch(() => undefined)
      client.release()
      await rm(migrationDirectory, { recursive: true, force: true })
    }
  })

  it('includes the migration filename in the command-level execution error', async () => {
    const migrationDirectory = await mkdtemp(join(tmpdir(), 'panshi-migration-command-test-'))
    await writeFile(join(migrationDirectory, '0002_broken.sql'), 'this is not valid SQL', 'utf8')
    const migrationDatabase = createDatabaseClient(testDatabaseUrl)

    try {
      await expect(runMigrations({
        connect: () => migrationDatabase.pool.connect(),
        close: migrationDatabase.close,
      }, migrationDirectory)).rejects.toMatchObject({
        message: 'Database migration failed during execution: Failed to apply migration 0002_broken.sql',
        cause: expect.objectContaining({ message: 'Failed to apply migration 0002_broken.sql' }),
      })
    } finally {
      await rm(migrationDirectory, { recursive: true, force: true })
    }
  })

  it('names the migration file when its applied checksum differs', async () => {
    const client = await pool.connect()

    try {
      await client.query('begin')
      await client.query(`update panshi_schema_migrations set sha256 = 'invalid-for-test' where name = '0001_initial.sql'`)
      await expect(applyPendingMigrations(client)).rejects.toMatchObject({
        message: 'Failed to apply migration 0001_initial.sql',
        cause: expect.objectContaining({ message: 'Applied migration checksum differs from the checked-in file' }),
      })
    } finally {
      await client.query('rollback').catch(() => undefined)
      client.release()
    }
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
