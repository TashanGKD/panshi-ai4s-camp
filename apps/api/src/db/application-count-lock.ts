import { sql } from 'drizzle-orm'

export const applicationCountVisibilityLockKey = 7_463_278_191_123

export const lockApplicationCountVisibility = async (executor: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }) => {
  await executor.execute(sql`select pg_advisory_xact_lock(${applicationCountVisibilityLockKey}::bigint)`)
}
