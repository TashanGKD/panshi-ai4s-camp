import type { VerificationProvider } from './verification-provider.js'
import { Dysmsapi, createAliyunSmsClient, type AliyunSmsClient } from '../sms/aliyun-client.js'

export type AliyunVerificationProviderOptions = {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  templateCode: string
  templateParamKey: string
  endpoint: string
  regionId: string
}

const assertCompleteOptions = (options: AliyunVerificationProviderOptions) => {
  if (Object.values(options).some((value) => value.trim() === '')) {
    throw new Error('Aliyun SMS configuration is incomplete')
  }
}

export const createAliyunVerificationProvider = (
  options: AliyunVerificationProviderOptions,
  injectedClient?: AliyunSmsClient,
): VerificationProvider => {
  assertCompleteOptions(options)

  const client = injectedClient ?? createAliyunSmsClient({
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      endpoint: options.endpoint,
      regionId: options.regionId,
    })

  return {
    sendCode: async ({ phone, code }) => {
      const response = await client.sendSms(new Dysmsapi.SendSmsRequest({
        phoneNumbers: phone,
        signName: options.signName,
        templateCode: options.templateCode,
        templateParam: JSON.stringify({ [options.templateParamKey]: code }),
      }))
      if (response.body?.code !== 'OK') {
        throw new Error('Aliyun SMS delivery was not accepted')
      }
    },
  }
}
