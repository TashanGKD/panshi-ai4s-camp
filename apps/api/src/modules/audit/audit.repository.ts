import type { JsonObject } from '@panshi/contracts'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { auditLogs } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'

export type AuditEntry = {
  actorUserId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: JsonObject
}

export type AuditRepository = {
  append: (entry: AuditEntry) => Promise<void>
}

export const createAuditRepository = (db: NodePgDatabase<typeof schema>): AuditRepository => ({
  append: async (entry) => {
    await db.insert(auditLogs).values(entry)
  },
})
