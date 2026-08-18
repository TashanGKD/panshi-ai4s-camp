import { describe, expect, it, vi } from 'vitest'
import {
  SmsNotificationProviderError,
  createAliyunNotificationProvider,
} from '../src/modules/sms/aliyun-notification-provider.js'

const options = {
  accessKeyId: 'test-access-key-id',
  accessKeySecret: 'test-access-key-secret',
  signName: '他山青年',
  endpoint: 'dysmsapi.aliyuncs.com',
  regionId: 'cn-hangzhou',
  templateCodes: {
    application_submitted: 'SMS_SUBMITTED',
    needs_supplement: 'SMS_SUPPLEMENT',
    admitted: 'SMS_ADMITTED',
    waitlisted: 'SMS_WAITLISTED',
    rejected: 'SMS_REJECTED',
  },
}

describe('Aliyun notification provider', () => {
  it.each(Object.entries(options.templateCodes))(
    'maps %s to its exact approved template',
    async (eventType, templateCode) => {
      const sendSms = vi.fn().mockResolvedValue({
        body: { code: 'OK', bizId: 'biz-1', requestId: 'request-1' },
      })
      const provider = createAliyunNotificationProvider(options, { sendSms })

      await expect(provider.send({
        eventType: eventType as keyof typeof options.templateCodes,
        phone: '13800138000',
        outboxId: '40000000-0000-4000-8000-000000000001',
      })).resolves.toEqual({ bizId: 'biz-1', requestId: 'request-1' })

      expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({
        phoneNumbers: '13800138000',
        signName: '他山青年',
        templateCode,
        outId: '40000000-0000-4000-8000-000000000001',
      }))
      expect(sendSms.mock.calls[0]?.[0]).not.toHaveProperty('templateParam')
    },
  )

  it.each([
    '13800138000,13900139000',
    '+8613800138000',
    ' 13800138000',
    '13800138000 ',
    '12800138000',
  ])('rejects the adversarial phone input %s before calling Aliyun', async (phone) => {
    const sendSms = vi.fn()
    const provider = createAliyunNotificationProvider(options, { sendSms })

    await expect(provider.send({
      eventType: 'application_submitted',
      phone,
      outboxId: '40000000-0000-4000-8000-000000000001',
    })).rejects.toMatchObject({ code: 'INVALID_PHONE', disposition: 'dead_letter' })
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('rejects an unknown event without falling back to a default template', async () => {
    const sendSms = vi.fn()
    const provider = createAliyunNotificationProvider(options, { sendSms })

    await expect(provider.send({
      eventType: 'reviewing' as 'application_submitted',
      phone: '13800138000',
      outboxId: '40000000-0000-4000-8000-000000000001',
    })).rejects.toMatchObject({ code: 'UNKNOWN_EVENT_TYPE', disposition: 'dead_letter' })
    expect(sendSms).not.toHaveBeenCalled()
  })

  it.each([
    ['isv.BUSINESS_LIMIT_CONTROL', 'retry'],
    ['isp.SYSTEM_ERROR', 'retry'],
    ['isv.MOBILE_NUMBER_ILLEGAL', 'dead_letter'],
    ['isv.SMS_TEMPLATE_ILLEGAL', 'dead_letter'],
  ])('classifies explicit provider code %s as %s', async (code, disposition) => {
    const provider = createAliyunNotificationProvider(options, {
      sendSms: vi.fn().mockResolvedValue({ body: { code, message: 'private provider detail' } }),
    })

    await expect(provider.send({
      eventType: 'application_submitted',
      phone: '13800138000',
      outboxId: '40000000-0000-4000-8000-000000000001',
    })).rejects.toEqual(expect.objectContaining({
      name: 'SmsNotificationProviderError',
      code,
      disposition,
      message: 'Aliyun SMS notification was not accepted',
    }))
  })

  it('dead-letters an ambiguous transport failure instead of retrying a non-idempotent send', async () => {
    const provider = createAliyunNotificationProvider(options, {
      sendSms: vi.fn().mockRejectedValue(new Error('socket timeout with private details')),
    })

    await expect(provider.send({
      eventType: 'admitted',
      phone: '13800138000',
      outboxId: '40000000-0000-4000-8000-000000000001',
    })).rejects.toEqual(expect.objectContaining({
      name: 'SmsNotificationProviderError',
      code: 'TRANSPORT_RESULT_UNKNOWN',
      disposition: 'dead_letter',
      message: 'Aliyun SMS notification result is unknown',
    }))
  })

  it('exposes a typed provider error without leaking the upstream message', () => {
    const error = new SmsNotificationProviderError('PRIVATE', 'retry', 'safe message')
    expect(error).toMatchObject({ name: 'SmsNotificationProviderError', code: 'PRIVATE', disposition: 'retry' })
  })
})
