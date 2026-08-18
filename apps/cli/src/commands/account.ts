import { runConfirmedOperation, extractConfirmationOptions } from '../confirmation-flow.js'
import { CliRuntimeError } from '../errors.js'
import type { CommandHandler } from './types.js'

export const runAccountPasswordChange: CommandHandler = async (context) => {
  const extracted = extractConfirmationOptions(context.args)
  if (extracted.remaining.length) throw new CliRuntimeError('INPUT_INVALID', 'account password change 参数无效')
  const secrets = await context.readSecrets([
    { key: 'currentPassword', label: '当前密码' },
    { key: 'newPassword', label: '新密码' },
  ])
  const body = { currentPassword: secrets.currentPassword!, newPassword: secrets.newPassword! }
  try {
    const response = await runConfirmedOperation({
      capabilityId: 'account.password_change', previewPayload: { account: 'self' }, executionPayload: body,
      json: context.json, options: extracted.options, prepare: context.client.confirmations.prepare,
      confirm: context.confirm as never,
      execute: async (confirmation) => await context.client.auth.changePassword(body, confirmation),
    })
    return { data: response.data }
  } finally {
    body.currentPassword = ''; body.newPassword = ''; secrets.currentPassword = ''; secrets.newPassword = ''
  }
}
