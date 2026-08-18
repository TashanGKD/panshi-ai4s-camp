import { SmsNotificationProviderError } from './aliyun-notification-provider.js'
import type {
  SmsNotificationProvider,
  SmsNotificationWorkerRepository,
} from './notification.types.js'

export type SmsNotificationWorkerOptions = {
  batchSize: number
  maxAttempts: number
  staleLockMs: number
  retryDelayMs: number
  pollIntervalMs: number
  now?: () => Date
}

export const createSmsNotificationWorker = (
  repository: SmsNotificationWorkerRepository,
  provider: SmsNotificationProvider,
  options: SmsNotificationWorkerOptions,
) => {
  const now = options.now ?? (() => new Date())
  let drainPromise: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = true

  const executeDrain = async () => {
    const claimedAt = now()
    const records = await repository.claimBatch({
      batchSize: options.batchSize,
      now: claimedAt,
      staleBefore: new Date(claimedAt.getTime() - options.staleLockMs),
    })
    for (const record of records) {
      try {
        const accepted = await provider.send({
          eventType: record.eventType,
          phone: record.phoneNormalized,
          outboxId: record.id,
        })
        await repository.markAccepted(record.id, { ...accepted, acceptedAt: now() })
      } catch (error) {
        if (
          error instanceof SmsNotificationProviderError
          && error.disposition === 'retry'
          && record.attempts < options.maxAttempts
        ) {
          await repository.markRetry(record.id, {
            errorCode: error.code,
            availableAt: new Date(now().getTime() + options.retryDelayMs),
          })
          continue
        }
        const errorCode = error instanceof SmsNotificationProviderError
          ? error.disposition === 'retry' && record.attempts >= options.maxAttempts
            ? 'MAX_ATTEMPTS_EXCEEDED'
            : error.code
          : 'UNEXPECTED_WORKER_ERROR'
        await repository.markDeadLetter(record.id, { errorCode })
      }
    }
  }

  const drainOnce = async () => {
    drainPromise ??= executeDrain().finally(() => {
      drainPromise = undefined
    })
    await drainPromise
  }

  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      void drainOnce().finally(schedule)
    }, options.pollIntervalMs)
  }

  return {
    drainOnce,
    start: () => {
      if (!stopped) return
      stopped = false
      void drainOnce().finally(schedule)
    },
    stop: async () => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = undefined
      await drainPromise
    },
  }
}
