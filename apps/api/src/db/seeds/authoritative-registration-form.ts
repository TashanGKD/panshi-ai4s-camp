import { isDeepStrictEqual } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_REGISTRATION_FORM, REGISTRATION_PROFICIENCY_LEVELS, RegistrationFormSchema, type JsonObject, type RegistrationForm } from '@panshi/contracts'
import { eq, max, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'
import { createConfiguredDatabaseClient } from '../client.js'
import { registrationFormDrafts, registrationFormVersions, users } from '../schema.js'
import type * as schema from '../schema.js'
import { appendAuditLog } from '../../modules/audit/audit.repository.js'
import { authoritativeProblemPool } from './authoritative-problem-pool.js'

const textQuestion = (
  id: string,
  order: number,
  label: string,
  required = true,
  visibleWhen?: { questionId: string, includes: string },
) => ({ id, type: 'long_text' as const, label, helpText: '', required, order, active: true, validation: {}, ...(visibleWhen ? { visibleWhen } : {}) })

const participationQuestionId = '71000000-0000-4000-8000-000000000008'
const problemPoolQuestionId = '71000000-0000-4000-8000-000000000012'
const legacyDefaultRegistrationForm: RegistrationForm = {
  ...DEFAULT_REGISTRATION_FORM,
  attachments: DEFAULT_REGISTRATION_FORM.attachments.map((attachment) => ({
    ...attachment,
    helpText: '支持 PDF、DOCX，单个文件不超过 10 MB。',
    allowedExtensions: ['pdf', 'docx'],
  })),
}

export const authoritativeRegistrationForm: RegistrationForm = RegistrationFormSchema.parse({
  ...DEFAULT_REGISTRATION_FORM,
  questions: [
    {
      id: '71000000-0000-4000-8000-000000000011', type: 'proficiency_matrix', label: '编程、数据分析和人工智能基础',
      helpText: '请根据目前的实际情况，为每项能力选择最符合的等级。', required: true, order: 0, active: true, validation: {}, allowOther: true,
      items: ['Python', 'C/C++', 'R', 'MATLAB', 'SQL/数据库', 'Linux/Shell', 'Git/版本控制', '数据分析与可视化', '机器学习/深度学习', '大语言模型', '智能体开发'].map((label, index) => ({
        id: `74000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        value: ['python', 'cpp', 'r', 'matlab', 'sql', 'linux-shell', 'git', 'data-analysis', 'machine-learning', 'large-language-model', 'agent-development'][index]!,
        label,
      })),
      levels: REGISTRATION_PROFICIENCY_LEVELS.map((level, index) => ({ id: `75000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, ...level })),
    },
    textQuestion('71000000-0000-4000-8000-000000000002', 1, '已有科研、竞赛、工程或项目经历', false),
    {
      id: '71000000-0000-4000-8000-000000000003', type: 'multiple_choice', label: '感兴趣的课程专题', helpText: '', required: true, order: 2, active: true, validation: {},
      options: [
        { id: '72000000-0000-4000-8000-000000000001', value: 'research-agent', label: '科研智能体' },
        { id: '72000000-0000-4000-8000-000000000002', value: 'ai4s-methodology', label: 'AI4S 科研方法论' },
        { id: '72000000-0000-4000-8000-000000000003', value: 'scientific-model', label: '科学模型' },
        { id: '72000000-0000-4000-8000-000000000004', value: 'end-to-end-loop', label: '自驱动的端到端科研闭环' },
      ],
    },
    {
      id: '71000000-0000-4000-8000-000000000007', type: 'single_choice', label: '是否可以线下参加实训', helpText: '', required: true, order: 3, active: true, validation: {},
      options: [
        { id: '72000000-0000-4000-8000-000000000005', value: 'yes', label: '是' },
        { id: '72000000-0000-4000-8000-000000000006', value: 'no', label: '否' },
      ],
    },
    {
      id: participationQuestionId, type: 'multiple_choice', label: '是否愿意参加晚间研讨、开放实践及实训营后的持续项目研究', helpText: '', required: true, order: 4, active: true, validation: {},
      options: [
        { id: '72000000-0000-4000-8000-000000000007', value: 'evening-seminar', label: '晚间研讨' },
        { id: '72000000-0000-4000-8000-000000000008', value: 'open-practice', label: '开放实践' },
        { id: '72000000-0000-4000-8000-000000000009', value: 'continued-research', label: '持续项目研究' },
        { id: '72000000-0000-4000-8000-000000000010', value: 'not-yet', label: '暂不确定' },
      ],
    },
    {
      id: problemPoolQuestionId, type: 'multiple_choice', label: '从实训营问题池中选择 1—3 个 AI4S 问题',
      helpText: '最希望在实训营中了解、研讨或继续研究的问题。 请选择 1—3 项，或提出自己的问题', required: true, order: 5, active: true,
      validation: { minSelections: 1, maxSelections: 3 },
      visibleWhen: { questionId: participationQuestionId, includes: 'open-practice' },
      options: [
        ...authoritativeProblemPool.map(({ id, value, label, description }) => ({ id, value, label, description })),
        { id: '73000000-0000-4000-8000-000000000020', value: 'other-problem', label: '其他：本人希望提出和研讨的科研问题' },
      ],
    },
    textQuestion('71000000-0000-4000-8000-000000000013', 6, '本人希望提出和研讨的科研问题', true, { questionId: problemPoolQuestionId, includes: 'other-problem' }),
    textQuestion('71000000-0000-4000-8000-000000000006', 7, '对课程的主要预期', false),
  ],
})

type SeedDatabase = NodePgDatabase<typeof schema>
const draftId = '00000000-0000-4000-8000-000000000010'
const seedLockKey = '7857262737405661871'

export const seedAuthoritativeRegistrationForm = async (db: SeedDatabase, creatorUserId: string) => {
  const creatorId = z.string().uuid().parse(creatorUserId)
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(${seedLockKey}::bigint)`)
    const [creator] = await transaction.select({ id: users.id }).from(users).where(eq(users.id, creatorId)).limit(1)
    if (!creator) throw new Error('CONTENT_SEED_CREATOR_USER_ID must reference an existing user')

    const [draft] = await transaction.select().from(registrationFormDrafts).where(eq(registrationFormDrafts.id, draftId)).for('update')
    if (!draft) throw new Error('Registration form draft is missing; run database migrations first')
    const previous = draft.baseVersionId
      ? (await transaction.select({ form: registrationFormVersions.schema }).from(registrationFormVersions).where(eq(registrationFormVersions.id, draft.baseVersionId)).limit(1))[0]?.form
      : undefined
    const safeToReplace = isDeepStrictEqual(draft.schema, DEFAULT_REGISTRATION_FORM)
      || isDeepStrictEqual(draft.schema, legacyDefaultRegistrationForm)
      || (previous !== undefined && isDeepStrictEqual(draft.schema, previous))
      || isDeepStrictEqual(draft.schema, authoritativeRegistrationForm)
    if (!safeToReplace) throw new Error('Registration form draft has unpublished staff changes; refusing to overwrite it')

    const versions = await transaction.select({ id: registrationFormVersions.id, version: registrationFormVersions.version, form: registrationFormVersions.schema }).from(registrationFormVersions)
    let version = versions.find((candidate) => isDeepStrictEqual(candidate.form, authoritativeRegistrationForm))
    if (!version) {
      const [latest] = await transaction.select({ value: max(registrationFormVersions.version) }).from(registrationFormVersions)
      const [created] = await transaction.insert(registrationFormVersions).values({
        schema: authoritativeRegistrationForm as unknown as JsonObject,
        version: (latest?.value ?? 0) + 1,
        createdBy: creatorId,
        publishedAt: new Date(),
      }).returning({ id: registrationFormVersions.id, version: registrationFormVersions.version })
      if (!created) throw new Error('Registration form version insert failed')
      version = { ...created, form: authoritativeRegistrationForm as unknown as JsonObject }
      await appendAuditLog(transaction as SeedDatabase, {
        actorUserId: creatorId, action: 'registration_form.published', entityType: 'registration_form_version', entityId: created.id,
        metadata: {
          version: created.version,
          revision: draft.revision + (isDeepStrictEqual(draft.schema, authoritativeRegistrationForm) ? 0 : 1),
          summary: {
            questionCount: authoritativeRegistrationForm.questions.length,
            activeQuestionCount: authoritativeRegistrationForm.questions.filter(({ active }) => active).length,
            attachmentCount: authoritativeRegistrationForm.attachments.length,
            activeAttachmentCount: authoritativeRegistrationForm.attachments.filter(({ active }) => active).length,
          },
        },
      })
    }
    const revision = draft.revision + (isDeepStrictEqual(draft.schema, authoritativeRegistrationForm) ? 0 : 1)
    await transaction.update(registrationFormDrafts).set({
      schema: authoritativeRegistrationForm,
      revision,
      publishedRevision: revision,
      baseVersionId: version.id,
      updatedBy: creatorId,
      updatedAt: new Date(),
    }).where(eq(registrationFormDrafts.id, draftId))
  })
}

const run = async () => {
  const creatorUserId = process.env.CONTENT_SEED_CREATOR_USER_ID
  if (!creatorUserId) throw new Error('CONTENT_SEED_CREATOR_USER_ID is required')
  const database = createConfiguredDatabaseClient()
  try { await seedAuthoritativeRegistrationForm(database.db, creatorUserId) } finally { await database.close() }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) void run().catch((error) => { console.error(error instanceof Error ? error.message : 'Registration form seed failed'); process.exitCode = 1 })
