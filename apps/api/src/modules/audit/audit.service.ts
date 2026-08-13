import type { AuditEntry, AuditRepository } from './audit.repository.js'

export type AuditService = {
  record: (entry: AuditEntry) => Promise<void>
}

export const createAuditService = (repository: AuditRepository): AuditService => ({
  record: (entry) => repository.append(entry),
})
