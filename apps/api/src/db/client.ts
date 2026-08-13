import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getDatabaseEnv } from '../config/env.js'
import * as schema from './schema.js'

type HealthQueryable = {
  query: (text: string) => Promise<unknown>
}

export const createDatabaseHealthCheck = (queryable: HealthQueryable) => async () => {
  await queryable.query('SELECT 1')
}

export const createDatabaseClient = (databaseUrl: string) => {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
  })
  pool.on('error', () => {
    console.error('Unexpected database pool error')
  })
  const db = drizzle(pool, { schema })

  return {
    db,
    pool,
    checkHealth: createDatabaseHealthCheck(pool),
    close: async () => pool.end(),
  }
}

export const createConfiguredDatabaseClient = () => {
  const { DATABASE_URL } = getDatabaseEnv()
  return createDatabaseClient(DATABASE_URL)
}
