import { CliLoginResponseSchema, maskMainlandChinaMobile, normalizeMainlandChinaMobile } from '@panshi/contracts'
import { runConfirmedOperation, extractConfirmationOptions, type ConfirmationOptions, type ConfirmedContext } from '../confirmation-flow.js'
import { CliRuntimeError } from '../errors.js'
import { parseOptions } from './options.js'
import type { CommandContext, CommandHandler } from './types.js'

const phoneFrom = async (context: CommandContext, value: string | boolean | undefined) => {
  const phone = typeof value === 'string' ? value : context.phoneHint ?? (context.json ? null : await context.promptText('手机号'))
  if (!phone) throw new CliRuntimeError('INTERACTIVE_INPUT_REQUIRED', '请通过配置 phoneHint 或 --phone 提供手机号')
  try { return normalizeMainlandChinaMobile(phone) } catch { throw new CliRuntimeError('INPUT_INVALID', '手机号格式无效') }
}

const confirmed = async <T>(context: CommandContext, capabilityId: Parameters<typeof runConfirmedOperation<T>>[0]['capabilityId'], input: {
  options: ConfirmationOptions, previewPayload: Record<string, unknown>, executionPayload: Record<string, unknown>,
  targetIdentifier?: string, execute: (confirmation: ConfirmedContext) => Promise<T>,
}) => runConfirmedOperation({
  capabilityId, previewPayload: input.previewPayload as never, executionPayload: input.executionPayload as never,
  json: context.json, options: input.options, targetIdentifier: input.targetIdentifier,
  prepare: context.client.confirmations.prepare, execute: input.execute, confirm: context.confirm as never,
})

export const runAuthStatus: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'auth status 不接受额外参数')
  return { data: (await client.auth.status()).data }
}

export const runAuthLogin: CommandHandler = async (context) => {
  const extracted = extractConfirmationOptions(context.args)
  const { positionals, values } = parseOptions(extracted.remaining, { '--phone': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'auth login 不接受明文密码或验证码参数')
  const phone = await phoneFrom(context, values.phone)
  const secrets = await context.readSecrets([{ key: 'password', label: '密码' }])
  const body = { phone, password: secrets.password! }
  try {
    const response = await confirmed(context, 'auth.login', {
      options: extracted.options, previewPayload: { phoneMasked: maskMainlandChinaMobile(phone), clientKind: 'cli' }, executionPayload: { ...body, clientKind: 'cli' },
      execute: async (confirmation) => await context.client.auth.loginCli(body, confirmation),
    })
    const parsed = CliLoginResponseSchema.parse(response)
    let token = parsed.data.token
    try { await context.credentials.set(context.profileName, token) } finally { token = '' }
    return { data: { user: parsed.data.user, expiresAt: parsed.data.expiresAt } }
  } finally { body.password = ''; secrets.password = '' }
}

export const runAuthVerificationSend: CommandHandler = async (context) => {
  const extracted = extractConfirmationOptions(context.args)
  const { positionals, values } = parseOptions(extracted.remaining, { '--phone': 'string', '--purpose': 'string' })
  if (positionals.length || !['register', 'reset_password'].includes(String(values.purpose))) throw new CliRuntimeError('INPUT_INVALID', '请提供 --purpose register|reset_password')
  const phone = await phoneFrom(context, values.phone)
  const body = { phone, purpose: values.purpose as 'register' | 'reset_password' }
  const response = await confirmed(context, 'auth.verification.send', {
    options: extracted.options, previewPayload: { phoneMasked: maskMainlandChinaMobile(phone), purpose: body.purpose }, executionPayload: body,
    execute: async (confirmation) => await context.client.auth.sendVerificationCode(body, confirmation),
  })
  return { data: response.data }
}

export const runAuthRegister: CommandHandler = async (context) => {
  const extracted = extractConfirmationOptions(context.args)
  const { positionals, values } = parseOptions(extracted.remaining, { '--phone': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'auth register 不接受明文密码或验证码参数')
  const phone = await phoneFrom(context, values.phone)
  const secrets = await context.readSecrets([{ key: 'code', label: '验证码' }, { key: 'password', label: '密码' }])
  const body = { phone, code: secrets.code!, password: secrets.password! }
  try {
    const response = await confirmed(context, 'auth.register', {
      options: extracted.options, previewPayload: { phoneMasked: maskMainlandChinaMobile(phone) }, executionPayload: body,
      execute: async (confirmation) => await context.client.auth.register(body, confirmation),
    })
    return { data: response.data }
  } finally { body.code = ''; body.password = ''; secrets.code = ''; secrets.password = '' }
}

export const runAuthPasswordReset: CommandHandler = async (context) => {
  const extracted = extractConfirmationOptions(context.args)
  const { positionals, values } = parseOptions(extracted.remaining, { '--phone': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'auth password-reset 不接受明文密码或验证码参数')
  const phone = await phoneFrom(context, values.phone)
  const secrets = await context.readSecrets([{ key: 'code', label: '验证码' }, { key: 'newPassword', label: '新密码' }])
  const body = { phone, code: secrets.code!, newPassword: secrets.newPassword! }
  try {
    const response = await confirmed(context, 'auth.password_reset', {
      options: extracted.options, previewPayload: { phoneMasked: maskMainlandChinaMobile(phone) }, executionPayload: body,
      execute: async (confirmation) => await context.client.auth.resetPassword(body, confirmation),
    })
    return { data: response.data }
  } finally { body.code = ''; body.newPassword = ''; secrets.code = ''; secrets.newPassword = '' }
}

export const runAuthLogout: CommandHandler = async (context) => {
  const extracted = extractConfirmationOptions(context.args)
  if (extracted.remaining.length) throw new CliRuntimeError('INPUT_INVALID', 'auth logout 参数无效')
  const data = await confirmed(context, 'auth.logout', {
    options: extracted.options, previewPayload: { scope: 'current' }, executionPayload: { scope: 'current' },
    execute: async (confirmation) => await context.client.auth.logoutCli(confirmation),
  })
  await context.credentials.delete(context.profileName)
  return { data: data.data }
}
