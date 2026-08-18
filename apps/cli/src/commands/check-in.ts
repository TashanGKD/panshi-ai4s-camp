import encodeQR from 'qr'
import { CliRuntimeError } from '../errors.js'
import { savePrivateBytes } from './download.js'
import { parseOptions, requiredString } from './options.js'
import type { CommandHandler } from './types.js'

export const runCheckInShow: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'check-in show 不接受额外参数')
  const response = await client.checkIn.show()
  if (response.data.availability === 'unavailable') return { data: response.data }
  const safe = { ...response.data }
  delete (safe as Partial<typeof response.data>).qrPayload
  return { data: { ...safe, qrPayload: '[REDACTED]' } }
}

export const runCheckInQrExport: CommandHandler = async (context) => {
  const { positionals, values } = parseOptions(context.args, { '--output': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'check-in qr export 参数无效')
  const response = await context.client.checkIn.show()
  if (response.data.availability === 'unavailable') throw new CliRuntimeError('STATE_NOT_ALLOWED', response.data.reason)
  const bytes = encodeQR(response.data.qrPayload, 'gif', { scale: 8 })
  const result = await savePrivateBytes({
    outputPath: requiredString(values, 'output'), bytes,
    workspaceRoot: context.workspaceRoot, homeDirectory: context.homeDirectory,
  })
  bytes.fill(0)
  return { data: { ...result, displayCode: response.data.displayCode } }
}
