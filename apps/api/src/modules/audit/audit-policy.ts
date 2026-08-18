import { ApplicationStatusSchema, ContentModuleKeySchema, ResourceAccessSchema, type JsonObject } from '@panshi/contracts'
import { z } from 'zod'

const Count = z.number().int().nonnegative()
const Revision = Count
const Uuid = z.string().uuid()
const Result = z.literal('success')
const FilePurpose = z.enum(['registration_attachment', 'resource', 'legacy'])
const FileVisibility = z.enum(['owner_admin', 'public', 'authenticated', 'admitted'])
const FileFailureCode = z.enum([
  'FILE_STORAGE_COLLISION', 'FILE_STORAGE_DELETE_FAILED', 'FILE_STORAGE_KEY_INVALID',
  'FILE_STORAGE_MARKER_INVALID', 'FILE_STORAGE_ROOT_UNSAFE', 'FILE_STORAGE_SYMLINK_REJECTED',
  'FILE_STORAGE_TARGET_CLEANUP_FAILED',
])
const AttachmentSlot = z.string().regex(/^(?:[a-z][a-z0-9_-]{0,63}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u).nullable()
const ValueTypes = z.object({ array: Count, object: Count, string: Count, number: Count, boolean: Count, null: Count }).strict()
const Shape = z.object({ fieldCount: Count, valueTypes: ValueTypes }).strict()
const FormSummary = z.object({ questionCount: Count, activeQuestionCount: Count, attachmentCount: Count, activeAttachmentCount: Count }).strict()
const ResourceMetadata = z.object({ accessScope: ResourceAccessSchema, sortOrder: z.number().int() }).strict()
const FileMetadata = z.object({ purpose: FilePurpose, visibility: FileVisibility }).strict()
const FileFailureMetadata = z.object({ failureCode: FileFailureCode }).strict()
const AdminResult = z.object({ result: Result }).strict()
const AdminSessionResult = z.object({ result: Result, revokedSessionCount: Count }).strict()
const RevokedSessions = z.object({ revokedSessionCount: Count }).strict()
const SeedSource = z.enum(['initial_content_seed', 'authoritative_v2_1_1_seed'])
const CheckInMetadata = z.object({ applicationId: Uuid, credentialId: Uuid, revision: Revision }).strict()
const CheckInCredentialMetadata = z.object({ applicationId: Uuid, revision: Revision }).strict()

const definitions = {
  'admin.created': { entityType: 'user', metadata: AdminResult },
  'admin.disabled': { entityType: 'user', metadata: AdminSessionResult },
  'admin.password_reset': { entityType: 'user', metadata: AdminSessionResult },
  'admin.profile_updated': { entityType: 'user', metadata: z.object({ changedFields: z.tuple([z.literal('displayName')]) }).strict() },
  'auth.password_changed': { entityType: 'user', metadata: RevokedSessions },
  'student.disabled': { entityType: 'user', metadata: AdminResult },
  'student.enabled': { entityType: 'user', metadata: AdminResult },
  'student.password_reset_required': { entityType: 'user', metadata: z.object({ revokedSessionCount: Count, resetMethod: z.literal('verification_code') }).strict() },
  'auth.login_succeeded': { entityType: 'session', metadata: z.object({ authenticationMethod: z.literal('password') }).strict() },
  'auth.student_registered': { entityType: 'user', metadata: z.object({ authenticationMethod: z.literal('verification_code') }).strict() },
  'auth.password_reset': { entityType: 'user', metadata: z.object({ revokedSessions: z.literal(true) }).strict() },
  'content.version_created': { entityType: 'content_version', metadata: z.object({ moduleKey: ContentModuleKeySchema, source: SeedSource, version: Revision }).strict() },
  'content.version_published': { entityType: 'content_module', metadata: z.object({ moduleKey: ContentModuleKeySchema, previousPublishedVersionId: Uuid.nullable(), source: SeedSource, version: Revision, versionId: Uuid }).strict() },
  'content.draft_saved': { entityType: 'content_module', metadata: z.object({ moduleKey: ContentModuleKeySchema, before: z.object({ revision: Revision }).strict(), after: z.object({ revision: Revision, shape: Shape }).strict() }).strict() },
  'content.published': { entityType: 'content_module', metadata: z.object({ moduleKey: ContentModuleKeySchema, revision: Revision, version: Revision, before: z.object({ publishedVersion: Revision.nullable() }).strict(), after: z.object({ publishedVersion: Revision, shape: Shape }).strict() }).strict() },
  'content.rolled_back': { entityType: 'content_module', metadata: z.object({ moduleKey: ContentModuleKeySchema, sourceVersion: Revision, version: Revision, revision: Revision, before: z.object({ publishedVersion: Revision.nullable() }).strict(), after: z.object({ publishedVersion: Revision, shape: Shape }).strict() }).strict() },
  'file.uploaded': { entityType: 'file', metadata: z.object({ purpose: FilePurpose, visibility: FileVisibility, mimeType: z.enum(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']), sizeBytes: Count, attachmentSlot: AttachmentSlot }).strict() },
  'file.storage_rejected': { entityType: 'file_storage_recovery', metadata: FileFailureMetadata },
  'file.upload_cleanup_failed': { entityType: 'file_storage_recovery', metadata: FileFailureMetadata },
  'file.hidden': { entityType: 'file', metadata: FileMetadata },
  'file.delete_started': { entityType: 'file', metadata: FileMetadata },
  'file.delete_failed': { entityType: 'file', metadata: FileFailureMetadata },
  'file.deleted': { entityType: 'file', metadata: FileMetadata },
  'registration_form.draft_saved': { entityType: 'registration_form_draft', metadata: z.object({ revision: Revision, summary: FormSummary }).strict() },
  'registration_form.published': { entityType: 'registration_form_version', metadata: z.object({ version: Revision, revision: Revision, summary: FormSummary }).strict() },
  'application.draft_saved': { entityType: 'application', metadata: z.object({ revision: Revision, answerCount: Count, attachmentCount: Count }).strict() },
  'application.reopened': { entityType: 'application', metadata: z.object({ revision: Revision }).strict() },
  'application.submitted': { entityType: 'application', metadata: z.object({ formVersionId: Uuid, answerCount: Count, retiredAnswerCount: Count, attachmentCount: Count }).strict() },
  'application.supplement_resubmitted': { entityType: 'application', metadata: z.object({ formVersionId: Uuid, answerCount: Count, retiredAnswerCount: Count, attachmentCount: Count }).strict() },
  'application.status_changed': { entityType: 'application', metadata: z.object({ fromStatus: ApplicationStatusSchema, toStatus: ApplicationStatusSchema, revision: Revision, editableFieldCount: Count, editableAttachmentCount: Count }).strict() },
  'application.bulk_status_changed': { entityType: 'application_batch', metadata: z.object({ targetStatus: ApplicationStatusSchema, requestedCount: Count, successCount: Count, failureCount: Count }).strict() },
  'application.exported': { entityType: 'application_export', metadata: z.object({ status: ApplicationStatusSchema.nullable(), organizationFilterApplied: z.boolean(), identityTypeFilterApplied: z.boolean(), educationStageFilterApplied: z.boolean(), submittedFromFilterApplied: z.boolean(), submittedToFilterApplied: z.boolean(), searchProvided: z.boolean(), columnCount: Count, count: Count }).strict() },
  'check_in.credential_issued': { entityType: 'check_in_credential', metadata: CheckInCredentialMetadata },
  'check_in.confirmed': { entityType: 'check_in', metadata: CheckInMetadata },
  'check_in.reconfirmed': { entityType: 'check_in', metadata: CheckInMetadata },
  'check_in.repeated_lookup': { entityType: 'check_in', metadata: CheckInMetadata },
  'check_in.revoked': { entityType: 'check_in', metadata: CheckInMetadata.extend({ reason: z.string().trim().min(2).max(500) }).strict() },
  'resource.draft_created': { entityType: 'resource', metadata: ResourceMetadata },
  'resource.draft_saved': { entityType: 'resource', metadata: ResourceMetadata },
  'resource.published': { entityType: 'resource', metadata: ResourceMetadata },
  'resource.unpublished': { entityType: 'resource', metadata: ResourceMetadata },
} as const
const nullEntityActions = new Set<AuditAction>(['auth.login_succeeded', 'application.bulk_status_changed', 'application.exported'])
const contentModuleEntityActions = new Set<AuditAction>(['content.version_published', 'content.draft_saved', 'content.published', 'content.rolled_back'])

export type AuditAction = keyof typeof definitions
export type AuditEntry = {
  actorUserId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: JsonObject
}

export class AuditPolicyError extends Error {
  constructor(message: string) { super(message); this.name = 'AuditPolicyError' }
}

export const prepareAuditEntry = (entry: AuditEntry): AuditEntry => {
  const definition = definitions[entry.action as AuditAction]
  if (!definition) throw new AuditPolicyError(`Unsupported audit action: ${entry.action}`)
  if (entry.entityType !== definition.entityType) throw new AuditPolicyError(`Invalid entity type for audit action: ${entry.action}`)
  const actor = z.string().uuid().nullable().safeParse(entry.actorUserId)
  const entityIdSchema = nullEntityActions.has(entry.action as AuditAction)
    ? z.null()
    : contentModuleEntityActions.has(entry.action as AuditAction) ? ContentModuleKeySchema : Uuid
  const entityId = entityIdSchema.safeParse(entry.entityId ?? null)
  const metadata = definition.metadata.safeParse(entry.metadata ?? {})
  if (!actor.success || !entityId.success || !metadata.success) throw new AuditPolicyError(`Invalid audit entry: ${entry.action}`)
  return { ...entry, actorUserId: actor.data, entityId: entityId.data, metadata: metadata.data as JsonObject }
}

export const sanitizeAuditMetadata = (action: string, metadata: unknown): JsonObject => {
  const definition = definitions[action as AuditAction]
  if (!definition) return {}
  const parsed = definition.metadata.safeParse(metadata)
  return parsed.success ? parsed.data as JsonObject : {}
}

export const sensitiveAuditText = (value: string) => /password|passwd|secret|token|cookie|verification|验证码|密码|手机号|(?:\+?86)?1[3-9]\d{9}|\$2[aby]\$|(?:^|\s)\/(?:Users|private|home|var)\//iu.test(value)
