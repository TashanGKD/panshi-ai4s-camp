import { z } from 'zod'
import { ApplicationStatusSchema, type ApplicationStatus } from '@panshi/contracts'
import type { AuthenticatedSessionUser } from '../identity/session.service.js'

const uuid = z.string().uuid()
const publicMessage = z.string().trim().min(1).max(2_000)
const internalNote = z.string().trim().max(2_000).optional()
const editableField = z.enum(['name', 'email', 'organization', 'department', 'identityType', 'educationStage', 'majorResearchDirection']).or(uuid)
export const ReviewTransitionInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), targetStatus: ApplicationStatusSchema,
  publicMessage: z.string().trim().max(2_000).optional(), internalNote,
  supplementDeadline: z.iso.datetime().optional(),
  editableFieldIds: z.array(editableField).max(58).default([]),
  editableAttachmentIds: z.array(uuid).max(10).default([]),
}).strict().superRefine((value, context) => {
  if (value.targetStatus === 'needs_supplement') {
    if (!publicMessage.safeParse(value.publicMessage).success) context.addIssue({ code: 'custom', path: ['publicMessage'], message: '待补充材料必须填写面向学员的说明' })
    if (value.editableFieldIds.length + value.editableAttachmentIds.length === 0) context.addIssue({ code: 'custom', path: ['editableFieldIds'], message: '至少开放一个字段或附件项' })
  }
})

export const ReviewListQuerySchema = z.object({
  status: ApplicationStatusSchema.optional(), organization: z.string().trim().max(200).optional(), identityType: z.string().trim().max(100).optional(),
  educationStage: z.string().trim().max(100).optional(), submittedFrom: z.iso.datetime().optional(), submittedTo: z.iso.datetime().optional(),
  search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['submittedAt_desc', 'submittedAt_asc', 'name_asc']).default('submittedAt_desc'),
}).strict()

export type ReviewListQuery = z.infer<typeof ReviewListQuerySchema>
export type ReviewTransitionInput = z.infer<typeof ReviewTransitionInputSchema>
export type ReviewRepository = {
  list: (query: ReviewListQuery) => Promise<{ items: unknown[], total: number }>
  detail: (applicationId: string) => Promise<unknown | null>
  transition: (input: ReviewTransitionInput & { applicationId: string, adminId: string }) => Promise<{ id: string, revision: number, status: ApplicationStatus } | null>
  bulkTransition: (input: { applicationIds: string[], targetStatus: ApplicationStatus, publicMessage?: string, internalNote?: string, adminId: string }) => Promise<Array<{ applicationId: string, success: boolean, status?: ApplicationStatus, code?: string, message?: string }>>
  exportCsv: (query: ReviewListQuery & { includePhone: boolean, adminId: string }) => Promise<{ csv: string, count: number, columns: string[] }>
}

export class ReviewError extends Error { constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); this.name = 'ReviewError' } }
const ensureAdmin = (user: AuthenticatedSessionUser) => { if (user.role !== 'admin' || user.disabledAt) throw new ReviewError(403, 'FORBIDDEN', '无权审核报名') }
const parsedOrError = <T>(result: z.ZodSafeParseResult<T>): T => { if (!result.success) throw new ReviewError(422, 'INVALID_REVIEW_REQUEST', '审核请求格式错误', { fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }); return result.data }
const parseApplicationId = (raw: unknown): string => {
  const parsed = uuid.safeParse(raw)
  if (!parsed.success) throw new ReviewError(400, 'INVALID_APPLICATION_ID', '报名编号格式错误')
  return parsed.data
}
const validateBulkApplicationIds = (raw: unknown) => {
  const candidate = z.object({ applicationIds: z.array(z.unknown()) }).passthrough().safeParse(raw)
  if (!candidate.success) return
  candidate.data.applicationIds.forEach(parseApplicationId)
}

export type ReviewService = ReturnType<typeof createReviewService>
export const createReviewService = (repository: ReviewRepository) => ({
  list: async (admin: AuthenticatedSessionUser, raw: unknown) => { ensureAdmin(admin); const query = parsedOrError(ReviewListQuerySchema.safeParse(raw)); return { apiVersion: 'v1' as const, data: { ...(await repository.list(query)), page: query.page, pageSize: query.pageSize } } },
  detail: async (admin: AuthenticatedSessionUser, rawId: string) => { ensureAdmin(admin); const id = parseApplicationId(rawId); const detail = await repository.detail(id); if (!detail) throw new ReviewError(404, 'APPLICATION_NOT_FOUND', '报名不存在'); return { apiVersion: 'v1' as const, data: detail } },
  transition: async (admin: AuthenticatedSessionUser, rawApplicationId: string, raw: unknown) => { ensureAdmin(admin); const applicationId = parseApplicationId(rawApplicationId); const input = parsedOrError(ReviewTransitionInputSchema.safeParse(raw)); const result = await repository.transition({ ...input, applicationId, adminId: admin.id }); if (!result) throw new ReviewError(409, 'APPLICATION_REVISION_CONFLICT', '报名状态已变化，请刷新后重试'); return { apiVersion: 'v1' as const, data: result } },
  bulkTransition: async (admin: AuthenticatedSessionUser, raw: unknown) => {
    ensureAdmin(admin)
    const schema = z.object({ applicationIds: z.array(uuid).min(1).max(100).transform((ids) => [...new Set(ids)]), targetStatus: z.enum(['reviewing', 'admitted', 'waitlisted', 'rejected']), publicMessage: z.string().trim().max(2_000).optional(), internalNote }).strict()
    validateBulkApplicationIds(raw)
    const input = parsedOrError(schema.safeParse(raw)); return { apiVersion: 'v1' as const, data: { results: await repository.bulkTransition({ ...input, adminId: admin.id }) } }
  },
  exportCsv: async (admin: AuthenticatedSessionUser, raw: unknown) => { ensureAdmin(admin); const query = parsedOrError(ReviewListQuerySchema.safeParse(raw)); return repository.exportCsv({ ...query, includePhone: false, adminId: admin.id }) },
})
