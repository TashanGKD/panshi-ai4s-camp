import type { JsonObject, ContentModuleKey } from '@panshi/contracts'
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { auditLogs, contentModules, contentVersions } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { validateContentForPublication, type ContentValidationRepository } from './content.validators.js'

export type PublishedContentRecord = {
  key: ContentModuleKey
  payload: JsonObject
  version: number
}

export type PublicContentRepository = {
  findPublishedByKeys: (keys: readonly ContentModuleKey[]) => Promise<readonly PublishedContentRecord[]>
}

export type DraftContentRecord = {
  key: ContentModuleKey
  payload: JsonObject
  revision: number
  publishedVersion: number | null
}

export type ContentVersionRecord = {
  version: number
  payload: JsonObject
  createdBy: string
  createdAt: Date
}

export type ContentPublishingRepository = {
  getDraft: (key: ContentModuleKey) => Promise<DraftContentRecord | null>
  saveDraft: (input: { key: ContentModuleKey, payload: JsonObject, expectedRevision: number, actorUserId: string }) => Promise<DraftContentRecord | null>
  publishDraft: (input: { key: ContentModuleKey, expectedRevision: number, actorUserId: string }) => Promise<{ revision: number, version: number } | null>
  listVersions: (key: ContentModuleKey) => Promise<{ publishedVersion: number | null, versions: readonly ContentVersionRecord[] } | null>
  rollback: (input: { key: ContentModuleKey, sourceVersion: number, actorUserId: string }) => Promise<{ revision: number, version: number } | null>
}

export const createContentRepository = (
  db: NodePgDatabase<typeof schema>,
): PublicContentRepository => ({
  findPublishedByKeys: async (keys) => {
    if (keys.length === 0) return []

    return db.select({
      key: contentModules.key,
      payload: contentVersions.payload,
      version: contentVersions.version,
    })
      .from(contentModules)
      .innerJoin(contentVersions, and(
        eq(contentVersions.moduleKey, contentModules.key),
        eq(contentVersions.id, contentModules.publishedVersionId),
      ))
      .where(inArray(contentModules.key, [...keys])) as Promise<PublishedContentRecord[]>
  },
})

const structuralSummary = (payload: JsonObject) => {
  const valueTypes = { array: 0, object: 0, string: 0, number: 0, boolean: 0, null: 0 }
  for (const value of Object.values(payload)) {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    if (type in valueTypes) valueTypes[type as keyof typeof valueTypes] += 1
  }
  return { fieldCount: Object.keys(payload).length, valueTypes }
}

