import { CliRuntimeError } from '../errors.js'
import { saveDownload } from './download.js'
import { parseOptions, requiredString } from './options.js'
import type { CommandHandler } from './types.js'

export const runResourcesList: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'resources list 不接受额外参数')
  return { data: (await client.public.listResources()).data }
}

const download = async (kind: 'resource' | 'file', context: Parameters<CommandHandler>[0]) => {
  const { positionals, values } = parseOptions(context.args, { '--output': 'string' })
  if (positionals.length !== 1 || !positionals[0]) throw new CliRuntimeError('INPUT_INVALID', '请提供文件编号')
  const outputPath = requiredString(values, 'output')
  const response = kind === 'resource'
    ? await context.client.public.downloadResource(positionals[0])
    : await context.client.files.download(positionals[0])
  return { data: await saveDownload({
    outputPath, stream: response.stream, headers: response.headers,
    workspaceRoot: context.workspaceRoot, homeDirectory: context.homeDirectory,
  }) }
}

export const runResourceDownload: CommandHandler = (context) => download('resource', context)
export const runFileDownload: CommandHandler = (context) => download('file', context)
