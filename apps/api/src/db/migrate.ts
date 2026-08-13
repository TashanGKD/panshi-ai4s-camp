import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PoolClient } from 'pg'
import { createConfiguredDatabaseClient } from './client.js'

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle')
const migrationFilePattern = /^\d+_[a-z0-9_]+\.sql$/u
const advisoryLockKey = 'panshi_ai4s_camp_schema_migrations'

export const applyPendingMigrations = async (
  client: PoolClient,
  directory = migrationsDirectory,
) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "panshi_schema_migrations" (
      "name" text PRIMARY KEY NOT NULL,
      "sha256" text NOT NULL,
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)

  const migrationNames = (await readdir(directory))
    .filter((name) => migrationFilePattern.test(name))
    .sort()

  for (const name of migrationNames) {
    try {
      const sql = await readFile(join(directory, name), 'utf8')
      const sha256 = createHash('sha256').update(sql).digest('hex')
      const applied = await client.query<{ sha256: string }>(
        'SELECT "sha256" FROM "panshi_schema_migrations" WHERE "name" = $1',
        [name],
      )

      if (applied.rows[0]) {
        if (applied.rows[0].sha256 !== sha256) {
          throw new Error('Applied migration checksum differs from the checked-in file')
        }
        continue
      }

      await client.query(sql)
      await client.query(
        'INSERT INTO "panshi_schema_migrations" ("name", "sha256") VALUES ($1, $2)',
        [name, sha256],
      )
    } catch (error) {
      throw new Error(`Failed to apply migration ${name}`, { cause: error })
    }
  }

  return migrationNames.length
}

type MigrationRuntime = {
  connect: () => Promise<PoolClient>
  close: () => Promise<void>
}

const createMigrationRuntime = (): MigrationRuntime => {
  const { pool, close } = createConfiguredDatabaseClient()
  return { connect: () => pool.connect(), close }
}

export const runMigrations = async (
  providedRuntime?: MigrationRuntime,
  directory = migrationsDirectory,
) => {
  let runtime: MigrationRuntime

  try {
    runtime = providedRuntime ?? createMigrationRuntime()
  } catch (error) {
    throw new Error('Database migration failed during connection or setup', { cause: error })
  }

  let client: PoolClient | undefined
  let transactionStarted = false
  let publicError: Error | undefined

  try {
    client = await runtime.connect()
    await client.query('BEGIN')
    transactionStarted = true
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [advisoryLockKey])
    const migrationCount = await applyPendingMigrations(client, directory)
    await client.query('COMMIT')
    transactionStarted = false
    console.log(`Database migrations checked successfully (${migrationCount} files)`)
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original failure as the actionable cause.
      }
    }
    const migrationContext = error instanceof Error && error.message.startsWith('Failed to apply migration ')
      ? `: ${error.message}`
      : ''
    const message = client
      ? `Database migration failed during execution${migrationContext}`
      : 'Database migration failed during connection or setup'
    publicError = new Error(message, { cause: error })
  } finally {
    if (client) {
      try {
        client.release()
      } catch (error) {
        publicError ??= new Error('Database migration failed during cleanup', { cause: error })
      }
    }

    try {
      await runtime.close()
    } catch (error) {
      publicError ??= new Error('Database migration failed during cleanup', { cause: error })
    }
  }

  if (publicError) {
    throw publicError
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  await runMigrations()
}
