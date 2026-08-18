import {
  Dysmsapi,
  createAliyunSmsClient,
  type AliyunSmsClient,
} from './aliyun-client.js'
import {
  smsNotificationEventTypes,
  type SmsNotificationEventType,
  type SmsNotificationProvider,
} from './notification.types.js'

export type AliyunNotificationProviderOptions = {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  endpoint: string
  regionId: string
  templateCodes: Readonly<Record<SmsNotificationEventType, string>>
}

export type SmsNotificationFailureDisposition = 'retry' | 'dead_letter'

export class SmsNotificationProviderError extends Error {
  readonly code: string
  readonly disposition: SmsNotificationFailureDisposition

  constructor(code: string, disposition: SmsNotificationFailureDisposition, message: string) {
    super(message)
    this.name = 'SmsNotificationProviderError'
    this.code = code
    this.disposition = disposition
  }
}

const phonePattern = /^1[3-9][0-9]{9}$/u
const retryableProviderCodes = new Set([
  'isv.BUSINESS_LIMIT_CONTROL',
  'isp.SYSTEM_ERROR',
  'isp.RAM_PERMISSION_DENY',
])

const assertCompleteOptions = (options: AliyunNotificationProviderOptions) => {
  const values = [
    options.accessKeyId,
    options.accessKeySecret,
    options.signName,
    options.endpoint,
    options.regionId,
    ...smsNotificationEventTypes.map((eventType) => options.templateCodes[eventType]),
  ]
  if (values.some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new Error('Aliyun notification SMS configuration is incomplete')
  }
}

const templateFor = (
  templateCodes: Readonly<Record<SmsNotificationEventType, string>>,
  eventType: SmsNotificationEventType,
) => {
  if (!smsNotificationEventTypes.includes(eventType)) {
    throw new SmsNotificationProviderError(
      'UNKNOWN_EVENT_TYPE',
      'dead_letter',
      'SMS notification event type is not configured',
    )
  }
  return templateCodes[eventType]
}

export const createAliyunNotificationProvider = (
  options: AliyunNotificationProviderOptions,
  injectedClient?: AliyunSmsClient,
): SmsNotificationProvider => {
  assertCompleteOptions(options)
  const client = injectedClient ?? createAliyunSmsClient(options)

  return {
    send: async ({ eventType, phone, outboxId }) => {
      if (!phonePattern.test(phone)) {
        throw new SmsNotificationProviderError(
          'INVALID_PHONE',
          'dead_letter',
          'SMS notification phone number is invalid',
        )
      }

      const templateCode = templateFor(options.templateCodes, eventType)
      let response
      try {
        response = await client.sendSms(new Dysmsapi.SendSmsRequest({
          phoneNumbers: phone,
          signName: options.signName,
          templateCode,
          outId: outboxId,
        }))
      } catch {
        throw new SmsNotificationProviderError(
          'TRANSPORT_RESULT_UNKNOWN',
          'dead_letter',
          'Aliyun SMS notification result is unknown',
        )
      }

      const code = response.body?.code ?? 'MISSING_PROVIDER_CODE'
      if (code !== 'OK') {
        throw new SmsNotificationProviderError(
          code,
          retryableProviderCodes.has(code) ? 'retry' : 'dead_letter',
          'Aliyun SMS notification was not accepted',
        )
      }
      const bizId = response.body?.bizId
      if (!bizId) {
        throw new SmsNotificationProviderError(
          'MISSING_BIZ_ID',
          'dead_letter',
          'Aliyun SMS notification response is incomplete',
        )
      }
      return { bizId, requestId: response.body?.requestId ?? null }
    },
  }
}
