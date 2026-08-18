import { isDeepStrictEqual } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ContentModuleKeySchema,
  PublicContentPayloadSchemas,
  type JsonObject,
} from '@panshi/contracts'
import { and, eq, max, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'
import { createConfiguredDatabaseClient } from '../client.js'
import { contentModules, contentVersions, users } from '../schema.js'
import type * as schema from '../schema.js'
import { appendAuditLog } from '../../modules/audit/audit.repository.js'
import { authoritativeContentV211 } from './authoritative-content-v2-1-1.js'

export const initialPublishedContent = authoritativeContentV211

const firstPublishedVersionIds = {
  basic: '60000000-0000-4000-8000-000000000001',
  features: '60000000-0000-4000-8000-000000000002',
  organizations: '60000000-0000-4000-8000-000000000003',
  importantDates: '60000000-0000-4000-8000-000000000004',
  schedule: '60000000-0000-4000-8000-000000000005',
  contacts: '60000000-0000-4000-8000-000000000006',
  travel: '60000000-0000-4000-8000-000000000007',
  display: '60000000-0000-4000-8000-000000000008',
} as const

type SeedDatabase = NodePgDatabase<typeof schema>
// First 64 bits of SHA-256("panshi-ai4s-camp:initial-content-v1"), kept stable across seed callers.
const initialContentSeedLockKey = '4509249026622731849'

export const seedInitialContent = async (db: SeedDatabase, creatorUserId: string) => {
  const parsedCreatorUserId = z.string().uuid().parse(creatorUserId)

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${initialContentSeedLockKey}::bigint)`)
    const [creator] = await transaction.select({ id: users.id }).from(users)
      .where(eq(users.id, parsedCreatorUserId)).limit(1)
    if (!creator) throw new Error('CONTENT_SEED_CREATOR_USER_ID must reference an existing user')

    await transaction.insert(contentModules).values(ContentModuleKeySchema.options.map((key) => ({
      key,
      draft: {},
      draftRevision: 0,
    }))).onConflictDoNothing()

    for (const key of Object.keys(initialPublishedContent) as (keyof typeof initialPublishedContent)[]) {
      const payload = PublicContentPayloadSchemas[key].parse(initialPublishedContent[key]) as JsonObject
      const versions = await transaction.select({
        id: contentVersions.id,
        version: contentVersions.version,
        payload: contentVersions.payload,
      }).from(contentVersions).where(eq(contentVersions.moduleKey, key))
      const matching = versions.find((version) => isDeepStrictEqual(version.payload, payload))

      let inserted = false
      let publishedVersionId: string
      let publishedVersion: number
      if (matching) {
        publishedVersionId = matching.id
        publishedVersion = matching.version
      } else {
        const [latest] = await transaction.select({ value: max(contentVersions.version) })
          .from(contentVersions).where(eq(contentVersions.moduleKey, key))
        publishedVersion = (latest?.value ?? 0) + 1
        const [created] = await transaction.insert(contentVersions).values({
          ...(publishedVersion === 1 ? { id: firstPublishedVersionIds[key] } : {}),
          moduleKey: key,
          version: publishedVersion,
          payload,
          createdBy: creator.id,
        }).returning({ id: contentVersions.id })
        if (!created) throw new Error(`Content version insert failed: ${key}`)
        publishedVersionId = created.id
        inserted = true
      }

      if (inserted) {
        await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
          actorUserId: creator.id,
          action: 'content.version_created',
          entityType: 'content_version',
          entityId: publishedVersionId,
          metadata: { moduleKey: key, source: 'authoritative_v2_1_1_seed', version: publishedVersion },
        })
      }

      const [moduleBeforePublish] = await transaction.select({
        draft: contentModules.draft,
        publishedVersionId: contentModules.publishedVersionId,
      })
        .from(contentModules).where(eq(contentModules.key, key)).limit(1)
      const previousPublishedPayload = versions.find(({ id }) => id === moduleBeforePublish?.publishedVersionId)?.payload
      const publication = await transaction.update(contentModules)
        .set({ publishedVersionId })
        .where(and(
          eq(contentModules.key, key),
          sql`${contentModules.publishedVersionId} is distinct from ${publishedVersionId}`,
        )).returning({ key: contentModules.key })

      if (publication.length > 0) {
        await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
          actorUserId: creator.id,
          action: 'content.version_published',
          entityType: 'content_module',
          entityId: key,
          metadata: {
            moduleKey: key,
            previousPublishedVersionId: moduleBeforePublish?.publishedVersionId ?? null,
            source: 'authoritative_v2_1_1_seed',
            version: publishedVersion,
            versionId: publishedVersionId,
          },
        })
      }

      // Keep an untouched editor draft aligned with the newly published source.
      // Never overwrite a draft that staff changed independently.
      if (moduleBeforePublish && (
        isDeepStrictEqual(moduleBeforePublish.draft, {})
        || (previousPublishedPayload !== undefined && isDeepStrictEqual(moduleBeforePublish.draft, previousPublishedPayload))
      )) {
        await transaction.update(contentModules).set({ draft: payload }).where(and(
          eq(contentModules.key, key),
          sql`${contentModules.draft} = ${JSON.stringify(moduleBeforePublish.draft)}::jsonb`,
        ))
      }
    }
  })
}

const run = async () => {
  const creatorUserId = process.env.CONTENT_SEED_CREATOR_USER_ID
  if (!creatorUserId) throw new Error('CONTENT_SEED_CREATOR_USER_ID is required')

  const database = createConfiguredDatabaseClient()
  try {
    await seedInitialContent(database.db, creatorUserId)
  } finally {
    await database.close()
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  void run().catch(() => {
    console.error('Initial content seed failed')
    process.exitCode = 1
  })
}
