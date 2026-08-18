import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  AdminCheckInConfirmRequestSchema,
  AdminCheckInLookupRequestSchema,
  AdminCheckInLookupResponseSchema,
  AdminCheckInMutationResponseSchema,
  AdminCheckInRevokeRequestSchema,
  StudentCheckInResponseSchema,
  type ApplicationStatus,
  type AdminCheckInRecord,
} from '@panshi/contracts'
import { z } from 'zod'
import type { AuthenticatedSessionUser } from '../identity/session.service.js'

const uuid = z.string().uuid()

type CredentialRecord = {
  id: string
  applicationId: string
  publicId: string
  revision: number
  revokedAt: Date | null
}

type CheckInRecord = {
  id: string
  active: boolean
  confirmedAt: Date
  confirmedByName: string
  revokedAt: Date | null
  revokeReason: string | null
  revision: number
}

export type CheckInContext = {
  applicationId: string
  credential: CredentialRecord | null
  applicationStatus: ApplicationStatus
  profile: {
    name: string
    phone: string
    organization: string
    department: string
    identityType: string
  }
  checkIn: CheckInRecord | null
}

export type CheckInRepository = {
  findStudentContext: (userId: string) => Promise<CheckInContext | null>
  ensureCredential: (applicationId: string, actorUserId: string) => Promise<CredentialRecord>
  findByPublicId: (publicId: string) => Promise<CheckInContext | null>
  recordRepeatedLookup: (input: { checkInId: string, applicationId: string, credentialId: string, adminId: string, revision: number }) => Promise<void>
  confirm: (input: { credentialId: string, adminId: string, expectedRevision: number }) => Promise<(CheckInContext & { duplicate: boolean }) | null>
  revoke: (input: { credentialId: string, adminId: string, expectedRevision: number, reason: string }) => Promise<(CheckInContext & { duplicate: boolean }) | null>
}

export class CheckInError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'CheckInError'
  }
}

const ensureStudent = (user: AuthenticatedSessionUser) => {
  if (user.role !== 'user' || user.disabledAt) throw new CheckInError(403, 'FORBIDDEN', '仅学员账号可访问报到二维码')
}

const ensureAdmin = (user: AuthenticatedSessionUser) => {
  if (user.role !== 'admin' || user.disabledAt) throw new CheckInError(403, 'FORBIDDEN', '无权进行现场报到操作')
}

const parseOrError = <T>(result: z.ZodSafeParseResult<T>, code: string, message: string): T => {
  if (!result.success) throw new CheckInError(422, code, message, { fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) })
  return result.data
}

const toAdminRecord = (context: CheckInContext): AdminCheckInRecord => {
  if (!context.credential || context.applicationStatus !== 'admitted') throw new CheckInError(404, 'CHECK_IN_CODE_INVALID', '报到码无效或已失效')
  const state = context.checkIn?.active ? 'checked_in' : context.checkIn ? 'revoked' : 'not_checked_in'
  return {
    credentialId: context.credential.id,
    applicationId: context.credential.applicationId,
    ...context.profile,
    applicationStatus: 'admitted',
    checkInState: state,
    revision: context.checkIn?.revision ?? context.credential.revision,
    firstCheckedInAt: context.checkIn?.confirmedAt.toISOString() ?? null,
    firstCheckedInBy: context.checkIn?.confirmedByName ?? null,
    revokedAt: context.checkIn?.revokedAt?.toISOString() ?? null,
    revokeReason: context.checkIn?.revokeReason ?? null,
  }
}

