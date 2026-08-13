import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PoolClient } from 'pg'
import { createConfiguredDatabaseClient } from './client.js'

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle')
const migrationFilePattern = /^\d+_[a-z0-9_]+\.sql$/u
const advisoryLockKey = 'panshi_ai4s_camp_schema_migrations'

const applyPendingMigrations = async (client: PoolClient) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "panshi_schema_migrations" (
      "name" text PRIMARY KEY NOT NULL,
      "sha256" text NOT NULL,
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => migrationFilePattern.test(name))
    .sort()

  for (const name of migrationNames) {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8')
    const sha256 = createHash('sha256').update(sql).digest('hex')
    const applied = await client.query<{ sha256: string }>(
      'SELECT "sha256" FROM "panshi_schema_migrations" WHERE "name" = $1',
      [name],
    )

    if (applied.rows[0]) {
      if (applied.rows[0].sha256 !== sha256) {
        throw new Error(`Applied migration ${name} differs from the checked-in file`)
      }
      continue
    }

    await client.query(sql)
    await client.query(
      'INSERT INTO "panshi_schema_migrations" ("name", "sha256") VALUES ($1, $2)',
      [name, sha256],
    )
  }

  return migrationNames.length
}

const migrate = async () => {
  const { pool, close } = createConfiguredDatabaseClient()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [advisoryLockKey])
    const migrationCount = await applyPendingMigrations(client)
    await client.query('COMMIT')
    console.log(`Database migrations checked successfully (${migrationCount} files)`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw new Error('Database migration failed', { cause: error })
  } finally {
    client.release()
    await close()
  }
}

await migrate()
