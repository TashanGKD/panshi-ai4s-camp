import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getDatabaseEnv } from '../config/env.js'
import * as schema from './schema.js'

type HealthQueryable = {
  query: (config: { text: string; query_timeout: number }) => Promise<unknown>
}

export const createDatabaseHealthCheck = (
  queryable: HealthQueryable,
  timeoutMs: number,
) => async () => {
  await queryable.query({ text: 'SELECT 1', query_timeout: timeoutMs })
}

export const createDatabaseClient = (databaseUrl: string, healthcheckTimeoutMs?: number) => {
  const effectiveHealthcheckTimeoutMs = healthcheckTimeoutMs ?? 2_000
  const pool = new Pool({
    connectionString: databaseUrl,
    ...(healthcheckTimeoutMs === undefined ? {} : { connectionTimeoutMillis: healthcheckTimeoutMs }),
  })
  pool.on('error', () => {
    console.error('Unexpected database pool error')
  })
  const db = drizzle(pool, { schema })

  return {
    db,
    pool,
    checkHealth: createDatabaseHealthCheck(pool, effectiveHealthcheckTimeoutMs),
    close: async () => pool.end(),
  }
}

export const createConfiguredDatabaseClient = () => {
  const { DATABASE_URL } = getDatabaseEnv()
  return createDatabaseClient(DATABASE_URL)
}
