import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabaseClient } from '../src/db/client.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const parsedTestDatabaseUrl = testDatabaseUrl ? new URL(testDatabaseUrl) : undefined
if (!testDatabaseUrl || !parsedTestDatabaseUrl
  || !['postgres:', 'postgresql:'].includes(parsedTestDatabaseUrl.protocol)
  || parsedTestDatabaseUrl.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const database = createDatabaseClient(testDatabaseUrl)
const migrationsDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url))
const migration = (name: string) => readFile(`${migrationsDirectory}${name}`, 'utf8')

describe('0003 user display name forward migration', () => {
  afterAll(async () => database.close())

  it('backfills populated pre-0003 users and makes display_name NOT NULL in an isolated schema', async () => {
    const schemaName = `migration_test_${randomUUID().replaceAll('-', '')}`
    const client = await database.pool.connect()
    try {
      await client.query('begin')
      await client.query(`create schema "${schemaName}"`)
      await client.query(`set local search_path to "${schemaName}", public`)
      await client.query(await migration('0001_initial.sql'))
      await client.query(await migration('0002_content_publication_integrity.sql'))
      const inserted = await client.query<{ id: string }>(`
        insert into users (phone_normalized, password_hash, role)
        values ('+8613800138000', 'pre-migration-hash', 'admin')
        returning id
      `)

      await client.query(await migration('0003_user_display_name.sql'))

      const migrated = await client.query<{ display_name: string }>(
        'select display_name from users where id = $1',
        [inserted.rows[0]!.id],
      )
      const column = await client.query<{ is_nullable: string }>(`
        select is_nullable
        from information_schema.columns
        where table_schema = $1 and table_name = 'users' and column_name = 'display_name'
      `, [schemaName])
      expect(migrated.rows).toEqual([{ display_name: '+8613800138000' }])
      expect(column.rows).toEqual([{ is_nullable: 'NO' }])
    } finally {
      await client.query('rollback')
      client.release()
    }
  })
})
