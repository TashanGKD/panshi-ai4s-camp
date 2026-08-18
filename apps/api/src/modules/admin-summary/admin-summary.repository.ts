import { isDeepStrictEqual } from 'node:util'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { ContentModuleKeySchema, ImportantDatesContentSchema, type ContentModuleKey } from '@panshi/contracts'
import { applications, auditLogs, contentModules, contentVersions, users } from '../../db/schema.js'
import { shanghaiBusinessDate } from '../../lib/business-date.js'
import type * as schema from '../../db/schema.js'
import type { AdminSummaryRepository } from './admin-summary.service.js'

export { shanghaiBusinessDate } from '../../lib/business-date.js'

const machineKeys = new Set(['registrationOpen', 'registrationDeadline', 'campStart', 'campEnd'])

export const createAdminSummaryRepository = (
  db: NodePgDatabase<typeof schema>,
  { todayProvider = () => shanghaiBusinessDate(new Date()) }: { todayProvider?: () => string } = {},
): AdminSummaryRepository => ({
  countApplicationsByStatus: async () => db.select({ status: applications.status, count: count() })
    .from(applications).groupBy(applications.status),

  listUpcomingDates: async () => {
    const [record] = await db.select({ payload: contentVersions.payload })
      .from(contentModules)
      .innerJoin(contentVersions, and(
        eq(contentVersions.moduleKey, contentModules.key),
        eq(contentVersions.id, contentModules.publishedVersionId),
      ))
      .where(eq(contentModules.key, 'importantDates'))
      .limit(1)
    const parsed = ImportantDatesContentSchema.safeParse(record?.payload)
    if (!parsed.success) return []
    const today = todayProvider()
    if (parsed.data.machineDates) {
      const labels = { registrationOpen: '报名开放', registrationDeadline: '报名截止', campStart: '实训开始', campEnd: '实训结束' } as const
      return Object.entries(parsed.data.machineDates)
        .filter((entry): entry is [keyof typeof labels, string] => machineKeys.has(entry[0]) && entry[1] >= today)
        .map(([machineKey, date]) => ({ machineKey, label: labels[machineKey], date }))
        .sort((left, right) => left.date.localeCompare(right.date))
        .slice(0, 5)
    }
    return parsed.data.items
      .filter((item): item is typeof item & { machineKey: 'registrationOpen' | 'registrationDeadline' | 'campStart' | 'campEnd' } => (
        item.machineKey !== undefined && machineKeys.has(item.machineKey) && /^\d{4}-\d{2}-\d{2}$/u.test(item.value) && item.value >= today
      ))
      .map((item) => ({ machineKey: item.machineKey, label: item.label, date: item.value }))
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(0, 5)
  },

  listUnpublishedDrafts: async () => {
    const rows = await db.select({
      key: contentModules.key,
      revision: contentModules.draftRevision,
      draft: contentModules.draft,
      publishedPayload: contentVersions.payload,
      publishedVersionId: contentModules.publishedVersionId,
    }).from(contentModules).leftJoin(contentVersions, and(
      eq(contentVersions.moduleKey, contentModules.key),
      eq(contentVersions.id, contentModules.publishedVersionId),
    )).orderBy(asc(contentModules.key))
    return rows.flatMap((row) => {
      const key = ContentModuleKeySchema.safeParse(row.key)
      if (!key.success || row.revision === 0 || (row.publishedVersionId !== null && isDeepStrictEqual(row.draft, row.publishedPayload))) return []
      return [{ key: key.data as ContentModuleKey, revision: row.revision }]
    })
  },

  listRecentOperations: async () => db.select({
    id: auditLogs.id,
    action: auditLogs.action,
    actorDisplayName: users.displayName,
    createdAt: auditLogs.createdAt,
  }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .orderBy(desc(auditLogs.createdAt)).limit(10),
})
