import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { DEFAULT_REGISTRATION_FORM, type RegistrationForm } from '@panshi/contracts'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const parsed = testDatabaseUrl ? new URL(testDatabaseUrl) : undefined
if (!testDatabaseUrl || !parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const migrationsDirectory = new URL('../drizzle/', import.meta.url)
const migration = (name: string) => readFile(new URL(name, migrationsDirectory), 'utf8')
const historicalForm: RegistrationForm = {
  ...DEFAULT_REGISTRATION_FORM,
  questions: [{
    id: '11111111-1111-4111-8111-111111111111', type: 'short_text', label: '历史已发布问题', helpText: '',
    required: true, order: 0, active: true, validation: { maxLength: 120 },
  }],
}

describe('registration form forward migration', () => {
  const pool = new Pool({ connectionString: testDatabaseUrl })
  let client: PoolClient
  let schemaName: string

  beforeAll(async () => {
    client = await pool.connect()
    schemaName = `registration_upgrade_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA "${schemaName}"`)
    await client.query(`SET search_path TO "${schemaName}"`)
  })

  afterAll(async () => {
    await client.query('SET search_path TO public')
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    client.release()
    await pool.end()
  })

  it('carries the latest pre-0007 published form into the current draft', async () => {
    for (const name of [
      '0001_initial.sql', '0002_content_publication_integrity.sql', '0003_user_display_name.sql',
      '0004_user_identity_invariants.sql', '0005_verification_code_purpose.sql', '0006_verification_delivery_state.sql',
    ]) await client.query(await migration(name))

    const olderId = '00000000-0000-4000-8000-000000000040'
    const latestId = '00000000-0000-4000-8000-000000000041'
    await client.query(
      `INSERT INTO registration_form_versions (id, schema, published_at, created_at) VALUES
       ($1, $2, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
       ($3, $4, '2026-08-02T00:00:00Z', '2026-08-02T00:00:00Z')`,
      [olderId, DEFAULT_REGISTRATION_FORM, latestId, historicalForm],
    )

    await client.query(await migration('0007_registration_form_drafts.sql'))
    await client.query(await migration('0008_registration_form_publish_revision.sql'))
    await client.query(await migration('0009_registration_form_latest_draft.sql'))

    const result = await client.query<{ schema: RegistrationForm, base_version_id: string, revision: number, published_revision: number }>(
      'SELECT schema, base_version_id, revision, published_revision FROM registration_form_drafts',
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ base_version_id: latestId, revision: 0, published_revision: 0 })
    expect(result.rows[0]?.schema.questions[0]?.label).toBe('历史已发布问题')
  })
})