export const createContentPublishingRepository = (
  db: NodePgDatabase<typeof schema>,
): ContentPublishingRepository => {
  const findPublishedPayload = async (
    executor: NodePgDatabase<typeof schema>,
    key: ContentModuleKey,
  ): Promise<JsonObject | null> => {
    const [record] = await executor.select({ payload: contentVersions.payload })
      .from(contentModules)
      .innerJoin(contentVersions, and(
        eq(contentVersions.moduleKey, contentModules.key),
        eq(contentVersions.id, contentModules.publishedVersionId),
      ))
      .where(eq(contentModules.key, key)).limit(1)
    return record?.payload ?? null
  }

  const validationRepository = (executor: NodePgDatabase<typeof schema>): ContentValidationRepository => ({
    findPublishedPayload: (key) => findPublishedPayload(executor, key),
  })

  const readDraft = async (
    executor: NodePgDatabase<typeof schema>,
    key: ContentModuleKey,
  ): Promise<DraftContentRecord | null> => {
    const [module] = await executor.select({
      key: contentModules.key,
      payload: contentModules.draft,
      revision: contentModules.draftRevision,
      publishedVersionId: contentModules.publishedVersionId,
    }).from(contentModules).where(eq(contentModules.key, key)).limit(1)
    if (!module) return null
    let publishedVersion: number | null = null
    if (module.publishedVersionId) {
      const [published] = await executor.select({ version: contentVersions.version }).from(contentVersions)
        .where(and(eq(contentVersions.moduleKey, key), eq(contentVersions.id, module.publishedVersionId))).limit(1)
      publishedVersion = published?.version ?? null
    }
    return { key, payload: module.payload, revision: module.revision, publishedVersion }
  }

  const nextVersion = async (executor: NodePgDatabase<typeof schema>, key: ContentModuleKey) => {
    const [result] = await executor.select({ value: max(contentVersions.version) }).from(contentVersions)
      .where(eq(contentVersions.moduleKey, key))
    return (result?.value ?? 0) + 1
  }

  const lockModule = async (executor: NodePgDatabase<typeof schema>, key: ContentModuleKey) => {
    await executor.execute(sql`select ${contentModules.key} from ${contentModules} where ${contentModules.key} = ${key} for update`)
    return readDraft(executor, key)
  }

  return {
    getDraft: (key) => readDraft(db, key),

    saveDraft: async ({ key, payload, expectedRevision, actorUserId }) => db.transaction(async (transaction) => {
      const [updated] = await transaction.update(contentModules).set({
        draft: payload,
        draftRevision: expectedRevision + 1,
      }).where(and(
        eq(contentModules.key, key),
        eq(contentModules.draftRevision, expectedRevision),
      )).returning({ revision: contentModules.draftRevision })
      if (!updated) return null
      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'content.draft_saved',
        entityType: 'content_module',
        entityId: key,
        metadata: {
          moduleKey: key,
          before: { revision: expectedRevision },
          after: { revision: updated.revision, shape: structuralSummary(payload) },
        },
      })
      return readDraft(transaction as NodePgDatabase<typeof schema>, key)
    }),

    publishDraft: async ({ key, expectedRevision, actorUserId }) => db.transaction(async (transaction) => {
      const executor = transaction as NodePgDatabase<typeof schema>
      const module = await lockModule(executor, key)
      if (!module) return null
      if (module.revision !== expectedRevision) return null
      await validateContentForPublication(key, module.payload, validationRepository(executor))
      const version = await nextVersion(executor, key)
      const [created] = await transaction.insert(contentVersions).values({
        moduleKey: key,
        version,
        payload: module.payload,
        createdBy: actorUserId,
      }).returning({ id: contentVersions.id })
      if (!created) throw new Error('Content version insert failed')
      await transaction.update(contentModules).set({ publishedVersionId: created.id }).where(eq(contentModules.key, key))
      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'content.published',
        entityType: 'content_module',
        entityId: key,
        metadata: {
          moduleKey: key,
          revision: module.revision,
          version,
          before: { publishedVersion: module.publishedVersion },
          after: { publishedVersion: version, shape: structuralSummary(module.payload) },
        },
      })
      return { revision: module.revision, version }
    }),

    listVersions: async (key) => {
      const module = await readDraft(db, key)
      if (!module) return null
      const versions = await db.select({
        version: contentVersions.version,
        payload: contentVersions.payload,
        createdBy: contentVersions.createdBy,
        createdAt: contentVersions.createdAt,
      }).from(contentVersions).where(eq(contentVersions.moduleKey, key)).orderBy(desc(contentVersions.version))
      return { publishedVersion: module.publishedVersion, versions }
    },

    rollback: async ({ key, sourceVersion, actorUserId }) => db.transaction(async (transaction) => {
      const executor = transaction as NodePgDatabase<typeof schema>
      const module = await lockModule(executor, key)
      if (!module) return null
      const [source] = await transaction.select({ payload: contentVersions.payload }).from(contentVersions).where(and(
        eq(contentVersions.moduleKey, key), eq(contentVersions.version, sourceVersion),
      )).limit(1)
      if (!source) return null
      await validateContentForPublication(key, source.payload, validationRepository(executor))
      const version = await nextVersion(executor, key)
      const [created] = await transaction.insert(contentVersions).values({
        moduleKey: key,
        version,
        payload: source.payload,
        createdBy: actorUserId,
      }).returning({ id: contentVersions.id })
      if (!created) throw new Error('Rollback version insert failed')
      await transaction.update(contentModules).set({ publishedVersionId: created.id }).where(eq(contentModules.key, key))
      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'content.rolled_back',
        entityType: 'content_module',
        entityId: key,
        metadata: {
          moduleKey: key,
          sourceVersion,
          version,
          revision: module.revision,
          before: { publishedVersion: module.publishedVersion },
          after: { publishedVersion: version, shape: structuralSummary(source.payload) },
        },
      })
      return { revision: module.revision, version }
    }),
  }
}
