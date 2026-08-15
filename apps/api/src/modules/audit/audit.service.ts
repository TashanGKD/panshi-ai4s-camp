import type { AuditEntry, AuditRepository } from './audit.repository.js'
import { sanitizeAuditMetadata } from './audit-policy.js'

export type AuditService = {
  record: (entry: AuditEntry) => Promise<void>
}

export const createAuditService = (repository: AuditRepository): AuditService => ({
  record: (entry) => repository.append({ ...entry, metadata: sanitizeAuditMetadata(entry.metadata) }),
})
