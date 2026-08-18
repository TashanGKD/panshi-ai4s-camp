import * as Dysmsapi from '@alicloud/dysmsapi20170525'
import * as OpenApi from '@alicloud/openapi-client'
import type { VerificationProvider } from './verification-provider.js'

export type AliyunVerificationProviderOptions = {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  templateCode: string
  templateParamKey: string
  endpoint: string
  regionId: string
}

type AliyunSmsResponse = {
  body?: {
    code?: string
    message?: string
    bizId?: string
  }
}

export type AliyunSmsClient = {
  sendSms(request: InstanceType<typeof Dysmsapi.SendSmsRequest>): Promise<AliyunSmsResponse>
}

type AliyunSmsClientConstructor = new (
  config: InstanceType<typeof OpenApi.Config>,
) => AliyunSmsClient

const resolveClientConstructor = (): AliyunSmsClientConstructor => {
  const moduleValue = Dysmsapi as unknown as { default?: unknown }
  if (typeof moduleValue.default === 'function') {
    return moduleValue.default as AliyunSmsClientConstructor
  }
  const nestedDefault = (moduleValue.default as { default?: unknown } | undefined)?.default
  if (typeof nestedDefault === 'function') {
    return nestedDefault as AliyunSmsClientConstructor
  }
  throw new Error('Aliyun SMS client is unavailable')
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

  const client = injectedClient ?? (() => {
    const Client = resolveClientConstructor()
    return new Client(new OpenApi.Config({
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      endpoint: options.endpoint,
      regionId: options.regionId,
    }))
  })()

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
