import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

const requireDedicatedTestDatabaseUrl = (value: string | undefined) => {
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required for database integration tests')
  }

  const parsed = new URL(value)
  if (parsed.pathname !== '/panshi_ai4s_camp_test') {
    throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
  }

  return parsed
}

const parsedTestDatabaseUrl = requireDedicatedTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const testDatabaseUrl = parsedTestDatabaseUrl.toString()
const testDatabaseName = parsedTestDatabaseUrl.pathname.slice(1)

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
  'registration_form_drafts',
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
  { tableName: 'registration_form_drafts', constraintName: 'registration_form_drafts_pkey', columns: ['id'] },
  { tableName: 'registration_form_versions', constraintName: 'registration_form_versions_pkey', columns: ['id'] },
  { tableName: 'resources', constraintName: 'resources_pkey', columns: ['id'] },
  { tableName: 'sessions', constraintName: 'sessions_pkey', columns: ['id'] },
  { tableName: 'system_settings', constraintName: 'system_settings_pkey', columns: ['key'] },
  { tableName: 'users', constraintName: 'users_pkey', columns: ['id'] },
  { tableName: 'verification_codes', constraintName: 'verification_codes_pkey', columns: ['id'] },
] as const

const expectedUniqueConstraints = [
  { tableName: 'applications', constraintName: 'applications_user_id_unique', columns: ['user_id'] },
  { tableName: 'content_versions', constraintName: 'content_versions_module_key_id_unique', columns: ['module_key', 'id'] },
  { tableName: 'content_versions', constraintName: 'content_versions_module_key_version_unique', columns: ['module_key', 'version'] },
  { tableName: 'files', constraintName: 'files_storage_key_unique', columns: ['storage_key'] },
  { tableName: 'registration_form_versions', constraintName: 'registration_form_versions_version_unique', columns: ['version'] },
  { tableName: 'resources', constraintName: 'resources_key_unique', columns: ['key'] },
  { tableName: 'sessions', constraintName: 'sessions_token_hash_unique', columns: ['token_hash'] },
  { tableName: 'users', constraintName: 'users_phone_normalized_unique', columns: ['phone_normalized'] },
] as const

const expectedForeignKeys = [
  { tableName: 'application_files', constraintName: 'application_files_application_id_applications_id_fk', columns: ['application_id'], referencedTableName: 'applications', referencedColumns: ['id'], deleteAction: 'cascade' },
  { tableName: 'application_files', constraintName: 'application_files_file_id_files_id_fk', columns: ['file_id'], referencedTableName: 'files', referencedColumns: ['id'], deleteAction: 'restrict' },
  { tableName: 'application_status_history', constraintName: 'application_status_history_application_id_applications_id_fk', columns: ['application_id'], referencedTableName: 'applications', referencedColumns: ['id'], deleteAction: 'cascade' },
  { tableName: 'application_status_history', constraintName: 'application_status_history_changed_by_users_id_fk', columns: ['changed_by'], referencedTableName: 'users', referencedColumns: ['id'], deleteAction: 'set null' },
  { tableName: 'application_versions', constraintName: 'application_versions_application_id_applications_id_fk', columns: ['application_id'], referencedTableName: 'applications', referencedColumns: ['id'], deleteAction: 'cascade' },
  { tableName: 'applications', constraintName: 'applications_form_version_id_registration_form_versions_id_fk', columns: ['form_version_id'], referencedTableName: 'registration_form_versions', referencedColumns: ['id'], deleteAction: 'restrict' },
  { tableName: 'applications', constraintName: 'applications_user_id_users_id_fk', columns: ['user_id'], referencedTableName: 'users', referencedColumns: ['id'], deleteAction: 'restrict' },
  { tableName: 'audit_logs', constraintName: 'audit_logs_actor_user_id_users_id_fk', columns: ['actor_user_id'], referencedTableName: 'users', referencedColumns: ['id'], deleteAction: 'restrict' },
  { tableName: 'content_modules', constraintName: 'content_modules_published_version_content_versions_fk', columns: ['key', 'published_version_id'], referencedTableName: 'content_versions', referencedColumns: ['module_key', 'id'], deleteAction: 'restrict' },
  { tableName: 'content_versions', constraintName: 'content_versions_created_by_users_id_fk', columns: ['created_by'], referencedTableName: 'users', referencedColumns: ['id'], deleteAction: 'restrict' },
  { tableName: 'content_versions', constraintName: 'content_versions_module_key_content_modules_key_fk', columns: ['module_key'], referencedTableName: 'content_modules', referencedColumns: ['key'], deleteAction: 'restrict' },
  { tableName: 'registration_form_drafts', constraintName: 'registration_form_drafts_base_version_fk', columns: ['base_version_id'], referencedTableName: 'registration_form_versions', referencedColumns: ['id'], deleteAction: 'restrict' },
  { tableName: 'registration_form_drafts', constraintName: 'registration_form_drafts_updated_by_users_id_fk', columns: ['updated_by'], referencedTableName: 'users', referencedColumns: ['id'], deleteAction: 'set null' },
  { tableName: 'registration_form_versions', constraintName: 'registration_form_versions_created_by_users_id_fk', columns: ['created_by'], referencedTableName: 'users', referencedColumns: ['id'], deleteAction: 'restrict' },
  { tableName: 'resources', constraintName: 'resources_file_id_files_id_fk', columns: ['file_id'], referencedTableName: 'files', referencedColumns: ['id'], deleteAction: 'restrict' },
  { tableName: 'sessions', constraintName: 'sessions_user_id_users_id_fk', columns: ['user_id'], referencedTableName: 'users', referencedColumns: ['id'], deleteAction: 'cascade' },
  { tableName: 'system_settings', constraintName: 'system_settings_updated_by_users_id_fk', columns: ['updated_by'], referencedTableName: 'users', referencedColumns: ['id'], deleteAction: 'set null' },
] as const