export const createCheckInService = (
  repository: CheckInRepository,
  options: { tokenSecret: string },
) => {
  const secret = Buffer.from(options.tokenSecret, 'hex')
  if (secret.length !== 32) throw new Error('Check-in token secret must contain 32 bytes')

  const signature = (publicId: string) => createHmac('sha256', secret).update(`panshi-check-in-v1:${publicId}`).digest('base64url')
  const credential = (publicId: string) => `${publicId}.${signature(publicId)}`
  const verifyCredential = (raw: string) => {
    const separator = raw.lastIndexOf('.')
    if (separator <= 0) throw new CheckInError(404, 'CHECK_IN_CODE_INVALID', '报到码无效或已失效')
    const publicId = raw.slice(0, separator)
    const supplied = raw.slice(separator + 1)
    if (!uuid.safeParse(publicId).success) throw new CheckInError(404, 'CHECK_IN_CODE_INVALID', '报到码无效或已失效')
    const expected = signature(publicId)
    const expectedBytes = Buffer.from(expected)
    const suppliedBytes = Buffer.from(supplied)
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      throw new CheckInError(404, 'CHECK_IN_CODE_INVALID', '报到码无效或已失效')
    }
    return publicId
  }

  return {
    getStudentCredential: async (student: AuthenticatedSessionUser) => {
      ensureStudent(student)
      const context = await repository.findStudentContext(student.id)
      if (!context || context.applicationStatus !== 'admitted') {
        return StudentCheckInResponseSchema.parse({ apiVersion: 'v1', data: { availability: 'unavailable', reason: '录取后开放报到二维码' } })
      }
      const issued = context.credential?.revokedAt === null ? context.credential : await repository.ensureCredential(context.applicationId, student.id)
      const data = {
        availability: context.checkIn?.active ? 'checked_in' as const : 'available' as const,
        qrPayload: credential(issued.publicId),
        displayCode: issued.publicId.slice(0, 8).toUpperCase(),
        checkedInAt: context.checkIn?.active ? context.checkIn.confirmedAt.toISOString() : null,
      }
      return StudentCheckInResponseSchema.parse({ apiVersion: 'v1', data })
    },

    lookup: async (admin: AuthenticatedSessionUser, raw: unknown) => {
      ensureAdmin(admin)
      const input = parseOrError(AdminCheckInLookupRequestSchema.safeParse(raw), 'INVALID_CHECK_IN_REQUEST', '报到码格式错误')
      const publicId = verifyCredential(input.code)
      const context = await repository.findByPublicId(publicId)
      if (!context?.credential || context.credential.revokedAt || context.applicationStatus !== 'admitted') throw new CheckInError(404, 'CHECK_IN_CODE_INVALID', '报到码无效或已失效')
      if (context.checkIn?.active) await repository.recordRepeatedLookup({ checkInId: context.checkIn.id, applicationId: context.applicationId, credentialId: context.credential.id, adminId: admin.id, revision: context.checkIn.revision })
      return AdminCheckInLookupResponseSchema.parse({ apiVersion: 'v1', data: toAdminRecord(context) })
    },

    confirm: async (admin: AuthenticatedSessionUser, rawCredentialId: string, raw: unknown) => {
      ensureAdmin(admin)
      const credentialId = parseOrError(uuid.safeParse(rawCredentialId), 'INVALID_CHECK_IN_ID', '报到记录编号格式错误')
      const input = parseOrError(AdminCheckInConfirmRequestSchema.safeParse(raw), 'INVALID_CHECK_IN_REQUEST', '确认报到请求格式错误')
      const result = await repository.confirm({ credentialId, adminId: admin.id, expectedRevision: input.expectedRevision })
      if (!result) throw new CheckInError(409, 'CHECK_IN_REVISION_CONFLICT', '报到状态已变化，请重新扫码')
      return AdminCheckInMutationResponseSchema.parse({ apiVersion: 'v1', data: { ...toAdminRecord(result), duplicate: result.duplicate } })
    },

    revoke: async (admin: AuthenticatedSessionUser, rawCredentialId: string, raw: unknown) => {
      ensureAdmin(admin)
      const credentialId = parseOrError(uuid.safeParse(rawCredentialId), 'INVALID_CHECK_IN_ID', '报到记录编号格式错误')
      const input = parseOrError(AdminCheckInRevokeRequestSchema.safeParse(raw), 'INVALID_CHECK_IN_REQUEST', '撤销报到请求格式错误')
      const result = await repository.revoke({ credentialId, adminId: admin.id, expectedRevision: input.expectedRevision, reason: input.reason })
      if (!result) throw new CheckInError(409, 'CHECK_IN_REVISION_CONFLICT', '报到状态已变化，请重新扫码')
      return AdminCheckInMutationResponseSchema.parse({ apiVersion: 'v1', data: { ...toAdminRecord(result), duplicate: result.duplicate } })
    },
  }
}

export type CheckInService = ReturnType<typeof createCheckInService>
