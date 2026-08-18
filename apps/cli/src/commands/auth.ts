import { randomBytes, randomUUID } from 'node:crypto'
import { CliLoginResponseSchema, maskMainlandChinaMobile, normalizeMainlandChinaMobile } from '@panshi/contracts'
import { CliRuntimeError } from '../errors.js'
import type { CommandHandler } from './types.js'

export const runAuthStatus: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'auth status 不接受额外参数')
  return { data: (await client.auth.status()).data }
}

export const runAuthLogin: CommandHandler = async (context) => {
  if (context.args.length) throw new CliRuntimeError('INPUT_INVALID', 'auth login 不接受明文参数')
  const phone = context.phoneHint ?? await context.promptText('手机号')
  const normalizedPhone = normalizeMainlandChinaMobile(phone)
  let password = await context.readSecret('密码')
  const payload = { phone: normalizedPhone, password, clientKind: 'cli' as const }
  const binding = randomBytes(32).toString('hex')
  const idempotencyKey = randomUUID()
  try {
    const prepared = await context.client.confirmations.prepare('auth.login', {
      phoneMasked: maskMainlandChinaMobile(normalizedPhone),
      clientKind: 'cli',
    }, { clientBinding: binding, idempotencyKey })
    if (context.json || !await context.confirm(prepared.data.preview)) {
      throw new CliRuntimeError('CONFIRMATION_REQUIRED', '登录操作尚未确认', { confirmationId: prepared.data.confirmationId, preview: prepared.data.preview })
    }
    const raw = await context.client.confirmations.execute(prepared.data.confirmationId, payload, { clientBinding: binding, idempotencyKey })
    const response = CliLoginResponseSchema.parse(raw)
    let token = response.data.token
    try { await context.credentials.set(context.profileName, token) } finally { token = '' }
    return { data: { user: response.data.user, expiresAt: response.data.expiresAt } }
  } finally { password = '' }
}
