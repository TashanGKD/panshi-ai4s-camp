import type { AuditEntry, AuditRepository } from './audit.repository.js'
import { prepareAuditEntry } from './audit-policy.js'

export type AuditService = {
  record: (entry: AuditEntry) => Promise<void>
}

export const createAuditService = (repository: AuditRepository): AuditService => ({
  record: async (entry) => repository.append(prepareAuditEntry(entry)),
})
