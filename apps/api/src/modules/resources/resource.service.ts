import type { AuthenticatedSessionUser } from '../identity/session.service.js'
import type { FileService } from '../files/file.service.js'
import type { ResourceRecord, ResourceRepository } from './resource.repository.js'

export class ResourceAccessError extends Error {
  constructor(readonly status: 404, readonly code: 'RESOURCE_NOT_AVAILABLE', message = '资料不存在或不可访问') { super(message); this.name = 'ResourceAccessError' }
}

const available = () => new ResourceAccessError(404, 'RESOURCE_NOT_AVAILABLE')

export const createResourceService = (repository: ResourceRepository, files: Pick<FileService, 'openPublishedResource'>) => {
  const canRead = async (resource: ResourceRecord, actor: AuthenticatedSessionUser | null) => {
    if (resource.accessScope === 'public') return true
    if (!actor || actor.disabledAt !== null) return false
    if (actor.role === 'admin' || resource.accessScope === 'authenticated') return true
    return repository.isAdmitted(actor.id)
  }
  return {
    list: async (actor: AuthenticatedSessionUser | null) => {
      const records = await repository.listAvailable()
      const admitted = actor?.role === 'admin' ? true : actor && actor.disabledAt === null ? await repository.isAdmitted(actor.id) : false
      return records.filter((record) => record.accessScope === 'public'
        || (actor?.disabledAt === null && (actor.role === 'admin' || record.accessScope === 'authenticated' || (record.accessScope === 'admitted' && admitted))))
        .map((record) => ({ id: record.id, key: record.key, title: record.title, description: record.description, accessScope: record.accessScope, sortOrder: record.sortOrder, downloadUrl: `/api/v1/resources/${record.id}/download` }))
    },
    open: async (id: string, actor: AuthenticatedSessionUser | null) => {
      const record = await repository.findAvailableById(id)
      if (!record || !await canRead(record, actor)) throw available()
      try {
        return {
          ...await files.openPublishedResource(record.fileId),
          isPublished: true as const,
          isAdminPreview: false as const,
          anonymousPublic: actor === null && record.accessScope === 'public',
        }
      } catch { throw available() }
    },
    preview: async (id: string, actor: AuthenticatedSessionUser) => {
      if (actor.role !== 'admin' || actor.disabledAt !== null) throw available()
      const record = await repository.findManageableById(id)
      if (!record) throw available()
      try {
        return {
          ...await files.openPublishedResource(record.fileId),
          isPublished: record.active,
          isAdminPreview: true as const,
          anonymousPublic: false as const,
        }
      } catch { throw available() }
    },
    listAdmin: () => repository.listAdmin(),
    createDraft: (input: Omit<ResourceRecord, 'id'>, actorUserId: string) => repository.createDraft(input, actorUserId),
    updateDraft: async (id: string, input: Omit<ResourceRecord, 'id'>, actorUserId: string) => {
      const record = await repository.updateDraft(id, input, actorUserId)
      if (!record) throw available()
      return record
    },
    setPublished: async (id: string, active: boolean, actorUserId: string) => {
      const record = await repository.setPublished(id, active, actorUserId)
      if (!record) throw available()
      return record
    },
  }
}

export type ResourceService = ReturnType<typeof createResourceService>
