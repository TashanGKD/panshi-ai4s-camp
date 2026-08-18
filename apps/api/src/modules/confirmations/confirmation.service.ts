import { createHash, randomUUID } from 'node:crypto'
import {
  ConfirmationExecuteRequestSchema,
  ConfirmationPrepareRequestSchema,
  learnerCapabilities,
  type ConfirmationExecuteRequest,
  type ConfirmationPrepareRequest,
  type JsonObject,
  type JsonValue,
  type LearnerCapabilityId,
} from '@panshi/contracts'
import { ConfirmationHandlerInputError, isConfirmationHandlerResult, type ConfirmationHandlerRegistry } from './confirmation-handlers.js'

export type ConfirmationStatus = 'pending' | 'executing' | 'consumed' | 'expired' | 'failed'
export type ConfirmationRole = 'anonymous' | 'user' | 'admin'
export type ConfirmationActor = {
  userId: string | null
  role: ConfirmationRole
  user?: { id: string, displayName: string, phoneNormalized: string, passwordHash: string, role: 'user' | 'admin', disabledAt: Date | null, passwordResetRequiredAt?: Date | null }
  credential?: { token: string, source: 'cookie' | 'bearer' }
}

export type ConfirmationIntent = {
  id: string
  actorUserId: string | null
  siteId: 'panshi-ai4s-camp'
  capabilityId: LearnerCapabilityId
  payloadSha256: string
  payload: JsonObject
  preview: JsonObject
  targetType: string | null
  targetId: string | null
  expectedRevision: number | null
  clientBindingDigest: string
  idempotencyKey: string
  status: ConfirmationStatus
  safeResult: JsonObject | null
  createdAt: Date
  expiresAt: Date
  consumedAt: Date | null
}

export type ConfirmationRepository = {
  create: (intent: ConfirmationIntent) => Promise<ConfirmationIntent>
  findById: (id: string) => Promise<ConfirmationIntent | null>
  claim: (id: string, now: Date) => Promise<boolean>
  consume: (id: string, safeResult: JsonObject, consumedAt: Date) => Promise<void>
  reject: (id: string, status: 'expired' | 'failed', resultCode: string) => Promise<void>
}

export class ConfirmationError extends Error {
  constructor(
    readonly code: 'INPUT_INVALID' | 'STATE_NOT_ALLOWED' | 'CONFIRMATION_EXPIRED' | 'CONFIRMATION_MISMATCH' | 'CONFIRMATION_ALREADY_USED' | 'CONFIRMATION_EXECUTION_INDETERMINATE' | 'RESOURCE_NOT_FOUND',
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'ConfirmationError'
  }
}

const invalidCanonical = () => new ConfirmationError('INPUT_INVALID', '确认内容必须是严格 JSON 数据')

const canonicalValue = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidCanonical()
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) throw invalidCanonical()
  const result: Record<string, JsonValue> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key]
    if (child === undefined || typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint') throw invalidCanonical()
    result[key] = canonicalValue(child)
  }
  return result
}

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalValue(value))
export const hashCanonicalJson = (value: unknown): string => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')

const anonymousCapabilities = new Set<LearnerCapabilityId>([
  'auth.verification.send', 'auth.register', 'auth.login', 'auth.password_reset',
])

const parsePrepare = (input: unknown): ConfirmationPrepareRequest => {
  const parsed = ConfirmationPrepareRequestSchema.safeParse(input)
  if (!parsed.success) throw new ConfirmationError('INPUT_INVALID', '确认请求内容无效')
  return parsed.data
}

const parseExecute = (input: unknown): ConfirmationExecuteRequest => {
  const parsed = ConfirmationExecuteRequestSchema.safeParse(input)
  if (!parsed.success) throw new ConfirmationError('INPUT_INVALID', '确认执行内容无效')
  return parsed.data
}

