import { and, count, eq, inArray, max, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { applications, contentModules, contentVersions } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'

const countedStatuses = ['submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] as const

export type StatisticsRepository = {
  readPublishedVisibility: () => Promise<boolean>
  countSubmitted: () => Promise<{ count: number, updatedAt: Date }>
}

export const createStatisticsRepository = (db: NodePgDatabase<typeof schema>): StatisticsRepository => ({
  readPublishedVisibility: async () => {
    const [record] = await db.select({ payload: contentVersions.payload }).from(contentModules).innerJoin(contentVersions, and(eq(contentVersions.moduleKey, contentModules.key), eq(contentVersions.id, contentModules.publishedVersionId))).where(eq(contentModules.key, 'display')).limit(1)
    return typeof record?.payload === 'object' && record.payload !== null && record.payload.showRegistrationCount === true
  },
  countSubmitted: async () => {
    const [record] = await db.select({ count: count(applications.id), updatedAt: max(applications.updatedAt), observedAt: sql<Date>`now()` }).from(applications).where(inArray(applications.status, [...countedStatuses]))
    return { count: Number(record?.count ?? 0), updatedAt: record?.updatedAt ?? record?.observedAt ?? new Date() }
  },
})
