#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseCliArgv } from './argv.js'
import { CliRuntimeError, safeError } from './errors.js'
import { createOutput } from './output.js'

const HELP = `磐石·科学智能实训营 CLI

用法：panshi-camp [--json] [--profile NAME] <命令>

当前可用：help
后续命令将覆盖官网公开信息、账号、报名、附件、资料和报到凭证。`

type Dependencies = {
  stdout?: (text: string) => unknown
  stderr?: (text: string) => unknown
  fetch?: typeof globalThis.fetch
  readConfig?: () => Promise<unknown>
  getCredential?: () => Promise<unknown>
}

export const runCli = async (argv: string[], dependencies: Dependencies = {}): Promise<number> => {
  let json = argv.includes('--json')
  try {
    const parsed = parseCliArgv(argv)
    json = parsed.json
    const output = createOutput({ json, stdout: dependencies.stdout, stderr: dependencies.stderr })
    if (parsed.help || parsed.command.length === 0 || parsed.command[0] === 'help') {
      if (json) {
        output.success({ ok: true, apiVersion: 'v1', capabilityId: 'public.site.show', data: { help: HELP }, requestId: 'local' })
      } else output.text(HELP)
      return 0
    }
    throw new CliRuntimeError('INPUT_INVALID', `未知命令：${parsed.command.join(' ')}`)
  } catch (error) {
    const output = createOutput({ json, stdout: dependencies.stdout, stderr: dependencies.stderr })
    const safe = safeError(error)
    output.failure({ ok: false, code: safe.code, message: safe.message, details: safe.details, requestId: 'local' })
    return 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = await runCli(process.argv.slice(2))
