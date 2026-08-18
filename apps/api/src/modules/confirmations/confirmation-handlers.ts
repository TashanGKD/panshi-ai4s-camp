import {
  ApplicationDraftSaveRequestSchema,
  ApplicationReopenRequestSchema,
  ApplicationSubmitRequestSchema,
  PasswordResetRequestSchema,
  SendVerificationCodeRequestSchema,
  StudentLoginRequestSchema,
  StudentRegistrationRequestSchema,
  learnerCapabilities,
  normalizeMainlandChinaMobile,
  type JsonObject,
  type LearnerCapabilityId,
} from '@panshi/contracts'
import { z } from 'zod'
import type { ConfirmationActor } from './confirmation.service.js'
import type { SessionService } from '../identity/session.service.js'
import type { VerificationService } from '../identity/verification.service.js'
import type { ApplicationService } from '../registration/application.service.js'
import type { FileService } from '../files/file.service.js'
import type { AdminManagementService } from '../identity/admin-management.service.js'

export type ConfirmationPreparation = {
  preview: JsonObject
  targetType?: string | null
  targetId?: string | null
  expectedRevision?: number | null
}

export type ConfirmationHandler = {
  capabilityId: LearnerCapabilityId
  prepare: (payload: JsonObject) => ConfirmationPreparation | Promise<ConfirmationPreparation>
  executionBindingPayload?: (preparedPayload: JsonObject, executionPayload: JsonObject) => JsonObject
  execute: (input: {
    actor: ConfirmationActor
    actorUserId: string | null
    preparedPayload: JsonObject
    executionPayload: JsonObject
    serverContext?: unknown
  }) => Promise<JsonObject | ConfirmationHandlerResult>
}

export class ConfirmationHandlerInputError extends Error {
  constructor() {
    super('CONFIRMATION_EXECUTION_INPUT_INVALID')
    this.name = 'ConfirmationHandlerInputError'
  }
}

export class ConfirmationHandlerResult {
  constructor(readonly safeResult: JsonObject, readonly responseResult: JsonObject) {}
}
export const confirmationHandlerResult = (safeResult: JsonObject, responseResult: JsonObject) => new ConfirmationHandlerResult(safeResult, responseResult)
export const isConfirmationHandlerResult = (value: JsonObject | ConfirmationHandlerResult): value is ConfirmationHandlerResult => value instanceof ConfirmationHandlerResult

export type ConfirmationHandlerRegistry = ReadonlyMap<LearnerCapabilityId, ConfirmationHandler>

export const createConfirmationHandlerRegistry = (
  handlers: readonly ConfirmationHandler[],
): ConfirmationHandlerRegistry => {
  const registry = new Map<LearnerCapabilityId, ConfirmationHandler>()
  for (const handler of handlers) {
    const capability = learnerCapabilities.find(({ id }) => id === handler.capabilityId)
    if (!capability || capability.effect === 'read' || capability.confirmation === 'none') {
      throw new Error(`Capability is not confirmable: ${handler.capabilityId}`)
    }
    if (registry.has(handler.capabilityId)) throw new Error(`Duplicate confirmation handler: ${handler.capabilityId}`)
    registry.set(handler.capabilityId, handler)
  }
  return registry
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw new ConfirmationHandlerInputError()
  return result.data
}

const maskedPhone = (input: string) => {
  const phone = normalizeMainlandChinaMobile(input)
  return `${phone.slice(0, 5)}******${phone.slice(-3)}`
}

const applicationBinding = (payload: JsonObject): JsonObject => {
  const expectedRevision = typeof payload.expectedRevision === 'number' ? payload.expectedRevision : -1
  const profile = payload.profile && typeof payload.profile === 'object' && !Array.isArray(payload.profile) ? payload.profile as JsonObject : {}
  const answers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers) ? payload.answers as JsonObject : {}
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
  return {
    expectedRevision,
    profileFields: Object.keys(profile).sort(),
    answerIds: Object.keys(answers).sort(),
    attachmentSlotIds: attachments.map((item) => item && typeof item === 'object' && !Array.isArray(item) && typeof item.slotId === 'string' ? item.slotId : '').filter(Boolean).sort(),
  }
}

