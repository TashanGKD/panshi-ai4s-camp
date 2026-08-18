import { randomBytes, randomUUID } from 'node:crypto'
import type { ConfirmationPrepareResponse, JsonObject, LearnerCapabilityId } from '@panshi/contracts'
import { CliRuntimeError } from './errors.js'

export type ConfirmationOptions = { confirmationId?: string, clientBinding?: string, idempotencyKey?: string }
export type ConfirmedContext = { confirmationId: string, clientBinding: string, idempotencyKey: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const binding = /^[a-f0-9]{64}$/u

export const extractConfirmationOptions = (args: string[]) => {
  const remaining: string[] = []
  const options: ConfirmationOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]!
    const name = ['--confirmation-id', '--client-binding', '--idempotency-key'].find((candidate) => item === candidate || item.startsWith(`${candidate}=`))
    if (!name) { remaining.push(item); continue }
    const inline = item.startsWith(`${name}=`) ? item.slice(name.length + 1) : undefined
    const value = inline ?? args[index + 1]
    if (!value || (!inline && value.startsWith('--'))) throw new CliRuntimeError('INPUT_INVALID', `${name} 缺少参数`)
    if (!inline) index += 1
    if (name === '--confirmation-id') options.confirmationId = value
    if (name === '--client-binding') options.clientBinding = value
    if (name === '--idempotency-key') options.idempotencyKey = value
  }
  return { remaining, options }
}

const validateBoundContext = (options: ConfirmationOptions): ConfirmedContext | null => {
  const supplied = [options.confirmationId, options.clientBinding, options.idempotencyKey].filter(Boolean).length
  if (supplied === 0) return null
  if (supplied !== 3 || !uuid.test(options.confirmationId!) || !binding.test(options.clientBinding!) || !uuid.test(options.idempotencyKey!)) {
    throw new CliRuntimeError('INPUT_INVALID', '确认上下文不完整或格式无效')
  }
  return options as ConfirmedContext
}

export const runConfirmedOperation = async <T>(input: {
  capabilityId: LearnerCapabilityId
  previewPayload: JsonObject
  executionPayload: JsonObject
  json: boolean
  options: ConfirmationOptions
  targetIdentifier?: string
  prepare: (capabilityId: LearnerCapabilityId, payload: JsonObject, context: { clientBinding: string, idempotencyKey: string }) => Promise<ConfirmationPrepareResponse>
  execute: (context: ConfirmedContext) => Promise<T>
  confirm: (preview: JsonObject, mode: 'single' | 'double', targetIdentifier?: string) => Promise<boolean>
  confirmationTimeoutMs?: number
}) => {
  const bound = validateBoundContext(input.options)
  if (bound) return input.execute(bound)
  const context = { clientBinding: randomBytes(32).toString('hex'), idempotencyKey: randomUUID() }
  const prepared = await input.prepare(input.capabilityId, input.previewPayload, context)
  const confirmation = { confirmationId: prepared.data.confirmationId, ...context }
  if (input.json) {
    throw new CliRuntimeError('CONFIRMATION_REQUIRED', '操作需要显式确认', {
      ...confirmation,
      expiresAt: prepared.data.expiresAt,
      confirmation: prepared.data.confirmation,
      preview: prepared.data.preview,
    })
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  const accepted = await Promise.race([
    input.confirm(prepared.data.preview, prepared.data.confirmation, input.targetIdentifier).catch(() => false),
    new Promise<false>((resolve) => { timeout = setTimeout(() => resolve(false), input.confirmationTimeoutMs ?? 120_000) }),
  ]).finally(() => { if (timeout) clearTimeout(timeout) })
  if (!accepted) throw new CliRuntimeError('STATE_NOT_ALLOWED', '操作已取消')
  return input.execute(confirmation)
}
