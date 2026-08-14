import type {
  AdminContentDraftResponse,
  AdminContentHistoryResponse,
  AdminContentPreviewResponse,
  ContentModuleKey,
  ContentPublishResponse,
  JsonObject,
} from '@panshi/contracts'
import {
  AdminContentDraftResponseSchema,
  AdminContentHistoryResponseSchema,
  AdminContentPreviewResponseSchema,
  ContentPublishResponseSchema,
} from '@panshi/contracts'
import type { ContentPublishingRepository } from './content.repository.js'
import { sanitizeContentPayload } from './content-sanitizer.js'

export class ContentConflictError extends Error {
  constructor() {
    super('Content revision conflict')
    this.name = 'ContentConflictError'
  }
}

export class ContentRecordNotFoundError extends Error {
  constructor() {
    super('Content record not found')
    this.name = 'ContentRecordNotFoundError'
  }
}

export type ContentPublishingService = {
  getDraft: (key: ContentModuleKey) => Promise<AdminContentDraftResponse>
  saveDraft: (key: ContentModuleKey, payload: JsonObject, expectedRevision: number, actorUserId: string) => Promise<AdminContentDraftResponse>
  previewDraft: (key: ContentModuleKey) => Promise<AdminContentPreviewResponse>
  publish: (key: ContentModuleKey, expectedRevision: number, actorUserId: string) => Promise<ContentPublishResponse>
  getHistory: (key: ContentModuleKey) => Promise<AdminContentHistoryResponse>
  rollback: (key: ContentModuleKey, sourceVersion: number, actorUserId: string) => Promise<ContentPublishResponse>
}

const requireRecord = <T>(record: T | null): T => {
  if (!record) throw new ContentRecordNotFoundError()
  return record
}

export const createContentPublishingService = (repository: ContentPublishingRepository): ContentPublishingService => ({
  getDraft: async (key) => {
    const record = requireRecord(await repository.getDraft(key))
    return AdminContentDraftResponseSchema.parse({
      apiVersion: 'v1', data: { ...record, payload: sanitizeContentPayload(key, record.payload) },
    })
  },

  saveDraft: async (key, payload, expectedRevision, actorUserId) => {
    const record = await repository.saveDraft({ key, payload: sanitizeContentPayload(key, payload), expectedRevision, actorUserId })
    if (!record) {
      if (!await repository.getDraft(key)) throw new ContentRecordNotFoundError()
      throw new ContentConflictError()
    }
    return AdminContentDraftResponseSchema.parse({ apiVersion: 'v1', data: record })
  },

  previewDraft: async (key) => {
    const record = requireRecord(await repository.getDraft(key))
    return AdminContentPreviewResponseSchema.parse({
      apiVersion: 'v1', data: { key: record.key, revision: record.revision, payload: sanitizeContentPayload(key, record.payload) },
    })
  },

  publish: async (key, expectedRevision, actorUserId) => {
    const result = await repository.publishDraft({ key, expectedRevision, actorUserId })
    if (!result) {
      if (!await repository.getDraft(key)) throw new ContentRecordNotFoundError()
      throw new ContentConflictError()
    }
    return ContentPublishResponseSchema.parse({ apiVersion: 'v1', data: { key, ...result } })
  },

  getHistory: async (key) => {
    const result = requireRecord(await repository.listVersions(key))
    return AdminContentHistoryResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        key,
        publishedVersion: result.publishedVersion,
        versions: result.versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })),
      },
    })
  },

  rollback: async (key, sourceVersion, actorUserId) => {
    const result = requireRecord(await repository.rollback({ key, sourceVersion, actorUserId }))
    return ContentPublishResponseSchema.parse({
      apiVersion: 'v1', data: { key, ...result, sourceVersion },
    })
  },
})