export const createConfirmationService = (
  repository: ConfirmationRepository,
  handlers: ConfirmationHandlerRegistry,
  options: { now?: () => Date, ttlMs?: number } = {},
) => {
  const now = options.now ?? (() => new Date())
  const ttlMs = options.ttlMs ?? 5 * 60 * 1_000

  const prepare = async (actor: ConfirmationActor, rawInput: unknown) => {
    const input = parsePrepare(rawInput)
    const capability = learnerCapabilities.find(({ id }) => id === input.capabilityId)
    const handler = handlers.get(input.capabilityId)
    if (!capability || capability.effect === 'read' || capability.confirmation === 'none' || !handler) {
      throw new ConfirmationError('STATE_NOT_ALLOWED', '该操作不能通过确认意图执行')
    }
    if (!capability.roles.includes(actor.role as never)) throw new ConfirmationError('STATE_NOT_ALLOWED', '当前身份不能执行该操作', 403)
    if (actor.role === 'anonymous' && !anonymousCapabilities.has(input.capabilityId)) {
      throw new ConfirmationError('STATE_NOT_ALLOWED', '匿名用户不能执行该操作', 403)
    }
    if (actor.role !== 'anonymous' && actor.userId === null) throw new ConfirmationError('STATE_NOT_ALLOWED', '登录身份无效', 401)

    const preparedAt = now()
    const preparation = await handler.prepare(input.payload)
    const payloadSha256 = hashCanonicalJson(input.payload)
    const intent = await repository.create({
      id: randomUUID(),
      actorUserId: actor.userId,
      siteId: 'panshi-ai4s-camp',
      capabilityId: input.capabilityId,
      payloadSha256,
      payload: canonicalValue(input.payload) as JsonObject,
      preview: canonicalValue(preparation.preview) as JsonObject,
      targetType: preparation.targetType ?? null,
      targetId: preparation.targetId ?? null,
      expectedRevision: preparation.expectedRevision ?? null,
      clientBindingDigest: input.clientBinding,
      idempotencyKey: input.idempotencyKey,
      status: 'pending', safeResult: null,
      createdAt: preparedAt,
      expiresAt: new Date(preparedAt.getTime() + ttlMs),
      consumedAt: null,
    })
    if (intent.capabilityId !== input.capabilityId
      || intent.payloadSha256 !== payloadSha256
      || intent.clientBindingDigest !== input.clientBinding) {
      throw new ConfirmationError('CONFIRMATION_MISMATCH', '幂等键已绑定到另一项确认内容', 409)
    }
    return {
      confirmationId: intent.id,
      expiresAt: intent.expiresAt.toISOString(),
      preview: intent.preview,
      payloadSha256: intent.payloadSha256,
      confirmation: capability.confirmation as 'single' | 'double',
    }
  }

  const execute = async (actor: ConfirmationActor, confirmationId: string, rawInput: unknown, expectedCapabilityId?: LearnerCapabilityId, serverContext?: unknown) => {
    const input = parseExecute(rawInput)
    const intent = await repository.findById(confirmationId)
    if (!intent) throw new ConfirmationError('RESOURCE_NOT_FOUND', '确认意图不存在', 404)
    const handler = handlers.get(intent.capabilityId)
    if (!handler) throw new ConfirmationError('STATE_NOT_ALLOWED', '确认操作未配置')
    if (expectedCapabilityId && intent.capabilityId !== expectedCapabilityId) throw new ConfirmationError('CONFIRMATION_MISMATCH', '确认能力与操作不一致')
    const bindingPayload = handler.executionBindingPayload?.(intent.payload, input.payload) ?? input.payload
    if (intent.actorUserId !== actor.userId
      || intent.clientBindingDigest !== input.clientBinding
      || intent.idempotencyKey !== input.idempotencyKey
      || hashCanonicalJson(bindingPayload) !== intent.payloadSha256) {
      throw new ConfirmationError('CONFIRMATION_MISMATCH', '确认内容与准备阶段不一致')
    }
    if (intent.status === 'consumed') return intent.safeResult ?? {}
    if (intent.status === 'executing') throw new ConfirmationError('CONFIRMATION_EXECUTION_INDETERMINATE', '操作正在执行，请重新读取业务状态', 409)
    if (intent.status === 'expired' || intent.expiresAt.getTime() <= now().getTime()) {
      await repository.reject(intent.id, 'expired', 'CONFIRMATION_EXPIRED')
      throw new ConfirmationError('CONFIRMATION_EXPIRED', '确认意图已过期', 409)
    }
    if (intent.status !== 'pending') throw new ConfirmationError('CONFIRMATION_ALREADY_USED', '确认意图已使用', 409)
    const claimed = await repository.claim(intent.id, now())
    if (!claimed) {
      const latest = await repository.findById(intent.id)
      if (latest?.status === 'consumed') return latest.safeResult ?? {}
      throw new ConfirmationError('CONFIRMATION_EXECUTION_INDETERMINATE', '操作可能正在执行，请重新读取业务状态', 409)
    }
    try {
      const handlerResult = await handler.execute({ actor, actorUserId: actor.userId, preparedPayload: intent.payload, executionPayload: input.payload, serverContext })
      const safeResult = canonicalValue(isConfirmationHandlerResult(handlerResult) ? handlerResult.safeResult : handlerResult) as JsonObject
      const responseResult = canonicalValue(isConfirmationHandlerResult(handlerResult) ? handlerResult.responseResult : handlerResult) as JsonObject
      await repository.consume(intent.id, safeResult, now())
      return responseResult
    } catch (error) {
      await repository.reject(intent.id, 'failed', 'HANDLER_FAILED')
      if (error instanceof ConfirmationHandlerInputError) {
        throw new ConfirmationError('INPUT_INVALID', '确认执行内容无效')
      }
      throw error
    }
  }

  return { prepare, execute }
}

export type ConfirmationService = ReturnType<typeof createConfirmationService>
