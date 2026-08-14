import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const parsed = testDatabaseUrl ? new URL(testDatabaseUrl) : undefined
if (!testDatabaseUrl || !parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const migrationsDirectory = new URL('../drizzle/', import.meta.url)
const migration = (name: string) => readFile(new URL(name, migrationsDirectory), 'utf8')

describe('secure file metadata forward migration', () => {
  const pool = new Pool({ connectionString: testDatabaseUrl })
  let client: PoolClient
  let schemaName: string

  beforeAll(async () => {
    client = await pool.connect()
    schemaName = `file_upgrade_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA "${schemaName}"`)
    await client.query(`SET search_path TO "${schemaName}"`)
  })

  afterAll(async () => {
    await client.query('SET search_path TO public')
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    client.release()
    await pool.end()
  })

  it('preserves pre-0010 files as private legacy metadata and enforces new bounds', async () => {
    for (const name of [
      '0001_initial.sql', '0002_content_publication_integrity.sql', '0003_user_display_name.sql',
      '0004_user_identity_invariants.sql', '0005_verification_code_purpose.sql', '0006_verification_delivery_state.sql',
      '0007_registration_form_drafts.sql', '0008_registration_form_publish_revision.sql', '0009_registration_form_latest_draft.sql',
    ]) await client.query(await migration(name))

    const id = '00000000-0000-4000-8000-000000000190'
    const deletedId = '00000000-0000-4000-8000-000000000191'
    await client.query(
      `INSERT INTO files (id, storage_key, original_name, mime_type, size_bytes, sha256)
       VALUES ($1, 'aa/bb/legacy', 'legacy.pdf', 'application/pdf', 10, $3),
              ($2, 'aa/bb/deleted', 'deleted.pdf', 'application/pdf', 10, $3)`,
      [id, deletedId, 'a'.repeat(64)],
    )
    await client.query(await migration('0010_secure_file_metadata.sql'))
    await client.query('UPDATE files SET deleted_at = now() WHERE id = $1', [deletedId])
    await client.query(await migration('0011_recoverable_file_lifecycle.sql'))

    const result = await client.query(
      'SELECT uploaded_by, owner_user_id, purpose, visibility, attachment_slot, hidden_at, deleted_at, lifecycle_state, delete_failure_code FROM files WHERE id = $1',
      [id],
    )
    expect(result.rows[0]).toEqual({
      uploaded_by: null,
      owner_user_id: null,
      purpose: 'legacy',
      visibility: 'owner_admin',
      attachment_slot: null,
      hidden_at: null,
      deleted_at: null,
      lifecycle_state: 'active',
      delete_failure_code: null,
    })
    expect((await client.query('SELECT lifecycle_state, deleted_at FROM files WHERE id = $1', [deletedId])).rows[0])
      .toEqual({ lifecycle_state: 'deleted', deleted_at: expect.any(Date) })
    await expect(client.query("UPDATE files SET visibility = 'world' WHERE id = $1", [id])).rejects.toThrow()
    await expect(client.query("UPDATE files SET attachment_slot = '../resume' WHERE id = $1", [id])).rejects.toThrow()
    await expect(client.query("UPDATE files SET lifecycle_state = 'delete_failed' WHERE id = $1", [id])).rejects.toThrow()
    await expect(client.query("UPDATE files SET lifecycle_state = 'deleted' WHERE id = $1", [id])).rejects.toThrow()
    await expect(client.query("INSERT INTO file_storage_recoveries (storage_key, state) VALUES ('orphan', 'delete_failed')")).rejects.toThrow()
  })
})
