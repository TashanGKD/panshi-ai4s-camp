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
  const result: ParsedCliArgv = { command: [], json: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]!
    if (item === '--json') { result.json = true; continue }
    if (item === '--help' || item === '-h') { result.help = true; continue }
    const global = ['--base-url', '--profile', '--environment'].find((name) => item === name || item.startsWith(`${name}=`))
    if (!global) { result.command.push(item); continue }
    const inline = item.startsWith(`${global}=`) ? item.slice(global.length + 1) : undefined
    const value = inline ?? argv[index + 1]
    if (!value || (!inline && value.startsWith('-'))) throw new CliRuntimeError('UNKNOWN_OR_FORBIDDEN_OPTION')
    if (!inline) index += 1
    if (global === '--base-url') result.baseUrl = value
    if (global === '--profile') result.profile = value
    if (global === '--environment') {
      if (value !== 'local' && value !== 'production') throw new CliRuntimeError('ENVIRONMENT_INVALID')
      result.environment = value
    }
  }
  return result
}
