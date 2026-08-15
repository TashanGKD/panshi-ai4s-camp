import type { AuthenticatedSessionUser } from '../identity/session.service.js'
import type { FileService } from '../files/file.service.js'
import type { ResourceRecord, ResourceRepository } from './resource.repository.js'

export class ResourceAccessError extends Error {
  constructor(readonly status: 404, readonly code: 'RESOURCE_NOT_AVAILABLE', message = '资料不存在或不可访问') { super(message); this.name = 'ResourceAccessError' }
}

export class ResourceRevisionConflictError extends Error {
  readonly status = 409
  readonly code = 'RESOURCE_REVISION_CONFLICT'
  constructor(message = '资料已被其他管理员修改，请刷新后重试') { super(message); this.name = 'ResourceRevisionConflictError' }
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
    createDraft: async (input: Omit<ResourceRecord, 'id' | 'revision'>, expectedRevision: number, actorUserId: string) => {
      if (expectedRevision !== 0) throw new ResourceRevisionConflictError()
      try { return await repository.createDraft(input, expectedRevision, actorUserId) }
      catch (error) { if (error instanceof Error && error.message === 'RESOURCE_REVISION_CONFLICT') throw new ResourceRevisionConflictError(); throw error }
    },
    updateDraft: async (id: string, input: Omit<ResourceRecord, 'id' | 'revision'>, expectedRevision: number, actorUserId: string) => {
      const result = await repository.updateDraft(id, input, expectedRevision, actorUserId)
      if (result.kind === 'not_found') throw available()
      if (result.kind === 'conflict') throw new ResourceRevisionConflictError()
      return result.resource
    },
    setPublished: async (id: string, active: boolean, expectedRevision: number, actorUserId: string) => {
      const result = await repository.setPublished(id, active, expectedRevision, actorUserId)
      if (result.kind === 'not_found') throw available()
      if (result.kind === 'conflict') throw new ResourceRevisionConflictError()
      return result.resource
    },
  }
}

export type ResourceService = ReturnType<typeof createResourceService>
