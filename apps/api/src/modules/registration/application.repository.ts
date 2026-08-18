import { and, asc, eq, isNull, notInArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import {
  ApplicationAnswersSchema,
  ApplicationCoreFieldsSchema,
  RegistrationFormSchema,
  type ApplicationAnswers,
  type ApplicationCoreFields,
  type JsonObject,
} from '@panshi/contracts'
import {
  applications, applicationFiles, applicationStatusHistory, applicationVersions, contentModules, contentVersions,
  files, registrationFormDrafts, registrationFormVersions, userProfiles, users,
} from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { shanghaiBusinessDate } from '../../lib/business-date.js'
import { DOCX_MIME, PDF_MIME, type AllowedFileExtension } from '../files/file-validation.js'
import { appendAuditLog } from '../audit/audit.repository.js'
import { enqueueSmsNotification } from '../sms/notification.repository.js'
import { ApplicationSubmissionError, type ApplicationFile, type ApplicationRecord, type ApplicationRepository } from './application.service.js'

const DRAFT_ID = '00000000-0000-4000-8000-000000000010'
const validatedExtensionByMime: Readonly<Record<string, AllowedFileExtension>> = {
  [PDF_MIME]: 'pdf',
  [DOCX_MIME]: 'docx',
}

const registrationWindowFromPayload = (payload: unknown, today: string) => {
  if (typeof payload !== 'object' || payload === null || !('items' in payload) || !Array.isArray(payload.items)) return { open: false as const, reason: 'REGISTRATION_NOT_OPEN' as const }
  if ('machineDates' in payload && typeof payload.machineDates === 'object' && payload.machineDates !== null) {
    const dates = payload.machineDates as Record<string, unknown>
    const start = dates.registrationOpen
    const end = dates.registrationDeadline
    if (typeof start !== 'string' || today < start) return { open: false as const, reason: 'REGISTRATION_NOT_OPEN' as const }
    if (typeof end !== 'string' || today > end) return { open: false as const, reason: 'REGISTRATION_CLOSED' as const }
    return { open: true as const }
  }
  const dates = new Map(payload.items.flatMap((item) => typeof item === 'object' && item !== null && 'machineKey' in item && 'value' in item && typeof item.machineKey === 'string' && typeof item.value === 'string' ? [[item.machineKey, item.value]] : []))
  const start = dates.get('registrationOpen')
  const end = dates.get('registrationDeadline')
  if (!start || today < start) return { open: false as const, reason: 'REGISTRATION_NOT_OPEN' as const }
  if (!end || today > end) return { open: false as const, reason: 'REGISTRATION_CLOSED' as const }
  return { open: true as const }
}

const createCore = (user: { displayName: string, phoneNormalized: string }, profile?: Partial<Omit<ApplicationCoreFields, 'phone'>>): ApplicationCoreFields => ({
  name: profile?.name === '实训营学员' ? '' : profile?.name ?? (user.displayName === '实训营学员' ? '' : user.displayName),
  phone: user.phoneNormalized,
  email: profile?.email ?? '', organization: profile?.organization ?? '', department: profile?.department ?? '',
  identityType: profile?.identityType ?? '', educationStage: profile?.educationStage ?? '', majorResearchDirection: profile?.majorResearchDirection ?? '',
  major: profile?.major ?? '', researchInterest: profile?.researchInterest ?? '', researchDirection: profile?.researchDirection ?? '',
  postdocStation: profile?.postdocStation ?? '', disciplineField: profile?.disciplineField ?? '', supervisor: profile?.supervisor ?? '',
  jobPosition: profile?.jobPosition ?? '', professionalTitleLevel: profile?.professionalTitleLevel ?? '', specificTitle: profile?.specificTitle ?? '',
  identityDescription: profile?.identityDescription ?? '',
})

const legacyProfile = (profile: Omit<ApplicationCoreFields, 'phone'>) => ({
  name: profile.name,
  email: profile.email,
  organization: profile.organization,
  department: profile.department,
  identityType: profile.identityType,
  educationStage: profile.educationStage,
  majorResearchDirection: profile.majorResearchDirection,
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
      supplementPublicMessage: applications.supplementPublicMessage, supplementDeadline: applications.supplementDeadline,
      supplementEditableFieldIds: applications.supplementEditableFieldIds, supplementEditableAttachmentIds: applications.supplementEditableAttachmentIds,
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
      profile: ApplicationCoreFieldsSchema.parse({
        ...(record.coreFields as Record<string, unknown>),
        name: record.status === 'draft' && (record.coreFields as Record<string, unknown>).name === '实训营学员'
          ? ''
          : (record.coreFields as Record<string, unknown>).name,
      }),
      answers: ApplicationAnswersSchema.parse(record.answers),
      attachments: rows as ApplicationFile[],
      unlinkedAttachments: unlinkedRows as Array<Omit<ApplicationFile, 'slotId'>>,
      retiredAnswerIds: Object.keys(record.answers).filter((id) => !activeIds.has(id)),
      supplement: record.status === 'needs_supplement' && record.supplementPublicMessage ? { message: record.supplementPublicMessage, deadline: record.supplementDeadline, editableFieldIds: record.supplementEditableFieldIds, editableAttachmentIds: record.supplementEditableAttachmentIds } : null,
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
      let [existingApplication] = await transaction.select({
        id: applications.id,
        revision: applications.revision,
        status: applications.status,
        formVersionId: applications.formVersionId,
      }).from(applications).where(eq(applications.userId, user.id)).for('update')
      if (!existingApplication) {
        await transaction.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update')
        const [lockedApplication] = await transaction.select({
          id: applications.id,
          revision: applications.revision,
          status: applications.status,
          formVersionId: applications.formVersionId,
        }).from(applications).where(eq(applications.userId, user.id)).for('update')
        existingApplication = lockedApplication
      }
      if (existingApplication && existingApplication.status !== 'draft') {
        const current = await readRecord(transaction as NodePgDatabase<typeof schema>, user.id)
        if (!current) throw new Error('Application disappeared after locking')
        return current
      }
      const published = await latestForm(transaction as NodePgDatabase<typeof schema>)
      if (existingApplication) {
        if (existingApplication.formVersionId !== published.id) {
          await transaction.update(applications).set({ formVersionId: published.id, revision: existingApplication.revision + 1, updatedAt: now() }).where(eq(applications.id, existingApplication.id))
          const activeSlotIds = published.form.attachments.filter((slot) => slot.active).map((slot) => slot.id)
          await transaction.delete(applicationFiles).where(activeSlotIds.length === 0
            ? eq(applicationFiles.applicationId, existingApplication.id)
            : and(eq(applicationFiles.applicationId, existingApplication.id), notInArray(applicationFiles.attachmentSlot, activeSlotIds)))
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

    reopen: (input) => db.transaction(async (transaction) => {
      const [locked] = await transaction.select({ id: applications.id, revision: applications.revision, status: applications.status })
        .from(applications).where(eq(applications.userId, input.user.id)).for('update')
      if (!locked || locked.status !== 'submitted' || locked.revision !== input.expectedRevision) return null
      const reopenedAt = now()
      await transaction.update(applications).set({
        status: 'draft', revision: locked.revision + 1, updatedAt: reopenedAt,
        supplementPublicMessage: null, supplementDeadline: null,
        supplementEditableFieldIds: [], supplementEditableAttachmentIds: [],
      }).where(eq(applications.id, locked.id))
      await transaction.insert(applicationStatusHistory).values({ applicationId: locked.id, fromStatus: 'submitted', toStatus: 'draft', changedBy: input.user.id })
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
        actorUserId: input.user.id,
        action: 'application.reopened',
        entityType: 'application',
        entityId: locked.id,
        metadata: { revision: locked.revision + 1 },
      })
      return readRecord(transaction as NodePgDatabase<typeof schema>, input.user.id)
    }),

    saveDraft: (input) => db.transaction(async (transaction) => {
      const [locked] = await transaction.select({ id: applications.id, revision: applications.revision, status: applications.status, formVersionId: applications.formVersionId })
        .from(applications).where(eq(applications.userId, input.user.id)).for('update')
      if (!locked || !['draft', 'needs_supplement'].includes(locked.status) || locked.revision !== input.expectedRevision) return null
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
        const extension = file ? validatedExtensionByMime[file.mimeType] : undefined
        if (!file || !extension || !slot.allowedExtensions.includes(extension) || file.sizeBytes > slot.maxSizeBytes) throw new Error('APPLICATION_ATTACHMENT_INVALID')
      }
      const core = createCore(input.user, input.profile)
      const persistedProfile = legacyProfile(input.profile)
      await transaction.insert(userProfiles).values({ userId: input.user.id, ...persistedProfile }).onConflictDoUpdate({ target: userProfiles.userId, set: { ...persistedProfile, updatedAt: now() } })
      await transaction.update(applications).set({ coreFields: core, answers: input.answers as ApplicationAnswers as JsonObject, revision: locked.revision + 1, updatedAt: now() }).where(eq(applications.id, locked.id))
      await transaction.delete(applicationFiles).where(eq(applicationFiles.applicationId, locked.id))
      if (input.attachments.length > 0) await transaction.insert(applicationFiles).values(input.attachments.map((reference) => ({ applicationId: locked.id, fileId: reference.fileId, purpose: 'registration_attachment', attachmentSlot: reference.slotId })))
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.user.id, action: 'application.draft_saved', entityType: 'application', entityId: locked.id, metadata: { revision: locked.revision + 1, answerCount: Object.keys(input.answers).length, attachmentCount: input.attachments.length } })
      return readRecord(transaction as NodePgDatabase<typeof schema>, input.user.id)
    }),

    submit: (input) => db.transaction(async (transaction) => {
      const [locked] = await transaction.select().from(applications).where(eq(applications.userId, input.user.id)).for('update')
      if (!locked || !['draft', 'needs_supplement'].includes(locked.status) || locked.revision !== input.expectedRevision) return null
      if (locked.status === 'draft') { const window = await getWindow(transaction as NodePgDatabase<typeof schema>); if (!window.open) return null }
      const [published] = await transaction.select({ versionId: registrationFormDrafts.baseVersionId }).from(registrationFormDrafts)
        .where(eq(registrationFormDrafts.id, DRAFT_ID)).for('share')
      if (!published?.versionId || published.versionId !== locked.formVersionId) throw new ApplicationSubmissionError('form_version_changed')
      const [account] = await transaction.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, input.user.id)).for('update')
      if (!account || account.disabledAt !== null) return null
      const record = await readRecord(transaction as NodePgDatabase<typeof schema>, input.user.id)
      if (!record) return null
      const lockedFiles = await transaction.select({
        id: files.id, slotId: applicationFiles.attachmentSlot, ownerUserId: files.ownerUserId, purpose: files.purpose,
        attachmentSlot: files.attachmentSlot, originalName: files.originalName, mimeType: files.mimeType,
        sizeBytes: files.sizeBytes, sha256: files.sha256,
        lifecycleState: files.lifecycleState, hiddenAt: files.hiddenAt, deletedAt: files.deletedAt,
      }).from(applicationFiles).innerJoin(files, eq(files.id, applicationFiles.fileId))
        .where(eq(applicationFiles.applicationId, record.id)).orderBy(asc(files.id)).for('update', { of: files })
      const validSlots = new Map(record.form.attachments.filter((slot) => slot.active).map((slot) => [slot.id, slot]))
      const attachmentErrors: Array<{ path: string, message: string }> = []
      for (const file of lockedFiles) {
        const path = `attachments.${file.slotId}`
        const slot = validSlots.get(file.slotId)
        if (file.ownerUserId !== input.user.id || file.purpose !== 'registration_attachment' || file.attachmentSlot !== file.slotId || !slot || file.lifecycleState !== 'active' || file.hiddenAt !== null || file.deletedAt !== null) {
          attachmentErrors.push({ path, message: '附件不存在或当前不可用，请重新上传' })
          continue
        }
        const extension = validatedExtensionByMime[file.mimeType]
        if (!extension || !slot.allowedExtensions.includes(extension)) {
          attachmentErrors.push({ path, message: `文件格式不符合当前要求，仅支持 ${slot.allowedExtensions.map((item) => item.toUpperCase()).join('、')}` })
        } else if (file.sizeBytes > slot.maxSizeBytes) {
          attachmentErrors.push({ path, message: `文件大小超过当前限制（最大 ${slot.maxSizeBytes} 字节）` })
        }
      }
      if (attachmentErrors.length > 0) throw new ApplicationSubmissionError('attachment_invalid', attachmentErrors)
      const linkedSlots = new Set(lockedFiles.map((file) => file.slotId))
      const missingRequired = record.form.attachments.filter((slot) => slot.active && slot.required && !linkedSlots.has(slot.id))
        .map((slot) => ({ path: `attachments.${slot.id}`, message: '此附件为必填项' }))
      if (missingRequired.length > 0) throw new ApplicationSubmissionError('attachment_invalid', missingRequired)
      const submittedAt = now()
      const retiredAnswerIds = record.retiredAnswerIds
      const retiredIds = new Set(retiredAnswerIds)
      const activeAnswers = Object.fromEntries(Object.entries(record.answers).filter(([id]) => !retiredIds.has(id)))
      const retiredAnswers = Object.fromEntries(Object.entries(record.answers).filter(([id]) => retiredIds.has(id)))
      const snapshot = {
        formVersionId: record.formVersionId, formVersion: record.formVersion, form: record.form,
        profile: record.profile, answers: activeAnswers, retiredAnswers, retiredAnswerIds,
        attachments: lockedFiles.map(({ id, slotId, originalName, mimeType, sizeBytes, sha256 }) => ({
          fileId: id, slotId, originalName, mimeType, validatedType: validatedExtensionByMime[mimeType]!, sizeBytes, sha256,
        })),
        submittedAt: submittedAt.toISOString(),
      }
      const isSupplement = locked.status === 'needs_supplement'
      const isResubmission = locked.status === 'draft' && locked.submittedAt !== null
      const reason = isSupplement ? 'supplement_resubmission' : isResubmission ? 'resubmission' : 'initial_submission'
      const [version] = await transaction.insert(applicationVersions).values({ applicationId: record.id, snapshot: snapshot as unknown as JsonObject, reason }).returning({ id: applicationVersions.id })
      if (!version) throw new Error('Application version creation failed')
      const nextStatus = isSupplement ? 'reviewing' : 'submitted'
      await transaction.update(applications).set({ status: nextStatus, revision: locked.revision + 1, submittedAt, updatedAt: submittedAt, supplementPublicMessage: null, supplementDeadline: null, supplementEditableFieldIds: [], supplementEditableAttachmentIds: [] }).where(eq(applications.id, record.id))
      await transaction.insert(applicationStatusHistory).values({ applicationId: record.id, fromStatus: locked.status, toStatus: nextStatus, changedBy: input.user.id })
      await enqueueSmsNotification(transaction as NodePgDatabase<typeof schema>, {
        eventKey: `application-submitted:${version.id}`,
        eventType: 'application_submitted',
        applicationId: record.id,
        userId: input.user.id,
        phoneNormalized: input.user.phoneNormalized,
      })
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.user.id, action: isSupplement ? 'application.supplement_resubmitted' : 'application.submitted', entityType: 'application', entityId: record.id, metadata: { formVersionId: record.formVersionId, answerCount: Object.keys(activeAnswers).length, retiredAnswerCount: retiredAnswerIds.length, attachmentCount: lockedFiles.length } })
      return { applicationId: record.id, versionId: version.id, submittedAt }
    }),

    listTimeline: async (applicationId) => (await db.select({ status: applicationStatusHistory.toStatus, createdAt: applicationStatusHistory.createdAt, publicReason: applicationStatusHistory.reason })
      .from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, applicationId)).orderBy(asc(applicationStatusHistory.createdAt))),
    registrationWindow: () => getWindow(db),
  }
}