const requireUser = (actor: ConfirmationActor) => {
  if (!actor.user || actor.user.role !== 'user') throw new Error('CONFIRMATION_ACTOR_INVALID')
  return actor.user
}

export const createLearnerConfirmationHandlers = (dependencies: {
  sessions: SessionService
  verificationService?: VerificationService
  applicationService?: ApplicationService
  fileService?: FileService
  accountService?: AdminManagementService
}) => {
  const verification = () => {
    if (!dependencies.verificationService) throw new Error('VERIFICATION_UNAVAILABLE')
    return dependencies.verificationService
  }
  const handlers: ConfirmationHandler[] = [
    {
      capabilityId: 'auth.verification.send',
      prepare: (payload) => ({ preview: { action: '发送验证码', phone: payload.phoneMasked ?? null, purpose: payload.purpose ?? null }, targetType: 'account' }),
      executionBindingPayload: (_prepared, execution) => {
        const input = parse(SendVerificationCodeRequestSchema, execution)
        return { phoneMasked: maskedPhone(input.phone), purpose: input.purpose }
      },
      execute: async ({ executionPayload }) => {
        const input = parse(SendVerificationCodeRequestSchema, executionPayload)
        await verification().sendCode(input.phone, input.purpose)
        return { accepted: true }
      },
    },
    {
      capabilityId: 'auth.register',
      prepare: (payload) => ({ preview: { action: '注册账号', phone: payload.phoneMasked ?? null }, targetType: 'account' }),
      executionBindingPayload: (_prepared, execution) => ({ phoneMasked: maskedPhone(parse(StudentRegistrationRequestSchema, execution).phone) }),
      execute: async ({ executionPayload }) => {
        const input = parse(StudentRegistrationRequestSchema, executionPayload)
        const user = await verification().register(input.phone, input.code, input.password)
        return { apiVersion: 'v1', data: { user } } as JsonObject
      },
    },
    {
      capabilityId: 'auth.login',
      prepare: (payload) => ({ preview: { action: '登录账号', phone: payload.phoneMasked ?? null, clientKind: payload.clientKind ?? null }, targetType: 'session' }),
      executionBindingPayload: (_prepared, execution) => {
        const input = parse(StudentLoginRequestSchema.extend({ clientKind: z.enum(['web', 'cli']) }), execution)
        return { phoneMasked: maskedPhone(input.phone), clientKind: input.clientKind }
      },
      execute: async ({ executionPayload }) => {
        const input = parse(StudentLoginRequestSchema.extend({ clientKind: z.enum(['web', 'cli']) }), executionPayload)
        const result = input.clientKind === 'cli'
          ? await dependencies.sessions.loginStudentCli(input.phone, input.password)
          : await dependencies.sessions.loginStudentWeb(input.phone, input.password)
        const safe = { apiVersion: 'v1', data: { user: result.user, expiresAt: result.expiresAt.toISOString() } } as JsonObject
        return confirmationHandlerResult(safe, { ...safe, data: { ...(safe.data as JsonObject), token: result.token } })
      },
    },
    {
      capabilityId: 'auth.password_reset',
      prepare: (payload) => ({ preview: { action: '重置密码', phone: payload.phoneMasked ?? null }, targetType: 'account' }),
      executionBindingPayload: (_prepared, execution) => ({ phoneMasked: maskedPhone(parse(PasswordResetRequestSchema, execution).phone) }),
      execute: async ({ executionPayload }) => {
        const input = parse(PasswordResetRequestSchema, executionPayload)
        await verification().resetPassword(input.phone, input.code, input.newPassword)
        return { reset: true }
      },
    },
    {
      capabilityId: 'auth.logout',
      prepare: () => ({ preview: { action: '退出当前账号' }, targetType: 'session' }),
      executionBindingPayload: () => ({ scope: 'current' }),
      execute: async ({ actor }) => {
        if (!actor.credential) throw new Error('CONFIRMATION_ACTOR_INVALID')
        if (actor.credential.source === 'bearer') await dependencies.sessions.logoutCli(actor.credential.token)
        else await dependencies.sessions.logout(actor.credential.token)
        return { loggedOut: true }
      },
    },
    {
      capabilityId: 'account.password_change',
      prepare: () => ({ preview: { action: '修改当前账号密码' }, targetType: 'account', targetId: 'self' }),
      executionBindingPayload: () => ({ account: 'self' }),
      execute: async ({ actor, executionPayload }) => {
        if (!dependencies.accountService) throw new Error('ACCOUNT_SERVICE_UNAVAILABLE')
        const input = parse(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) }).strict(), executionPayload)
        return await dependencies.accountService.changeOwnPassword(requireUser(actor), input) as JsonObject
      },
    },
    {
      capabilityId: 'application.draft.save',
      prepare: (payload) => ({ preview: { action: '保存报名草稿', ...payload }, targetType: 'application', targetId: 'mine', expectedRevision: Number(payload.expectedRevision) }),
      executionBindingPayload: (_prepared, execution) => applicationBinding(execution),
      execute: async ({ actor, executionPayload }) => {
        if (!dependencies.applicationService) throw new Error('APPLICATION_SERVICE_UNAVAILABLE')
        parse(ApplicationDraftSaveRequestSchema, executionPayload)
        return await dependencies.applicationService.saveDraft(requireUser(actor), executionPayload) as JsonObject
      },
    },
    ...(['application.reopen', 'application.submit'] as const).map((capabilityId): ConfirmationHandler => ({
      capabilityId,
      prepare: (payload) => ({ preview: { action: capabilityId === 'application.submit' ? '提交报名' : '重新填写报名', expectedRevision: payload.expectedRevision ?? null }, targetType: 'application', targetId: 'mine', expectedRevision: Number(payload.expectedRevision) }),
      execute: async ({ actor, executionPayload }) => {
        if (!dependencies.applicationService) throw new Error('APPLICATION_SERVICE_UNAVAILABLE')
        if (capabilityId === 'application.submit') {
          parse(ApplicationSubmitRequestSchema, executionPayload)
          return await dependencies.applicationService.submit(requireUser(actor), executionPayload) as JsonObject
        }
        parse(ApplicationReopenRequestSchema, executionPayload)
        return await dependencies.applicationService.reopen(requireUser(actor), executionPayload) as JsonObject
      },
    })),
    ...(['file.hide', 'file.delete'] as const).map((capabilityId): ConfirmationHandler => ({
      capabilityId,
      prepare: (payload) => ({ preview: { action: capabilityId === 'file.delete' ? '删除附件' : '隐藏附件', fileId: payload.fileId ?? null }, targetType: 'file', targetId: String(payload.fileId ?? '') }),
      execute: async ({ actor, executionPayload }) => {
        if (!dependencies.fileService) throw new Error('FILE_SERVICE_UNAVAILABLE')
        const { fileId } = parse(z.object({ fileId: z.string().uuid() }).strict(), executionPayload)
        if (capabilityId === 'file.delete') await dependencies.fileService.remove(fileId, requireUser(actor))
        else await dependencies.fileService.hide(fileId, requireUser(actor))
        return { fileId, result: capabilityId === 'file.delete' ? 'deleted' : 'hidden' }
      },
    })),
    {
      capabilityId: 'file.upload',
      prepare: (payload) => ({ preview: { action: '上传报名附件', ...payload }, targetType: 'file', targetId: String(payload.attachmentSlot ?? 'unlinked') }),
      execute: async ({ actor, serverContext }) => {
        if (!dependencies.fileService) throw new Error('FILE_SERVICE_UNAVAILABLE')
        if (!serverContext || typeof serverContext !== 'object' || !('uploadInput' in serverContext)) throw new Error('CONFIRMED_UPLOAD_CONTEXT_REQUIRED')
        const file = await dependencies.fileService.upload((serverContext as { uploadInput: Parameters<FileService['upload']>[0] }).uploadInput, requireUser(actor))
        return { apiVersion: 'v1', data: { file } } as JsonObject
      },
    },
  ]
  return createConfirmationHandlerRegistry(handlers)
}
