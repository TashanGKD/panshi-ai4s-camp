import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { RegistrationFormSchema, type ApplicationStatus } from '@panshi/contracts'
import { applicationFiles, applications, applicationStatusHistory, applicationVersions, files, registrationFormVersions, users } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { appendAuditLog } from '../audit/audit.repository.js'
import { ReviewError, type ReviewListQuery, type ReviewRepository, type ReviewTransitionInput } from './review.service.js'

const allowedTransitions: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  draft: [], submitted: ['reviewing'], reviewing: ['needs_supplement', 'admitted', 'waitlisted', 'rejected'],
  needs_supplement: ['reviewing'], admitted: [], waitlisted: [], rejected: [],
}

const filtersFor = (query: ReviewListQuery): SQL[] => {
  const filters: SQL[] = []
  if (query.status) filters.push(eq(applications.status, query.status))
  if (query.organization) filters.push(sql`${applications.coreFields}->>'organization' = ${query.organization}`)
  if (query.identityType) filters.push(sql`${applications.coreFields}->>'identityType' = ${query.identityType}`)
  if (query.educationStage) filters.push(sql`${applications.coreFields}->>'educationStage' = ${query.educationStage}`)
  if (query.submittedFrom) filters.push(gte(applications.submittedAt, new Date(query.submittedFrom)))
  if (query.submittedTo) filters.push(lte(applications.submittedAt, new Date(query.submittedTo)))
  if (query.search) {
    const term = `%${query.search.replace(/[\\%_]/gu, '\\$&')}%`
    filters.push(or(ilike(sql`${applications.coreFields}->>'name'`, term), ilike(users.phoneNormalized, term), ilike(sql`${applications.coreFields}->>'organization'`, term))!)
  }
  return filters
}

const whereFor = (filters: SQL[]) => filters.length ? and(...filters) : undefined
const orderFor = (sort: ReviewListQuery['sort']) => sort === 'submittedAt_asc'
  ? [asc(applications.submittedAt), asc(applications.id)]
  : sort === 'name_asc' ? [asc(sql`${applications.coreFields}->>'name'`), asc(applications.id)] : [desc(applications.submittedAt), desc(applications.id)]

const listRows = async (db: NodePgDatabase<typeof schema>, query: ReviewListQuery, limit = query.pageSize, offset = (query.page - 1) * query.pageSize) => db.select({
  id: applications.id, revision: applications.revision, status: applications.status, submittedAt: applications.submittedAt, updatedAt: applications.updatedAt,
  name: sql<string>`${applications.coreFields}->>'name'`, phone: users.phoneNormalized,
  organization: sql<string>`${applications.coreFields}->>'organization'`, identityType: sql<string>`${applications.coreFields}->>'identityType'`, educationStage: sql<string>`${applications.coreFields}->>'educationStage'`,
}).from(applications).innerJoin(users, eq(users.id, applications.userId)).where(whereFor(filtersFor(query))).orderBy(...orderFor(query.sort)).limit(limit).offset(offset)

