import { describe, expect, it, vi } from 'vitest'
import { runConfirmedOperation } from './confirmation-flow.js'

const prepared = { apiVersion: 'v1' as const, data: {
  confirmationId: crypto.randomUUID(), expiresAt: '2026-09-01T00:00:00.000Z', preview: { action: '提交报名', targetId: 'mine' },
  payloadSha256: 'a'.repeat(64), confirmation: 'single' as const,
} }

describe('two-stage confirmation flow', () => {
  it('prepares without executing in JSON mode', async () => {
    const prepare = vi.fn(async () => prepared); const execute = vi.fn()
    const error = await runConfirmedOperation({
      capabilityId: 'application.submit', previewPayload: { expectedRevision: 2 }, executionPayload: { expectedRevision: 2 },
      json: true, options: {}, prepare, execute, confirm: vi.fn(),
    }).catch((caught) => caught)
    expect(prepare).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled()
    expect(error).toMatchObject({ code: 'CONFIRMATION_REQUIRED', details: { confirmationId: prepared.data.confirmationId } })
  })

  it.each([false, null])('cancels safely when confirmation returns %s', async (answer) => {
    const execute = vi.fn()
    await expect(runConfirmedOperation({
      capabilityId: 'application.submit', previewPayload: {}, executionPayload: {}, json: false, options: {},
      prepare: vi.fn(async () => prepared), execute, confirm: vi.fn(async () => answer === true),
    })).rejects.toMatchObject({ code: 'STATE_NOT_ALLOWED' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('executes a second invocation only with the complete bound context', async () => {
    const execute = vi.fn(async () => ({ done: true }))
    const options = { confirmationId: prepared.data.confirmationId, clientBinding: 'b'.repeat(64), idempotencyKey: crypto.randomUUID() }
    await expect(runConfirmedOperation({
      capabilityId: 'application.submit', previewPayload: {}, executionPayload: { expectedRevision: 2 }, json: true,
      options, prepare: vi.fn(), execute, confirm: vi.fn(),
    })).resolves.toEqual({ done: true })
    expect(execute).toHaveBeenCalledWith({ confirmationId: options.confirmationId, clientBinding: options.clientBinding, idempotencyKey: options.idempotencyKey })
  })

  it('prints the prepared preview before prompting and never executes after timeout', async () => {
    const order: string[] = []; const execute = vi.fn()
    await expect(runConfirmedOperation({
      capabilityId: 'application.submit', previewPayload: {}, executionPayload: {}, json: false, options: {},
      prepare: vi.fn(async () => { order.push('prepare'); return prepared }), execute,
      confirm: vi.fn(async () => { order.push('prompt'); return await new Promise<boolean>(() => undefined) }),
      confirmationTimeoutMs: 1,
    })).rejects.toMatchObject({ code: 'STATE_NOT_ALLOWED' })
    expect(order).toEqual(['prepare', 'prompt']); expect(execute).not.toHaveBeenCalled()
  })

  it('rejects partial context and has no yes or force bypass', async () => {
    await expect(runConfirmedOperation({
      capabilityId: 'application.submit', previewPayload: {}, executionPayload: {}, json: true,
      options: { confirmationId: prepared.data.confirmationId }, prepare: vi.fn(), execute: vi.fn(), confirm: vi.fn(),
    })).rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })
})
