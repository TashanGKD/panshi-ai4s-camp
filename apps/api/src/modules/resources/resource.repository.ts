import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { applications, files, resources } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { appendAuditLog } from '../audit/audit.repository.js'

export type ResourceAccessScope = 'public' | 'authenticated' | 'admitted'
export type ResourceRecord = {
  id: string
  key: string
  title: string
  description: string | null
  fileId: string
  accessScope: ResourceAccessScope
  sortOrder: number
  revision: number
}

export type ResourceMutationResult =
  | { kind: 'updated', resource: ResourceRecord & { active: boolean } }
  | { kind: 'not_found' }
  | { kind: 'conflict' }

export type ResourceRepository = {
  listAvailable: () => Promise<readonly ResourceRecord[]>
  findAvailableById: (id: string) => Promise<ResourceRecord | null>
  findManageableById: (id: string) => Promise<(ResourceRecord & { active: boolean }) | null>
  isAdmitted: (userId: string) => Promise<boolean>
  listAdmin: () => Promise<readonly (ResourceRecord & { active: boolean })[]>
  createDraft: (input: Omit<ResourceRecord, 'id' | 'revision'>, expectedRevision: number, actorUserId: string) => Promise<ResourceRecord & { active: boolean }>
  updateDraft: (id: string, input: Omit<ResourceRecord, 'id' | 'revision'>, expectedRevision: number, actorUserId: string) => Promise<ResourceMutationResult>
  setPublished: (id: string, active: boolean, expectedRevision: number, actorUserId: string) => Promise<ResourceMutationResult>
}

