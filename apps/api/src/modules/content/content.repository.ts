import type { JsonObject, ContentModuleKey } from '@panshi/contracts'
import { and, eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { contentModules, contentVersions } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'

export type PublishedContentRecord = {
  key: ContentModuleKey
  payload: JsonObject
  version: number
}

export type PublicContentRepository = {
  findPublishedByKeys: (keys: readonly ContentModuleKey[]) => Promise<readonly PublishedContentRecord[]>
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