const expectedChecks = [
  { constraintName: 'application_status_history_from_status_check', tokens: ['from_status', 'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] },
  { constraintName: 'application_status_history_to_status_check', tokens: ['to_status', 'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] },
  { constraintName: 'applications_status_check', tokens: ['status', 'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] },
  { constraintName: 'content_modules_draft_revision_check', tokens: ['draft_revision', '>= 0'] },
  { constraintName: 'content_versions_version_check', tokens: ['version', '> 0'] },
  { constraintName: 'files_size_bytes_check', tokens: ['size_bytes', '>= 0'] },
  { constraintName: 'registration_form_drafts_published_revision_check', tokens: ['published_revision', '>= 0'] },
  { constraintName: 'registration_form_drafts_revision_check', tokens: ['revision', '>= 0'] },
  { constraintName: 'registration_form_versions_version_check', tokens: ['version', '> 0'] },
  { constraintName: 'resources_access_level_check', tokens: ['access_level', 'public', 'authenticated', 'admitted'] },
  { constraintName: 'resources_sort_order_check', tokens: ['sort_order', '>= 0'] },
  { constraintName: 'users_display_name_check', tokens: ['display_name', 'btrim'] },
  { constraintName: 'users_phone_normalized_check', tokens: ['phone_normalized', '+861', '[3-9]'] },
  { constraintName: 'users_role_check', tokens: ['role', 'user', 'admin'] },
  { constraintName: 'verification_codes_delivery_state_check', tokens: ['delivery_state', 'pending', 'sent', 'failed'] },
  { constraintName: 'verification_codes_failed_attempts_check', tokens: ['failed_attempts', '>= 0'] },
  { constraintName: 'verification_codes_purpose_check', tokens: ['purpose', 'register', 'reset_password'] },
] as const

const createUser = async () => {
  const [user] = await db.insert(users).values({
    displayName: '测试用户',
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
    version: 1,
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
      delete_action: string
    }>(`
      select
        relation.relname as table_name,
        constraint_record.conname as constraint_name,
        array_agg(attribute.attname order by key_column.ordinality)::text[] as columns,
        referenced_relation.relname as referenced_table_name,
        array_agg(referenced_attribute.attname order by key_column.ordinality)::text[] as referenced_columns,
        case constraint_record.confdeltype
          when 'a' then 'no action'
          when 'r' then 'restrict'
          when 'c' then 'cascade'
          when 'n' then 'set null'
          when 'd' then 'set default'
        end as delete_action
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
      group by relation.relname, constraint_record.conname, referenced_relation.relname, constraint_record.confdeltype
      order by relation.relname, constraint_record.conname
    `)

    expect(foreignKeys.rows.map((row) => ({
      tableName: row.table_name,
      constraintName: row.constraint_name,
      columns: row.columns,
      referencedTableName: row.referenced_table_name,
      referencedColumns: row.referenced_columns,
      deleteAction: row.delete_action,
    }))).toEqual(expectedForeignKeys)
  })

  it('refuses destructive test database names before creating a client', () => {
    for (const unsafeName of [
      'postgres',
      'panshi_ai4s_camp',
      'panshi_ai4s_camp_ci_test',
      'panshi_ai4s_camp_test_copy',
    ]) {
      expect(() => requireDedicatedTestDatabaseUrl(
        `postgresql://localhost:5432/${unsafeName}`,
      )).toThrow('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
    }
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

  it('uses descending partial indexes for verification delivery and sent-code lookup', async () => {
    const indexes = await pool.query<{ indexname: string, indexdef: string }>(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'verification_codes'
        and indexname <> 'verification_codes_pkey'
      order by indexname
    `)

    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      'verification_codes_phone_active_created_idx',
      'verification_codes_phone_purpose_sent_created_idx',
    ])
    const active = indexes.rows.find(({ indexname }) => indexname === 'verification_codes_phone_active_created_idx')?.indexdef
    const sent = indexes.rows.find(({ indexname }) => indexname === 'verification_codes_phone_purpose_sent_created_idx')?.indexdef
    expect(active).toMatch(/phone_normalized, created_at DESC.*delivery_state.*pending.*sent/iu)
    expect(sent).toMatch(/phone_normalized, purpose, created_at DESC.*delivery_state.*sent/iu)
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
      'registration_form_versions_immutable',
    ])
  })

  it('requires unique normalized phone numbers', async () => {
    const phoneNormalized = '+8613800000000'
    await db.insert(users).values({ displayName: '用户一', phoneNormalized, passwordHash: 'hash-one', role: 'user' })

    await expect(db.insert(users).values({
      displayName: '用户二',
      phoneNormalized,
      passwordHash: 'hash-two',
      role: 'user',
    })).rejects.toThrow()
  })

  it.each([
    { displayName: '用户', phoneNormalized: '+8610123456789' },
    { displayName: '用户', phoneNormalized: '+8612800138000' },
    { displayName: '用户', phoneNormalized: '13800138000' },
    { displayName: '   ', phoneNormalized: '+8613800138000' },
  ])('rejects a user that cannot satisfy the shared profile invariant: $phoneNormalized', async (invalid) => {
    await expect(db.insert(users).values({
      ...invalid,
      passwordHash: 'test-password-hash',
      role: 'user',
    })).rejects.toThrow()
  })

  it('adds a required display name through a forward migration', async () => {
    const columns = await pool.query<{ column_name: string, is_nullable: string }>(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'display_name'
    `)
    expect(columns.rows).toEqual([{ column_name: 'display_name', is_nullable: 'NO' }])
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

  it('allows publishing only a version belonging to the same content module', async () => {
    const createdBy = await createUser()
    await db.insert(contentModules).values([{ key: 'basic' }, { key: 'features' }])
    const [basicVersion] = await db.insert(contentVersions).values({
      moduleKey: 'basic',
      version: 1,
      payload: { title: 'Basic' },
      createdBy,
    }).returning({ id: contentVersions.id })
    const [featuresVersion] = await db.insert(contentVersions).values({
      moduleKey: 'features',
      version: 1,
      payload: { title: 'Features' },
      createdBy,
    }).returning({ id: contentVersions.id })

    if (!basicVersion || !featuresVersion) {
      throw new Error('Failed to create content versions')
    }

    await expect(db.update(contentModules)
      .set({ publishedVersionId: basicVersion.id })
      .where(eq(contentModules.key, 'features'))).rejects.toThrow()

    await db.update(contentModules)
      .set({ publishedVersionId: basicVersion.id })
      .where(eq(contentModules.key, 'basic'))
    const [publishedModule] = await db.select({ publishedVersionId: contentModules.publishedVersionId })
      .from(contentModules)
      .where(eq(contentModules.key, 'basic'))

    expect(publishedModule).toEqual({ publishedVersionId: basicVersion.id })
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

  it('keeps every stable migration hash across repeated runs', async () => {
    const migrateOnce = async () => {
      const migrationDatabase = createDatabaseClient(testDatabaseUrl)
      await runMigrations({
        connect: () => migrationDatabase.pool.connect(),
        close: migrationDatabase.close,
      })
      return pool.query<{ name: string, sha256: string }>(
        'select name, sha256 from panshi_schema_migrations order by name',
      )
    }

    const firstRun = await migrateOnce()
    const secondRun = await migrateOnce()

    expect(firstRun.rows.map(({ name }) => name)).toEqual([
      '0001_initial.sql',
      '0002_content_publication_integrity.sql',
      '0003_user_display_name.sql',
      '0004_user_identity_invariants.sql',
      '0005_verification_code_purpose.sql',
      '0006_verification_delivery_state.sql',
      '0007_registration_form_drafts.sql',
      '0008_registration_form_publish_revision.sql',
    ])
    expect(secondRun.rows).toEqual(firstRun.rows)
    for (const migration of secondRun.rows) {
      expect(migration.sha256).toMatch(/^[a-f0-9]{64}$/u)
    }
  })

  it('backfills old verification records as sent before defaulting new records to pending', async () => {
    const migration = await readFile(new URL('../drizzle/0006_verification_delivery_state.sql', import.meta.url), 'utf8')
    const schemaName = `verification_migration_${randomUUID().replaceAll('-', '')}`
    const client = await pool.connect()
    try {
      await client.query(`create schema "${schemaName}"`)
      await client.query(`set search_path to "${schemaName}"`)
      await client.query(`
        create table verification_codes (
          id uuid primary key,
          phone_normalized text not null,
          purpose text not null,
          created_at timestamptz not null
        );
        create index verification_codes_phone_purpose_created_idx
          on verification_codes (phone_normalized, purpose, created_at desc);
        create index verification_codes_phone_created_idx
          on verification_codes (phone_normalized, created_at desc);
        insert into verification_codes (id, phone_normalized, purpose, created_at)
          values ('00000000-0000-0000-0000-000000000001', '+8613800138000', 'register', now());
      `)
      await client.query(migration)
      await client.query(`
        insert into verification_codes (id, phone_normalized, purpose, created_at)
          values ('00000000-0000-0000-0000-000000000002', '+8613900139000', 'register', now());
      `)
      const states = await client.query<{ id: string, delivery_state: string }>(
        'select id, delivery_state from verification_codes order by id',
      )
      expect(states.rows.map(({ delivery_state }) => delivery_state)).toEqual(['sent', 'pending'])
    } finally {
      await client.query('set search_path to public')
      await client.query(`drop schema if exists "${schemaName}" cascade`)
      client.release()
    }
  })

  it('preserves immutable audit attribution by requiring user soft deletion', async () => {
    const actorUserId = await createUser()
    const [log] = await db.insert(auditLogs).values({
      actorUserId,
      action: 'application.reviewed',
      entityType: 'application',
      entityId: randomUUID(),
    }).returning({ id: auditLogs.id, actorUserId: auditLogs.actorUserId })

    if (!log) {
      throw new Error('Failed to create audit log')
    }

    await expect(db.delete(users).where(eq(users.id, actorUserId))).rejects.toThrow()

    const disabledAt = new Date()
    await db.update(users).set({ disabledAt }).where(eq(users.id, actorUserId))
    const [disabledUser] = await db.select({ disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, actorUserId))
    const [preservedLog] = await db.select({ actorUserId: auditLogs.actorUserId })
      .from(auditLogs)
      .where(eq(auditLogs.id, log.id))

    expect(disabledUser?.disabledAt?.getTime()).toBe(disabledAt.getTime())
    expect(preservedLog).toEqual({ actorUserId })
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
