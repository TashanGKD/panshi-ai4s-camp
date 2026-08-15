import { and, asc, eq, isNull, notInArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { RegistrationFormSchema, type ApplicationCoreFields, type JsonObject } from '@panshi/contracts'
import {
  applications, applicationFiles, applicationStatusHistory, applicationVersions, auditLogs, contentModules, contentVersions,
  files, registrationFormDrafts, registrationFormVersions, userProfiles, users,
} from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { shanghaiBusinessDate } from '../../lib/business-date.js'
import type { ApplicationFile, ApplicationRecord, ApplicationRepository } from './application.service.js'

const DRAFT_ID = '00000000-0000-4000-8000-000000000010'

const registrationWindowFromPayload = (payload: unknown, today: string) => {
  if (typeof payload !== 'object' || payload === null || !('items' in payload) || !Array.isArray(payload.items)) return { open: false as const, reason: 'REGISTRATION_NOT_OPEN' as const }
  const dates = new Map(payload.items.flatMap((item) => typeof item === 'object' && item !== null && 'machineKey' in item && 'value' in item && typeof item.machineKey === 'string' && typeof item.value === 'string' ? [[item.machineKey, item.value]] : []))
  const start = dates.get('registrationOpen')
  const end = dates.get('registrationDeadline')
  if (!start || today < start) return { open: false as const, reason: 'REGISTRATION_NOT_OPEN' as const }
  if (!end || today > end) return { open: false as const, reason: 'REGISTRATION_CLOSED' as const }
  return { open: true as const }
}

const createCore = (user: { displayName: string, phoneNormalized: string }, profile?: Omit<ApplicationCoreFields, 'phone'>): ApplicationCoreFields => ({
  name: profile?.name ?? user.displayName,
  phone: user.phoneNormalized,
  email: profile?.email ?? '', organization: profile?.organization ?? '', department: profile?.department ?? '',
  identityType: profile?.identityType ?? '', educationStage: profile?.educationStage ?? '', majorResearchDirection: profile?.majorResearchDirection ?? '',
})

export const createApplicationRepository = (
  db: NodePgDatabase<typeof schema>,
  options: { now?: () => Date } = {},
): ApplicationRepository => {
  const now = options.now ?? (() => new Date())

  const latestForm = async (database: NodePgDatabase<typeof schema>) => {
    const [record] = await database.select({ id: registrationFormVersions.id, version: registrationFormVersions.version, form: registrationFormVersions.schema })
      .from(registrationFormDrafts).innerJoin(registrationFormVersions, eq(registrationFormVersions.id, registrationFormDrafts.baseVersionId))
      .where(eq(registrationFormDrafts.id, DRAFT_ID)).limit(1)
    if (!record) throw new Error('Published registration form is required')
    return { ...record, form: RegistrationFormSchema.parse(record.form) }
  }

  const readRecord = async (database: NodePgDatabase<typeof schema>, userId: string): Promise<ApplicationRecord | null> => {
    const [record] = await database.select({
      id: applications.id, revision: applications.revision, status: applications.status, formVersionId: applications.formVersionId,
      formVersion: registrationFormVersions.version, form: registrationFormVersions.schema, coreFields: applications.coreFields,
      answers: applications.answers, submittedAt: applications.submittedAt, updatedAt: applications.updatedAt,
    }).from(applications).innerJoin(registrationFormVersions, eq(registrationFormVersions.id, applications.formVersionId))
      .where(eq(applications.userId, userId)).limit(1)
    if (!record) return null
    const form = RegistrationFormSchema.parse(record.form)
    const rows = await database.select({
      id: files.id, slotId: applicationFiles.attachmentSlot, originalName: files.originalName, mimeType: files.mimeType, sizeBytes: files.sizeBytes,
    }).from(applicationFiles).innerJoin(files, eq(files.id, applicationFiles.fileId))
      .where(and(eq(applicationFiles.applicationId, record.id), eq(files.lifecycleState, 'active'), isNull(files.hiddenAt), isNull(files.deletedAt))).orderBy(asc(applicationFiles.createdAt))
    const unlinkedRows = await database.select({
      id: files.id, originalName: files.originalName, mimeType: files.mimeType, sizeBytes: files.sizeBytes,
    }).from(files).leftJoin(applicationFiles, eq(applicationFiles.fileId, files.id)).where(and(
      eq(files.ownerUserId, userId), eq(files.purpose, 'registration_attachment'), eq(files.lifecycleState, 'active'),
      isNull(files.hiddenAt), isNull(files.deletedAt), isNull(applicationFiles.fileId),
    )).orderBy(asc(files.createdAt))
    const activeIds = new Set(form.questions.filter((question) => question.active).map((question) => question.id))
    return {
      id: record.id, revision: record.revision, status: record.status, formVersionId: record.formVersionId,
      formVersion: record.formVersion, submittedAt: record.submittedAt, updatedAt: record.updatedAt,
      form,
      profile: record.coreFields as ApplicationCoreFields,
      answers: record.answers as Record<string, string | string[]>,
      attachments: rows as ApplicationFile[],
      unlinkedAttachments: unlinkedRows as Array<Omit<ApplicationFile, 'slotId'>>,
      retiredAnswerIds: Object.keys(record.answers).filter((id) => !activeIds.has(id)),
    }
  }

  const getWindow = async (database: NodePgDatabase<typeof schema>) => {
    const [record] = await database.select({ payload: contentVersions.payload }).from(contentModules)
      .innerJoin(contentVersions, and(eq(contentVersions.moduleKey, contentModules.key), eq(contentVersions.id, contentModules.publishedVersionId)))
      .where(eq(contentModules.key, 'importantDates')).limit(1)
    return registrationWindowFromPayload(record?.payload, shanghaiBusinessDate(now()))
  }

  return {
    getOrCreateDraft: (user) => db.transaction(async (transaction) => {
      const [existingApplication] = await transaction.select({ id: applications.id }).from(applications).where(eq(applications.userId, user.id)).for('update')
      if (!existingApplication) {
        await transaction.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update')
        await transaction.select({ id: applications.id }).from(applications).where(eq(applications.userId, user.id)).for('update')
      }
      const current = await readRecord(transaction as NodePgDatabase<typeof schema>, user.id)
      if (current && current.status !== 'draft') return current
      const published = await latestForm(transaction as NodePgDatabase<typeof schema>)
      if (current) {
        if (current.formVersionId !== published.id) {
          await transaction.update(applications).set({ formVersionId: published.id, revision: current.revision + 1, updatedAt: now() }).where(eq(applications.id, current.id))
          const activeSlotIds = published.form.attachments.filter((slot) => slot.active).map((slot) => slot.id)
          await transaction.delete(applicationFiles).where(activeSlotIds.length === 0
            ? eq(applicationFiles.applicationId, current.id)
            : and(eq(applicationFiles.applicationId, current.id), notInArray(applicationFiles.attachmentSlot, activeSlotIds)))
        }
      } else {
        const [existingProfile] = await transaction.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1)
        const core = createCore(user, existingProfile ?? undefined)
        await transaction.insert(applications).values({ userId: user.id, formVersionId: published.id, coreFields: core, answers: {} })
        await transaction.insert(applicationStatusHistory).values({ applicationId: (await readRecord(transaction as NodePgDatabase<typeof schema>, user.id))!.id, fromStatus: null, toStatus: 'draft', changedBy: user.id })
      }
      const result = await readRecord(transaction as NodePgDatabase<typeof schema>, user.id)
      if (!result) throw new Error('Application draft creation failed')
      return result
    }),

    saveDraft: (input) => db.transaction(async (transaction) => {
      const [locked] = await transaction.select({ id: applications.id, revision: applications.revision, status: applications.status, formVersionId: applications.formVersionId })
        .from(applications).where(eq(applications.userId, input.user.id)).for('update')
      if (!locked || locked.status !== 'draft' || locked.revision !== input.expectedRevision) return null
      const [formRow] = await transaction.select({ form: registrationFormVersions.schema }).from(registrationFormVersions).where(eq(registrationFormVersions.id, locked.formVersionId))
      const form = RegistrationFormSchema.parse(formRow?.form)
      const slots = new Map(form.attachments.filter((slot) => slot.active).map((slot) => [slot.id, slot]))
      const slotIds = new Set<string>()
      for (const reference of input.attachments) {
        if (slotIds.has(reference.slotId) || !slots.has(reference.slotId)) throw new Error('APPLICATION_ATTACHMENT_INVALID')
        slotIds.add(reference.slotId)
        const [file] = await transaction.select().from(files).where(and(
          eq(files.id, reference.fileId), eq(files.ownerUserId, input.user.id), eq(files.purpose, 'registration_attachment'),
          eq(files.attachmentSlot, reference.slotId), eq(files.lifecycleState, 'active'), isNull(files.hiddenAt), isNull(files.deletedAt),
        )).limit(1)
        const slot = slots.get(reference.slotId)!
        const extension = file?.mimeType === 'application/pdf' ? 'pdf' : file?.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'docx' : ''
        if (!file || !slot.allowedExtensions.includes(extension as 'pdf' | 'docx') || file.sizeBytes > slot.maxSizeBytes) throw new Error('APPLICATION_ATTACHMENT_INVALID')
      }
      const core = createCore(input.user, input.profile)
      await transaction.insert(userProfiles).values({ userId: input.user.id, ...input.profile }).onConflictDoUpdate({ target: userProfiles.userId, set: { ...input.profile, updatedAt: now() } })
      await transaction.update(applications).set({ coreFields: core, answers: input.answers as JsonObject, revision: locked.revision + 1, updatedAt: now() }).where(eq(applications.id, locked.id))
      await transaction.delete(applicationFiles).where(eq(applicationFiles.applicationId, locked.id))
      if (input.attachments.length > 0) await transaction.insert(applicationFiles).values(input.attachments.map((reference) => ({ applicationId: locked.id, fileId: reference.fileId, purpose: 'registration_attachment', attachmentSlot: reference.slotId })))
      await transaction.insert(auditLogs).values({ actorUserId: input.user.id, action: 'application.draft_saved', entityType: 'application', entityId: locked.id, metadata: { revision: locked.revision + 1, answerCount: Object.keys(input.answers).length, attachmentCount: input.attachments.length } })
      return readRecord(transaction as NodePgDatabase<typeof schema>, input.user.id)
    }),

    submit: (input) => db.transaction(async (transaction) => {
      const window = await getWindow(transaction as NodePgDatabase<typeof schema>)
      if (!window.open) return null
      const [locked] = await transaction.select().from(applications).where(eq(applications.userId, input.user.id)).for('update')
      if (!locked || locked.status !== 'draft' || locked.revision !== input.expectedRevision) return null
      const [account] = await transaction.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, input.user.id)).for('update')
      if (!account || account.disabledAt !== null) return null
      const record = await readRecord(transaction as NodePgDatabase<typeof schema>, input.user.id)
      if (!record) return null
      const lockedFiles = await transaction.select({
        id: files.id, slotId: applicationFiles.attachmentSlot, ownerUserId: files.ownerUserId, purpose: files.purpose,
        attachmentSlot: files.attachmentSlot, lifecycleState: files.lifecycleState, hiddenAt: files.hiddenAt, deletedAt: files.deletedAt,
      }).from(applicationFiles).innerJoin(files, eq(files.id, applicationFiles.fileId))
        .where(eq(applicationFiles.applicationId, record.id)).orderBy(asc(files.id)).for('update', { of: files })
      const validSlots = new Set(record.form.attachments.filter((slot) => slot.active).map((slot) => slot.id))
      if (lockedFiles.some((file) => file.ownerUserId !== input.user.id || file.purpose !== 'registration_attachment' || file.attachmentSlot !== file.slotId || !validSlots.has(file.slotId) || file.lifecycleState !== 'active' || file.hiddenAt !== null || file.deletedAt !== null)) {
        throw new Error('APPLICATION_ATTACHMENT_INVALID')
      }
      const linkedSlots = new Set(lockedFiles.map((file) => file.slotId))
      if (record.form.attachments.some((slot) => slot.active && slot.required && !linkedSlots.has(slot.id))) throw new Error('APPLICATION_ATTACHMENT_INVALID')
      const submittedAt = now()
      const snapshot = {
        formVersionId: record.formVersionId, formVersion: record.formVersion, form: record.form,
        profile: record.profile, answers: record.answers,
        attachments: record.attachments.map(({ id, slotId, originalName, mimeType, sizeBytes }) => ({ fileId: id, slotId, originalName, mimeType, sizeBytes })),
        submittedAt: submittedAt.toISOString(),
      }
      const [version] = await transaction.insert(applicationVersions).values({ applicationId: record.id, snapshot: snapshot as unknown as JsonObject, reason: 'initial_submission' }).returning({ id: applicationVersions.id })
      if (!version) throw new Error('Application version creation failed')
      await transaction.update(applications).set({ status: 'submitted', revision: locked.revision + 1, submittedAt, updatedAt: submittedAt }).where(eq(applications.id, record.id))
      await transaction.insert(applicationStatusHistory).values({ applicationId: record.id, fromStatus: 'draft', toStatus: 'submitted', changedBy: input.user.id })
      await transaction.insert(auditLogs).values({ actorUserId: input.user.id, action: 'application.submitted', entityType: 'application', entityId: record.id, metadata: { formVersionId: record.formVersionId, answerCount: Object.keys(record.answers).length, attachmentCount: record.attachments.length } })
      return { applicationId: record.id, versionId: version.id, submittedAt }
    }),

    listTimeline: async (applicationId) => (await db.select({ status: applicationStatusHistory.toStatus, createdAt: applicationStatusHistory.createdAt, publicReason: applicationStatusHistory.reason })
      .from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, applicationId)).orderBy(asc(applicationStatusHistory.createdAt))),
    registrationWindow: () => getWindow(db),
  }
}
