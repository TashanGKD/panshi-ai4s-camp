import * as Dysmsapi from '@alicloud/dysmsapi20170525'
import * as OpenApi from '@alicloud/openapi-client'

export type AliyunSmsResponse = {
  body?: {
    code?: string
    message?: string
    bizId?: string
    requestId?: string
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

export const createAliyunSmsClient = (options: {
  accessKeyId: string
  accessKeySecret: string
  endpoint: string
  regionId: string
}): AliyunSmsClient => {
  const Client = resolveClientConstructor()
  return new Client(new OpenApi.Config(options))
}

export { Dysmsapi }
