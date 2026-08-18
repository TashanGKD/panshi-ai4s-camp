export const smsNotificationEventTypes = [
  'application_submitted',
  'needs_supplement',
  'admitted',
  'waitlisted',
  'rejected',
] as const

export type SmsNotificationEventType = typeof smsNotificationEventTypes[number]

export type SmsNotificationOutboxRecord = {
  id: string
  eventKey: string
  eventType: SmsNotificationEventType
  applicationId: string
  userId: string
  phoneNormalized: string
  attempts: number
}

export type SmsNotificationSendInput = {
  eventType: SmsNotificationEventType
  phone: string
  outboxId: string
}

export type SmsNotificationSendResult = {
  bizId: string
  requestId: string | null
}

export interface SmsNotificationProvider {
  send(input: SmsNotificationSendInput): Promise<SmsNotificationSendResult>
}

export interface SmsNotificationWorkerRepository {
  claimBatch(input: {
    batchSize: number
    now: Date
    staleBefore: Date
  }): Promise<SmsNotificationOutboxRecord[]>
  markAccepted(id: string, input: {
    bizId: string
    requestId: string | null
    acceptedAt: Date
  }): Promise<void>
  markRetry(id: string, input: { errorCode: string, availableAt: Date }): Promise<void>
  markDeadLetter(id: string, input: { errorCode: string }): Promise<void>
}
