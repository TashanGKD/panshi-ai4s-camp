import { describe, expect, it, vi } from 'vitest'
import { createAliyunVerificationProvider } from '../src/modules/identity/aliyun-verification-provider.js'

const options = {
  accessKeyId: 'test-access-key-id',
  accessKeySecret: 'test-access-key-secret',
  signName: '攻玉智研',
  templateCode: 'SMS_TEST',
  templateParamKey: 'code',
  endpoint: 'dysmsapi.aliyuncs.com',
  regionId: 'cn-hangzhou',
}

describe('Aliyun verification provider', () => {
  it('sends the normalized verification payload without exposing the code elsewhere', async () => {
    const sendSms = vi.fn().mockResolvedValue({ body: { code: 'OK', bizId: 'biz-1' } })
    const provider = createAliyunVerificationProvider(options, { sendSms })

    await provider.sendCode({ phone: '13800138000', code: '246810', purpose: 'register' })

    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(sendSms.mock.calls[0]?.[0]).toMatchObject({
      phoneNumbers: '13800138000',
      signName: '攻玉智研',
      templateCode: 'SMS_TEST',
      templateParam: JSON.stringify({ code: '246810' }),
    })
  })

  it('rejects a provider response that was not accepted', async () => {
    const provider = createAliyunVerificationProvider(options, {
      sendSms: vi.fn().mockResolvedValue({ body: { code: 'isv.BUSINESS_LIMIT_CONTROL', message: 'limited' } }),
    })

    await expect(provider.sendCode({ phone: '13800138000', code: '246810', purpose: 'reset_password' }))
      .rejects.toThrow('Aliyun SMS delivery was not accepted')
  })

  it('rejects incomplete provider configuration before creating a client', () => {
    expect(() => createAliyunVerificationProvider({ ...options, templateCode: '' }))
      .toThrow('Aliyun SMS configuration is incomplete')
  })
})
