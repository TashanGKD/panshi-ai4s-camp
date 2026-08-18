import { describe, expect, it } from 'vitest'
import {
  ConfirmationExecuteRequestSchema,
  ConfirmationPrepareRequestSchema,
  ConfirmationPrepareResponseSchema,
} from './confirmation.js'

const binding = 'a'.repeat(64)

describe('confirmation contracts', () => {
  it('accepts a canonical nonsecret prepare request', () => {
    expect(ConfirmationPrepareRequestSchema.parse({
      capabilityId: 'application.submit',
      payload: { expectedRevision: 4 },
      clientBinding: binding,
      idempotencyKey: '50fbb98a-b8e4-43ce-b5ee-8ffb54f7f1bf',
    })).toBeTruthy()
  })

  it.each(['password', 'verificationCode', 'access_token', 'cookie'])('rejects secret field %s in preview payload', (key) => {
    expect(ConfirmationPrepareRequestSchema.safeParse({
      capabilityId: 'auth.login',
      payload: { [key]: 'secret-value' },
      clientBinding: binding,
      idempotencyKey: '50fbb98a-b8e4-43ce-b5ee-8ffb54f7f1bf',
    }).success).toBe(false)
  })

  it('rejects secret fields nested inside arrays and objects', () => {
    expect(ConfirmationPrepareRequestSchema.safeParse({
      capabilityId: 'auth.register',
      payload: { account: [{ safe: true }, { code: '123456' }] },
      clientBinding: binding,
      idempotencyKey: '50fbb98a-b8e4-43ce-b5ee-8ffb54f7f1bf',
    }).success).toBe(false)
  })

  it('requires a 256-bit client binding and UUID idempotency key', () => {
    expect(ConfirmationPrepareRequestSchema.safeParse({
      capabilityId: 'application.submit', payload: {}, clientBinding: 'short', idempotencyKey: 'not-a-uuid',
    }).success).toBe(false)
  })

  it('models a strict prepare response and execute request', () => {
    expect(ConfirmationPrepareResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        confirmationId: '8ee05aca-8255-4de1-a421-6c141218b0e8',
        expiresAt: '2026-08-18T12:05:00.000Z',
        preview: { summary: '提交第 4 版报名信息' },
        payloadSha256: 'b'.repeat(64),
        confirmation: 'single',
      },
    })).toBeTruthy()
    expect(ConfirmationExecuteRequestSchema.parse({
      clientBinding: binding,
      idempotencyKey: '50fbb98a-b8e4-43ce-b5ee-8ffb54f7f1bf',
      payload: { expectedRevision: 4 },
    })).toBeTruthy()
  })
})
