import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '../../db/schema.js'
import { lockApplicationCountVisibility } from '../../db/application-count-lock.js'

const countedStatuses = ['submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'] as const

export type StatisticsRepository = {
  readPublicCount: () => Promise<{ visible: false } | { visible: true, count: number, updatedAt: Date }>
}

export const createStatisticsRepository = (db: NodePgDatabase<typeof schema>): StatisticsRepository => ({
  readPublicCount: () => db.transaction(async (transaction) => {
    await lockApplicationCountVisibility(transaction)
    const result = await transaction.execute<{ visible: boolean, submitted_count: string | null, updated_at: Date | string | null }>(sql`
      /* application_count_atomic */
      with visibility as (
        select coalesce((published.payload ->> 'showRegistrationCount')::boolean, false) as visible
        from content_modules as module
        left join content_versions as published on published.id = module.published_version_id and published.module_key = module.key
        where module.key = 'display'
      ), submitted as (
        select count(*)::text as submitted_count, coalesce(max(updated_at), now()) as updated_at
        from applications
        where status in (${sql.join(countedStatuses.map((status) => sql`${status}`), sql`, `)})
      )
      select
        coalesce((select visible from visibility), false) as visible,
        case when coalesce((select visible from visibility), false) then submitted.submitted_count else null end as submitted_count,
        case when coalesce((select visible from visibility), false) then submitted.updated_at else null end as updated_at
      from submitted
    `)
    const record = result.rows[0]
    if (!record?.visible) return { visible: false as const }
    return { visible: true as const, count: Number(record.submitted_count ?? 0), updatedAt: new Date(record.updated_at ?? Date.now()) }
  }),
})