export const createResourceRepository = (db: NodePgDatabase<typeof schema>): ResourceRepository => {
  const base = () => db.select({
    id: resources.id, key: resources.key, title: resources.title, description: resources.description,
    fileId: resources.fileId, accessScope: resources.accessLevel, sortOrder: resources.sortOrder, revision: resources.revision,
  }).from(resources).innerJoin(files, and(
    eq(files.id, resources.fileId), eq(files.purpose, 'resource'), eq(files.lifecycleState, 'active'),
    eq(files.visibility, resources.accessLevel),
    isNull(files.hiddenAt), isNull(files.deletedAt),
  ))
  const adminBase = () => db.select({
    id: resources.id, key: resources.key, title: resources.title, description: resources.description,
    fileId: resources.fileId, accessScope: resources.accessLevel, sortOrder: resources.sortOrder, revision: resources.revision, active: resources.active,
  }).from(resources)
  return {
    listAvailable: async () => base().where(eq(resources.active, true)).orderBy(asc(resources.sortOrder), asc(resources.id)) as Promise<ResourceRecord[]>,
    findAvailableById: async (id) => {
      const [record] = await base().where(and(eq(resources.id, id), eq(resources.active, true))).limit(1) as ResourceRecord[]
      return record ?? null
    },
    findManageableById: async (id) => {
      const [record] = await db.select({
        id: resources.id, key: resources.key, title: resources.title, description: resources.description,
        fileId: resources.fileId, accessScope: resources.accessLevel, sortOrder: resources.sortOrder, revision: resources.revision, active: resources.active,
      }).from(resources).innerJoin(files, and(
        eq(files.id, resources.fileId), eq(files.purpose, 'resource'), eq(files.lifecycleState, 'active'),
        eq(files.visibility, resources.accessLevel), isNull(files.hiddenAt), isNull(files.deletedAt),
      )).where(eq(resources.id, id)).limit(1) as Array<ResourceRecord & { active: boolean }>
      return record ?? null
    },
    isAdmitted: async (userId) => {
      const [record] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.status, 'admitted'))).limit(1)
      return record !== undefined
    },
    listAdmin: async () => adminBase().orderBy(asc(resources.sortOrder), asc(resources.id)) as Promise<Array<ResourceRecord & { active: boolean }>>,
    createDraft: (input, expectedRevision, actorUserId) => db.transaction(async (transaction) => {
      if (expectedRevision !== 0) throw new Error('RESOURCE_REVISION_CONFLICT')
      const [file] = await transaction.select({ id: files.id, visibility: files.visibility }).from(files).where(and(eq(files.id, input.fileId), eq(files.purpose, 'resource'), eq(files.visibility, input.accessScope), eq(files.lifecycleState, 'active'), isNull(files.hiddenAt), isNull(files.deletedAt))).limit(1)
      if (!file) throw new Error('RESOURCE_FILE_INVALID')
      const [record] = await transaction.insert(resources).values({ key: input.key, title: input.title, description: input.description, fileId: input.fileId, accessLevel: input.accessScope, sortOrder: input.sortOrder, active: false }).returning()
      if (!record) throw new Error('Resource insert failed')
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId, action: 'resource.draft_created', entityType: 'resource', entityId: record.id, metadata: { accessScope: record.accessLevel, sortOrder: record.sortOrder } })
      return { id: record.id, key: record.key, title: record.title, description: record.description, fileId: record.fileId!, accessScope: record.accessLevel, sortOrder: record.sortOrder, revision: record.revision, active: record.active }
    }),
    updateDraft: (id, input, expectedRevision, actorUserId) => db.transaction(async (transaction) => {
      const [file] = await transaction.select({ id: files.id }).from(files).where(and(eq(files.id, input.fileId), eq(files.purpose, 'resource'), eq(files.visibility, input.accessScope), eq(files.lifecycleState, 'active'), isNull(files.hiddenAt), isNull(files.deletedAt))).limit(1)
      if (!file) throw new Error('RESOURCE_FILE_INVALID')
      const [record] = await transaction.update(resources).set({ key: input.key, title: input.title, description: input.description, fileId: input.fileId, accessLevel: input.accessScope, sortOrder: input.sortOrder, active: false, revision: sql`${resources.revision} + 1`, updatedAt: new Date() }).where(and(eq(resources.id, id), eq(resources.revision, expectedRevision))).returning()
      if (!record) {
        const [existing] = await transaction.select({ id: resources.id }).from(resources).where(eq(resources.id, id)).limit(1)
        return existing ? { kind: 'conflict' } : { kind: 'not_found' }
      }
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId, action: 'resource.draft_saved', entityType: 'resource', entityId: id, metadata: { accessScope: record.accessLevel, sortOrder: record.sortOrder } })
      return { kind: 'updated', resource: { id: record.id, key: record.key, title: record.title, description: record.description, fileId: record.fileId!, accessScope: record.accessLevel, sortOrder: record.sortOrder, revision: record.revision, active: record.active } }
    }),
    setPublished: (id, active, expectedRevision, actorUserId) => db.transaction(async (transaction) => {
      const [existing] = await transaction.select({ fileId: resources.fileId, accessScope: resources.accessLevel }).from(resources).where(eq(resources.id, id)).limit(1)
      if (!existing?.fileId) return { kind: 'not_found' }
      if (active) {
        const [file] = await transaction.select({ id: files.id }).from(files).where(and(eq(files.id, existing.fileId), eq(files.purpose, 'resource'), eq(files.visibility, existing.accessScope), eq(files.lifecycleState, 'active'), isNull(files.hiddenAt), isNull(files.deletedAt))).limit(1)
        if (!file) throw new Error('RESOURCE_FILE_INVALID')
      }
      const [record] = await transaction.update(resources).set({ active, revision: sql`${resources.revision} + 1`, publishedAt: new Date(), updatedAt: new Date() }).where(and(eq(resources.id, id), eq(resources.revision, expectedRevision))).returning()
      if (!record || !record.fileId) {
        const [current] = await transaction.select({ id: resources.id }).from(resources).where(eq(resources.id, id)).limit(1)
        return current ? { kind: 'conflict' } : { kind: 'not_found' }
      }
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId, action: active ? 'resource.published' : 'resource.unpublished', entityType: 'resource', entityId: id, metadata: { accessScope: record.accessLevel, sortOrder: record.sortOrder } })
      return { kind: 'updated', resource: { id: record.id, key: record.key, title: record.title, description: record.description, fileId: record.fileId, accessScope: record.accessLevel, sortOrder: record.sortOrder, revision: record.revision, active: record.active } }
    }),
  }
}