const csvCell = (value: unknown) => {
  let text = value instanceof Date ? value.toISOString() : String(value ?? '')
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export const createReviewRepository = (db: NodePgDatabase<typeof schema>, options: { exportLimit?: number } = {}): ReviewRepository => {
  const exportLimit = options.exportLimit ?? 5_000

  const transitionInTransaction = async (transaction: NodePgDatabase<typeof schema>, input: ReviewTransitionInput & { applicationId: string, adminId: string }) => {
    const [locked] = await transaction.select().from(applications).where(eq(applications.id, input.applicationId)).for('update')
    if (!locked) throw new ReviewError(404, 'APPLICATION_NOT_FOUND', '报名不存在')
    if (locked.revision !== input.expectedRevision) return null
    if (!allowedTransitions[locked.status].includes(input.targetStatus)) throw new ReviewError(409, 'INVALID_STATUS_TRANSITION', `不允许从 ${locked.status} 变更为 ${input.targetStatus}`)
    if (input.targetStatus === 'needs_supplement') {
      const [version] = await transaction.select({ form: registrationFormVersions.schema }).from(registrationFormVersions).where(eq(registrationFormVersions.id, locked.formVersionId)).limit(1)
      const form = RegistrationFormSchema.parse(version?.form)
      const allowedFields = new Set<string>(['name', 'email', 'organization', 'department', 'identityType', 'major', 'researchInterest', 'researchDirection', 'postdocStation', 'disciplineField', 'supervisor', 'jobPosition', 'professionalTitleLevel', 'specificTitle', 'identityDescription', ...form.questions.filter((item) => item.active).map((item) => item.id)])
      const allowedAttachments = new Set(form.attachments.filter((item) => item.active).map((item) => item.id))
      if (input.editableFieldIds.some((id) => !allowedFields.has(id)) || input.editableAttachmentIds.some((id) => !allowedAttachments.has(id))) throw new ReviewError(422, 'INVALID_SUPPLEMENT_WHITELIST', '补充材料白名单包含无效字段')
    }
    const changedAt = new Date()
    const nextRevision = locked.revision + 1
    await transaction.update(applications).set({
      status: input.targetStatus, revision: nextRevision, updatedAt: changedAt,
      supplementPublicMessage: input.targetStatus === 'needs_supplement' ? input.publicMessage! : null,
      supplementDeadline: input.targetStatus === 'needs_supplement' && input.supplementDeadline ? new Date(input.supplementDeadline) : null,
      supplementEditableFieldIds: input.targetStatus === 'needs_supplement' ? input.editableFieldIds : [],
      supplementEditableAttachmentIds: input.targetStatus === 'needs_supplement' ? input.editableAttachmentIds : [],
      internalReviewNote: input.internalNote ?? locked.internalReviewNote,
    }).where(and(eq(applications.id, locked.id), eq(applications.revision, locked.revision)))
    await transaction.insert(applicationStatusHistory).values({
      applicationId: locked.id,
      fromStatus: locked.status,
      toStatus: input.targetStatus,
      changedBy: input.adminId,
      reason: input.targetStatus === 'needs_supplement' ? input.publicMessage : null,
      internalNote: input.internalNote ?? null,
    })
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.adminId, action: 'application.status_changed', entityType: 'application', entityId: locked.id, metadata: { fromStatus: locked.status, toStatus: input.targetStatus, revision: nextRevision, editableFieldCount: input.editableFieldIds.length, editableAttachmentCount: input.editableAttachmentIds.length } })
    return { id: locked.id, revision: nextRevision, status: input.targetStatus }
  }

  return {
    list: async (query) => {
      const filters = filtersFor(query)
      const [totals, items] = await Promise.all([
        db.select({ value: count() }).from(applications).innerJoin(users, eq(users.id, applications.userId)).where(whereFor(filters)),
        listRows(db, query),
      ])
      return { items: items.map((item) => ({ ...item, submittedAt: item.submittedAt?.toISOString() ?? null, updatedAt: item.updatedAt.toISOString() })), total: Number(totals[0]?.value ?? 0) }
    },
    detail: async (applicationId) => {
      const [record] = await db.select({ application: applications, phone: users.phoneNormalized, form: registrationFormVersions.schema, formVersion: registrationFormVersions.version }).from(applications)
        .innerJoin(users, eq(users.id, applications.userId)).innerJoin(registrationFormVersions, eq(registrationFormVersions.id, applications.formVersionId)).where(eq(applications.id, applicationId)).limit(1)
      if (!record) return null
      const [versions, history, attachments] = await Promise.all([
        db.select().from(applicationVersions).where(eq(applicationVersions.applicationId, applicationId)).orderBy(desc(applicationVersions.createdAt)),
        db.select({ fromStatus: applicationStatusHistory.fromStatus, toStatus: applicationStatusHistory.toStatus, reason: applicationStatusHistory.reason, internalNote: applicationStatusHistory.internalNote, createdAt: applicationStatusHistory.createdAt, changedBy: applicationStatusHistory.changedBy }).from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, applicationId)).orderBy(asc(applicationStatusHistory.createdAt)),
        db.select({ id: files.id, slotId: applicationFiles.attachmentSlot, originalName: files.originalName, mimeType: files.mimeType, sizeBytes: files.sizeBytes }).from(applicationFiles).innerJoin(files, eq(files.id, applicationFiles.fileId)).where(eq(applicationFiles.applicationId, applicationId)),
      ])
      return { application: { ...record.application, phone: record.phone, form: record.form, formVersion: record.formVersion, submittedAt: record.application.submittedAt?.toISOString() ?? null, createdAt: record.application.createdAt.toISOString(), updatedAt: record.application.updatedAt.toISOString() }, versions: versions.map((v) => ({ id: v.id, snapshot: v.snapshot, reason: v.reason, createdAt: v.createdAt.toISOString() })), history: history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })), attachments: attachments.map((file) => ({ ...file, downloadUrl: `/api/v1/files/${file.id}/download` })) }
    },
    transition: async (input) => db.transaction((transaction) => transitionInTransaction(transaction as NodePgDatabase<typeof schema>, input)),
    bulkTransition: async (input) => {
      const results = []
      for (const applicationId of [...new Set(input.applicationIds)]) {
        try {
          const [record] = await db.select({ revision: applications.revision }).from(applications).where(eq(applications.id, applicationId)).limit(1)
          if (!record) { results.push({ applicationId, success: false, code: 'APPLICATION_NOT_FOUND', message: '报名不存在' }); continue }
          const changed = await db.transaction((transaction) => transitionInTransaction(transaction as NodePgDatabase<typeof schema>, { applicationId, adminId: input.adminId, expectedRevision: record.revision, targetStatus: input.targetStatus, publicMessage: input.publicMessage, internalNote: input.internalNote, editableFieldIds: [], editableAttachmentIds: [] }))
          results.push(changed ? { applicationId, success: true, status: changed.status } : { applicationId, success: false, code: 'APPLICATION_REVISION_CONFLICT', message: '报名状态已变化' })
        } catch (error) { results.push({ applicationId, success: false, code: error instanceof ReviewError ? error.code : 'REVIEW_FAILED', message: error instanceof Error ? error.message : '审核失败' }) }
      }
      await appendAuditLog(db, { actorUserId: input.adminId, action: 'application.bulk_status_changed', entityType: 'application_batch', entityId: null, metadata: { targetStatus: input.targetStatus, requestedCount: new Set(input.applicationIds).size, successCount: results.filter((item) => item.success).length, failureCount: results.filter((item) => !item.success).length } })
      return results
    },
    exportCsv: async (query) => {
      const items = await listRows(db, { ...query, page: 1, pageSize: 100 }, exportLimit + 1, 0)
      if (items.length > exportLimit) throw new ReviewError(413, 'EXPORT_TOO_LARGE', `筛选结果超过 ${exportLimit} 条，请缩小范围`)
      const columns = ['报名编号', '状态', '姓名', '单位', '身份类型', '学历阶段', '提交时间']
      const lines = [columns.map(csvCell).join(','), ...items.map((item) => [item.id, item.status, item.name, item.organization, item.identityType, item.educationStage, item.submittedAt].map(csvCell).join(','))]
      await appendAuditLog(db, { actorUserId: query.adminId, action: 'application.exported', entityType: 'application_export', entityId: null, metadata: {
        status: query.status ?? null,
        organizationFilterApplied: Boolean(query.organization),
        identityTypeFilterApplied: Boolean(query.identityType),
        educationStageFilterApplied: Boolean(query.educationStage),
        submittedFromFilterApplied: Boolean(query.submittedFrom),
        submittedToFilterApplied: Boolean(query.submittedTo),
        searchProvided: Boolean(query.search),
        columnCount: columns.length,
        count: items.length,
      } })
      return { csv: `\uFEFF${lines.join('\r\n')}\r\n`, count: items.length, columns }
    },
  }
}
