import { ApplicationDraftSaveRequestSchema } from '@panshi/contracts'
import { CliRuntimeError } from '../errors.js'
import { parseOptions, readJsonInput, requiredString } from './options.js'
import type { CommandHandler } from './types.js'

export const runApplicationShow: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'application show 不接受额外参数')
  return { data: (await client.application.getMine()).data }
}

export const runApplicationValidate: CommandHandler = async ({ args, stdin }) => {
  const { positionals, values } = parseOptions(args, { '--input': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'application validate 参数无效')
  const input = await readJsonInput(requiredString(values, 'input'), stdin)
  const parsed = ApplicationDraftSaveRequestSchema.safeParse(input)
  return { data: parsed.success
    ? { valid: true }
    : { valid: false, issues: parsed.error.issues.map(({ path, code, message }) => ({ path: path.map(String).join('.'), code, message })) } }
}
