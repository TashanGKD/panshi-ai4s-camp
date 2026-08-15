import { and, desc, eq, max } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { RegistrationFormSchema, type JsonObject, type RegistrationForm } from '@panshi/contracts'
import { registrationFormDrafts, registrationFormVersions } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { appendAuditLog } from '../audit/audit.repository.js'
import type { RegistrationFormRepository, RegistrationFormVersionRecord } from './form.service.js'

const DRAFT_ID = '00000000-0000-4000-8000-000000000010'

const toForm = (value: unknown): RegistrationForm => RegistrationFormSchema.parse(value)

const summary = (form: RegistrationForm) => ({
  questionCount: form.questions.length,
  activeQuestionCount: form.questions.filter((question) => question.active).length,
  attachmentCount: form.attachments.length,
  activeAttachmentCount: form.attachments.filter((attachment) => attachment.active).length,
})

const toVersionRecord = (record: {
  id: string
  version: number
  schema: JsonObject
  createdBy: string | null
  createdAt: Date
}): RegistrationFormVersionRecord => ({
  id: record.id,
  version: record.version,
  form: toForm(record.schema),
  createdBy: record.createdBy ?? 'system',
  createdAt: record.createdAt,
})

const readDraft = async (db: NodePgDatabase<typeof schema>) => {
  const [record] = await db.select({
    form: registrationFormDrafts.schema,
    revision: registrationFormDrafts.revision,
    publishedRevision: registrationFormDrafts.publishedRevision,
    baseVersionId: registrationFormDrafts.baseVersionId,
    baseVersion: registrationFormVersions.version,
  }).from(registrationFormDrafts)
    .leftJoin(registrationFormVersions, eq(registrationFormVersions.id, registrationFormDrafts.baseVersionId))
    .where(eq(registrationFormDrafts.id, DRAFT_ID)).limit(1)
  if (!record) return null
  return {
    form: toForm(record.form), revision: record.revision, baseVersion: record.baseVersion ?? null,
    publishedVersionId: record.baseVersionId,
  }
}

export const createRegistrationFormRepository = (
  db: NodePgDatabase<typeof schema>,
): RegistrationFormRepository => ({
  getDraft: () => readDraft(db),

  saveDraft: async ({ form, expectedRevision, actorUserId }) => db.transaction(async (transaction) => {
    const [updated] = await transaction.update(registrationFormDrafts).set({
      schema: form, revision: expectedRevision + 1, updatedBy: actorUserId, updatedAt: new Date(),
    }).where(and(eq(registrationFormDrafts.id, DRAFT_ID), eq(registrationFormDrafts.revision, expectedRevision)))
      .returning({ revision: registrationFormDrafts.revision })
    if (!updated) return null
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId, action: 'registration_form.draft_saved', entityType: 'registration_form_draft', entityId: DRAFT_ID,
      metadata: { revision: updated.revision, summary: summary(form) },
    })
    const draft = await readDraft(transaction as NodePgDatabase<typeof schema>)
    if (!draft) throw new Error('Registration form draft disappeared after update')
    return draft
  }),

  publishDraft: async ({ expectedRevision, actorUserId }) => db.transaction(async (transaction) => {
    const [draft] = await transaction.select({
      form: registrationFormDrafts.schema,
      revision: registrationFormDrafts.revision,
      publishedRevision: registrationFormDrafts.publishedRevision,
      publishedVersionId: registrationFormDrafts.baseVersionId,
    }).from(registrationFormDrafts).where(eq(registrationFormDrafts.id, DRAFT_ID)).for('update')
    if (!draft || draft.revision !== expectedRevision || draft.publishedRevision === expectedRevision) return null
    const form = toForm(draft.form)
    const [latest] = await transaction.select({ value: max(registrationFormVersions.version) }).from(registrationFormVersions)
    const version = (latest?.value ?? 0) + 1
    const [created] = await transaction.insert(registrationFormVersions).values({
      schema: form as unknown as JsonObject, version, createdBy: actorUserId, publishedAt: new Date(),
    }).returning({ id: registrationFormVersions.id })
    if (!created) throw new Error('Registration form version insert failed')
    await transaction.update(registrationFormDrafts).set({
      baseVersionId: created.id, publishedRevision: draft.revision, updatedBy: actorUserId, updatedAt: new Date(),
    })
      .where(eq(registrationFormDrafts.id, DRAFT_ID))
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId, action: 'registration_form.published', entityType: 'registration_form_version', entityId: created.id,
      metadata: { version, revision: draft.revision, summary: summary(form) },
    })
    return { revision: draft.revision, version, formVersionId: created.id }
  }),

  listVersions: async () => {
    const [draft] = await db.select({ publishedVersion: registrationFormVersions.version })
      .from(registrationFormDrafts).leftJoin(registrationFormVersions, eq(registrationFormVersions.id, registrationFormDrafts.baseVersionId))
      .where(eq(registrationFormDrafts.id, DRAFT_ID)).limit(1)
    const versions = await db.select({
      id: registrationFormVersions.id, version: registrationFormVersions.version, schema: registrationFormVersions.schema,
      createdBy: registrationFormVersions.createdBy, createdAt: registrationFormVersions.createdAt,
    }).from(registrationFormVersions).orderBy(desc(registrationFormVersions.version))
    return { publishedVersion: draft?.publishedVersion ?? null, versions: versions.map(toVersionRecord) }
  },

  getPublished: async () => {
    const [record] = await db.select({
      id: registrationFormVersions.id, version: registrationFormVersions.version, schema: registrationFormVersions.schema,
      createdBy: registrationFormVersions.createdBy, createdAt: registrationFormVersions.createdAt,
    }).from(registrationFormDrafts).innerJoin(registrationFormVersions, eq(registrationFormVersions.id, registrationFormDrafts.baseVersionId))
      .where(eq(registrationFormDrafts.id, DRAFT_ID)).limit(1)
    return record ? toVersionRecord(record) : null
  },

  getVersion: async (id) => {
    const [record] = await db.select({
      id: registrationFormVersions.id, version: registrationFormVersions.version, schema: registrationFormVersions.schema,
      createdBy: registrationFormVersions.createdBy, createdAt: registrationFormVersions.createdAt,
    }).from(registrationFormVersions).where(eq(registrationFormVersions.id, id)).limit(1)
    return record ? toVersionRecord(record) : null
  },
})
