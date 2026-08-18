import { describe, expect, it, vi } from 'vitest'
import { SmsNotificationProviderError } from '../src/modules/sms/aliyun-notification-provider.js'
import { createSmsNotificationWorker } from '../src/modules/sms/notification.worker.js'
import type { SmsNotificationOutboxRecord } from '../src/modules/sms/notification.types.js'

const row = (overrides: Partial<SmsNotificationOutboxRecord> = {}): SmsNotificationOutboxRecord => ({
  id: '40000000-0000-4000-8000-000000000001',
  eventKey: 'application-submitted:50000000-0000-4000-8000-000000000001',
  eventType: 'application_submitted',
  applicationId: '30000000-0000-4000-8000-000000000001',
  userId: '10000000-0000-4000-8000-000000000001',
  phoneNormalized: '13800138000',
  attempts: 1,
  ...overrides,
})

const repository = () => ({
  claimBatch: vi.fn().mockResolvedValue([]),
  markAccepted: vi.fn().mockResolvedValue(undefined),
  markRetry: vi.fn().mockResolvedValue(undefined),
  markDeadLetter: vi.fn().mockResolvedValue(undefined),
})

describe('SMS notification worker', () => {
  it('marks an Aliyun-accepted row with gateway identifiers', async () => {
    const repo = repository()
    repo.claimBatch.mockResolvedValue([row()])
    const provider = { send: vi.fn().mockResolvedValue({ bizId: 'biz-1', requestId: 'request-1' }) }
    const worker = createSmsNotificationWorker(repo, provider, {
      batchSize: 10,
      maxAttempts: 3,
      staleLockMs: 60_000,
      retryDelayMs: 30_000,
      pollIntervalMs: 1_000,
      now: () => new Date('2026-08-18T12:00:00Z'),
    })

    await worker.drainOnce()

    expect(provider.send).toHaveBeenCalledWith({
      eventType: 'application_submitted',
      phone: '13800138000',
      outboxId: row().id,
    })
    expect(repo.markAccepted).toHaveBeenCalledWith(row().id, {
      bizId: 'biz-1', requestId: 'request-1', acceptedAt: new Date('2026-08-18T12:00:00Z'),
    })
  })

  it('schedules an explicit transient rejection for retry', async () => {
    const repo = repository()
    repo.claimBatch.mockResolvedValue([row({ attempts: 1 })])
    const provider = { send: vi.fn().mockRejectedValue(new SmsNotificationProviderError('isp.SYSTEM_ERROR', 'retry', 'safe')) }
    const worker = createSmsNotificationWorker(repo, provider, {
      batchSize: 10, maxAttempts: 3, staleLockMs: 60_000, retryDelayMs: 30_000, pollIntervalMs: 1_000,
      now: () => new Date('2026-08-18T12:00:00Z'),
    })

    await worker.drainOnce()

    expect(repo.markRetry).toHaveBeenCalledWith(row().id, {
      errorCode: 'isp.SYSTEM_ERROR',
      availableAt: new Date('2026-08-18T12:00:30Z'),
    })
    expect(repo.markDeadLetter).not.toHaveBeenCalled()
  })

  it.each([
    new SmsNotificationProviderError('INVALID_PHONE', 'dead_letter', 'safe'),
    new Error('unexpected implementation failure'),
  ])('dead-letters permanent or unknown failures without an automatic resend', async (error) => {
    const repo = repository()
    repo.claimBatch.mockResolvedValue([row()])
    const worker = createSmsNotificationWorker(repo, { send: vi.fn().mockRejectedValue(error) }, {
      batchSize: 10, maxAttempts: 3, staleLockMs: 60_000, retryDelayMs: 30_000, pollIntervalMs: 1_000,
      now: () => new Date('2026-08-18T12:00:00Z'),
    })

    await worker.drainOnce()

    expect(repo.markRetry).not.toHaveBeenCalled()
    expect(repo.markDeadLetter).toHaveBeenCalledWith(row().id, {
      errorCode: error instanceof SmsNotificationProviderError ? error.code : 'UNEXPECTED_WORKER_ERROR',
    })
  })

  it('dead-letters a retryable error after the configured attempt limit', async () => {
    const repo = repository()
    repo.claimBatch.mockResolvedValue([row({ attempts: 3 })])
    const worker = createSmsNotificationWorker(repo, {
      send: vi.fn().mockRejectedValue(new SmsNotificationProviderError('isv.BUSINESS_LIMIT_CONTROL', 'retry', 'safe')),
    }, {
      batchSize: 10, maxAttempts: 3, staleLockMs: 60_000, retryDelayMs: 30_000, pollIntervalMs: 1_000,
      now: () => new Date('2026-08-18T12:00:00Z'),
    })

    await worker.drainOnce()

    expect(repo.markDeadLetter).toHaveBeenCalledWith(row().id, { errorCode: 'MAX_ATTEMPTS_EXCEEDED' })
  })

  it('does not overlap drain cycles', async () => {
    const repo = repository()
    let release!: () => void
    repo.claimBatch.mockImplementation(() => new Promise<SmsNotificationOutboxRecord[]>((resolve) => { release = () => resolve([]) }))
    const worker = createSmsNotificationWorker(repo, { send: vi.fn() }, {
      batchSize: 10, maxAttempts: 3, staleLockMs: 60_000, retryDelayMs: 30_000, pollIntervalMs: 1_000,
    })

    const first = worker.drainOnce()
    const second = worker.drainOnce()
    expect(repo.claimBatch).toHaveBeenCalledTimes(1)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })
})
