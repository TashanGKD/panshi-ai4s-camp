import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getDatabaseEnv } from '../config/env.js'
import * as schema from './schema.js'

export const createDatabaseClient = (databaseUrl: string) => {
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })

  return {
    db,
    pool,
    close: async () => pool.end(),
  }
}

export const createConfiguredDatabaseClient = () => {
  const { DATABASE_URL } = getDatabaseEnv()
  return createDatabaseClient(DATABASE_URL)
}
