import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { auditLogs } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { prepareAuditEntry, type AuditEntry } from './audit-policy.js'
export type { AuditEntry } from './audit-policy.js'

export type AuditRepository = {
  append: (entry: AuditEntry) => Promise<void>
}

export const appendAuditLog = async (db: NodePgDatabase<typeof schema>, entry: AuditEntry) => {
  await db.insert(auditLogs).values(prepareAuditEntry(entry))
}

export const createAuditRepository = (db: NodePgDatabase<typeof schema>): AuditRepository => ({ append: (entry) => appendAuditLog(db, entry) })
