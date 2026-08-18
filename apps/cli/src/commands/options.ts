import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CliRuntimeError } from '../errors.js'

export const parseOptions = (args: string[], definitions: Record<string, 'boolean' | 'string'>) => {
  const positionals: string[] = []
  const values: Record<string, string | boolean> = {}
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]!
    if (!item.startsWith('--')) { positionals.push(item); continue }
    const [name, inline] = item.split('=', 2)
    const type = definitions[name!]
    if (!type) throw new CliRuntimeError('INPUT_INVALID', `不支持的选项：${name}`)
    if (type === 'boolean') {
      if (inline !== undefined) throw new CliRuntimeError('INPUT_INVALID', `${name} 不接受参数`)
      values[name!.slice(2)] = true
      continue
    }
    const value = inline ?? args[index + 1]
    if (!value || (!inline && value.startsWith('--'))) throw new CliRuntimeError('INPUT_INVALID', `${name} 缺少参数`)
    if (inline === undefined) index += 1
    values[name!.slice(2)] = value
  }
  return { positionals, values }
}

export const requiredString = (values: Record<string, string | boolean>, key: string) => {
  const value = values[key]
  if (typeof value !== 'string' || !value.trim()) throw new CliRuntimeError('INPUT_INVALID', `缺少 --${key}`)
  return value
}

export const readJsonInput = async (source: string, stdin: () => Promise<string>) => {
  let text: string
  if (source === '-') text = await stdin()
  else {
    if (/\$[A-Za-z_{]|%[A-Za-z_][A-Za-z0-9_]*%|^~/u.test(source)) throw new CliRuntimeError('INPUT_INVALID', '输入路径无效')
    const path = resolve(source)
    const metadata = await lstat(path).catch(() => { throw new CliRuntimeError('RESOURCE_NOT_FOUND', '输入文件不存在') })
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2 * 1024 * 1024) throw new CliRuntimeError('INPUT_INVALID', '输入文件无效')
    text = await readFile(path, 'utf8')
  }
  try { return JSON.parse(text) as unknown } catch { throw new CliRuntimeError('INPUT_INVALID', '输入内容不是有效 JSON') }
}
