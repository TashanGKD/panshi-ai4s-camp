import { parseArgs } from 'node:util'
import { CliRuntimeError } from './errors.js'

const forbidden = new Set(['--password', '--verification-code', '--token', '--cookie'])

export type ParsedCliArgv = {
  command: string[]
  json: boolean
  help: boolean
  baseUrl?: string
  profile?: string
  environment?: 'local' | 'production'
}

export const parseCliArgv = (argv: string[]): ParsedCliArgv => {
  for (const item of argv) if (forbidden.has(item.split('=', 1)[0]!)) throw new CliRuntimeError('UNKNOWN_OR_FORBIDDEN_OPTION')
  try {
    const parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
        'base-url': { type: 'string' }, profile: { type: 'string' }, environment: { type: 'string' },
      },
    })
    const environment = parsed.values.environment
    if (environment !== undefined && environment !== 'local' && environment !== 'production') throw new CliRuntimeError('ENVIRONMENT_INVALID')
    return {
      command: parsed.positionals, json: parsed.values.json ?? false, help: parsed.values.help ?? false,
      ...(parsed.values['base-url'] ? { baseUrl: parsed.values['base-url'] } : {}),
      ...(parsed.values.profile ? { profile: parsed.values.profile } : {}),
      ...(environment ? { environment } : {}),
    }
  } catch (error) {
    if (error instanceof CliRuntimeError) throw error
    throw new CliRuntimeError('UNKNOWN_OR_FORBIDDEN_OPTION')
  }
}
