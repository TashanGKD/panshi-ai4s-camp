import { isDeepStrictEqual } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ContentModuleKeySchema,
  PublicContentPayloadSchemas,
  type JsonObject,
} from '@panshi/contracts'
import { and, eq, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'
import { createConfiguredDatabaseClient } from '../client.js'
import { auditLogs, contentModules, contentVersions, users } from '../schema.js'
import type * as schema from '../schema.js'

export const initialPublishedContent = {
  basic: {
    title: '磐石·科学智能（AI for Science）实训营',
    dates: {
      start: '2026-08-23',
      end: '2026-08-27',
      label: '2026-08-23 至 2026-08-27',
    },
    venue: '中国科学院物理研究所',
    tagline: '面向科研实践的五日科学智能集中实训',
    intro: [
      '实训营围绕 AI for Science 的知识框架、科研智能体与真实科研问题实践展开。',
    ],
    target: '有志于从事 AI4S 及其交叉学科研究与应用的青年科研人员、硕博研究生和本科生。',
  },
  features: {
    items: [
      { title: '系统化知识框架', description: '围绕科学数据、科学模型、科研智能体与端到端科研闭环组织学习。' },
      { title: '实践嵌入', description: '将智能体构建与应用嵌入文献调研、问题定义、数据处理和结果核验。' },
      { title: '真实问题牵引', description: '通过课程学习、习题课和分组研讨逐步完善 AI4S 问题分析方案。' },
    ],
  },
  importantDates: {
    items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }],
  },
  schedule: {
    days: [
      { date: '2026-08-23', label: '第一天（周日）', theme: '科研智能体', sessions: [] },
      { date: '2026-08-24', label: '第二天（周一）', theme: 'AI4S 科研方法论', sessions: [] },
      { date: '2026-08-25', label: '第三天（周二）', theme: '科学模型', sessions: [] },
      { date: '2026-08-26', label: '第四天（周三）', theme: '自驱动的端到端科研闭环', sessions: [] },
      { date: '2026-08-27', label: '第五天（周四）', theme: '参访交流与结营', sessions: [] },
    ],
  },
  contacts: { items: [] },
  display: {
    series: '磐石科学智能实训营',
    footer: '磐石·科学智能（AI for Science）实训营',
  },
} as const

const publishedVersionIds = {
  basic: '60000000-0000-4000-8000-000000000001',
  features: '60000000-0000-4000-8000-000000000002',
  importantDates: '60000000-0000-4000-8000-000000000004',
  schedule: '60000000-0000-4000-8000-000000000005',
  contacts: '60000000-0000-4000-8000-000000000006',
  display: '60000000-0000-4000-8000-000000000008',
} as const

type SeedDatabase = NodePgDatabase<typeof schema>

export const seedInitialContent = async (db: SeedDatabase, creatorUserId: string) => {
  const parsedCreatorUserId = z.string().uuid().parse(creatorUserId)
  const [creator] = await db.select({ id: users.id }).from(users).where(eq(users.id, parsedCreatorUserId)).limit(1)
  if (!creator) throw new Error('CONTENT_SEED_CREATOR_USER_ID must reference an existing user')

  await db.transaction(async (transaction) => {
    await transaction.insert(contentModules).values(ContentModuleKeySchema.options.map((key) => ({
      key,
      draft: {},
      draftRevision: 0,
    }))).onConflictDoNothing()

    for (const key of Object.keys(initialPublishedContent) as (keyof typeof initialPublishedContent)[]) {
      const payload = PublicContentPayloadSchemas[key].parse(initialPublishedContent[key]) as JsonObject
      const versionId = publishedVersionIds[key]
      const [existing] = await transaction.select({
        id: contentVersions.id,
        payload: contentVersions.payload,
      }).from(contentVersions).where(and(
        eq(contentVersions.moduleKey, key),
        eq(contentVersions.version, 1),
      )).limit(1)

      let inserted = false
      let publishedVersionId: string = versionId
      if (existing) {
        if (!isDeepStrictEqual(existing.payload, payload)) {
          throw new Error(`Initial content version already exists with different payload: ${key}`)
        }
        publishedVersionId = existing.id
      } else {
        await transaction.insert(contentVersions).values({
          id: versionId,
          moduleKey: key,
          version: 1,
          payload,
          createdBy: creator.id,
        })
        inserted = true
      }

      await transaction.update(contentModules)
        .set({ publishedVersionId })
        .where(and(
          eq(contentModules.key, key),
          isNull(contentModules.publishedVersionId),
        ))

      if (inserted) {
        await transaction.insert(auditLogs).values({
          actorUserId: creator.id,
          action: 'content.initial_seed',
          entityType: 'content_version',
          entityId: versionId,
          metadata: { moduleKey: key, version: 1 },
        })
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
