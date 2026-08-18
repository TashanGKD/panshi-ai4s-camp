import {
  ApiErrorSchema,
  ConfirmationPrepareResponseSchema,
  maskMainlandChinaMobile,
  type JsonObject,
  type LearnerCapabilityId,
} from '@panshi/contracts'
import { resolveApiBaseUrl, type PublicClientRuntime } from './browser-client'

export class ConfirmationApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'ConfirmationApiError'
  }
}

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, '0')).join('')

const browserBinding = () => {
  const key = 'panshi-confirmation-client-binding-v1'
  const existing = window.sessionStorage.getItem(key)
  if (existing && /^[a-f0-9]{64}$/u.test(existing)) return existing
  const created = randomHex(32)
  window.sessionStorage.setItem(key, created)
  return created
}

export type PreparedConfirmation = {
  confirmationId: string
  idempotencyKey: string
  clientBinding: string
  confirmation: 'single' | 'double'
  preview: JsonObject
}

const previewText = (preview: JsonObject) => Object.entries(preview)
  .map(([key, value]) => `${key}：${Array.isArray(value) ? value.join('、') : String(value ?? '')}`)
  .join('\n')

export const createConfirmationClient = (apiBaseUrl?: string, runtime: PublicClientRuntime = { production: false }) => {
  const { prefix, credentials } = resolveApiBaseUrl(apiBaseUrl, runtime)
  const prepare = async (capabilityId: LearnerCapabilityId, payload: JsonObject): Promise<PreparedConfirmation> => {
    const clientBinding = browserBinding()
    const idempotencyKey = crypto.randomUUID()
    const response = await fetch(`${prefix}/api/v1/confirmations/prepare`, {
      method: 'POST', credentials,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilityId, payload, clientBinding, idempotencyKey }),
    })
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => undefined))
      throw new ConfirmationApiError(response.status, parsed.success ? parsed.data.error.code : 'REQUEST_FAILED', parsed.success ? parsed.data.error.message : '确认预览生成失败', parsed.success ? parsed.data.error.details : undefined)
    }
    const data = ConfirmationPrepareResponseSchema.parse(await response.json()).data
    return { confirmationId: data.confirmationId, idempotencyKey, clientBinding, confirmation: data.confirmation, preview: data.preview }
  }

  const requestConfirmation = (prepared: PreparedConfirmation, targetIdentifier?: string) => {
    if (!window.confirm(`请核对并确认本次操作：\n\n${previewText(prepared.preview)}`)) return false
    if (prepared.confirmation === 'double') {
      const expected = targetIdentifier ?? String(prepared.preview.fileId ?? '')
      return window.prompt(`该操作不可撤销。请输入目标标识以再次确认：\n${expected}`) === expected
    }
    return true
  }

  const headers = (prepared: PreparedConfirmation) => ({
    'X-Confirmation-Id': prepared.confirmationId,
    'X-Confirmation-Binding': prepared.clientBinding,
    'X-Idempotency-Key': prepared.idempotencyKey,
  })

  return { prepare, requestConfirmation, headers }
}

export const confirmationClient = createConfirmationClient(import.meta.env.VITE_API_BASE_URL, {
  production: import.meta.env.PROD,
  pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin,
})

export const maskMainlandPhone = maskMainlandChinaMobile

export const applicationConfirmationPayload = (body: { expectedRevision: number, profile?: Record<string, unknown>, answers?: Record<string, unknown>, attachments?: Array<{ slotId: string }> }): JsonObject => ({
  expectedRevision: body.expectedRevision,
  profileFields: Object.keys(body.profile ?? {}).sort(),
  answerIds: Object.keys(body.answers ?? {}).sort(),
  attachmentSlotIds: (body.attachments ?? []).map(({ slotId }) => slotId).sort(),
})
