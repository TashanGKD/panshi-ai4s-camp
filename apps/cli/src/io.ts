import { readFileSync } from 'node:fs'
import { emitKeypressEvents } from 'node:readline'
import { CliRuntimeError } from './errors.js'

type SecretInput = {
  isTTY: boolean
  env: NodeJS.ProcessEnv
  readFd: (fd: number) => Promise<string>
  prompt?: (label: string) => Promise<string>
}

const defaultReadFd = async (fd: number) => readFileSync(fd, 'utf8')

export const promptHidden = async (label: string): Promise<string> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') throw new CliRuntimeError('INTERACTIVE_INPUT_REQUIRED')
  process.stderr.write(`${label}: `)
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true); process.stdin.resume()
  return await new Promise<string>((resolve, reject) => {
    let value = ''
    const cleanup = () => { process.stdin.off('keypress', onKey); process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write('\n') }
    const onKey = (text: string, key: { name?: string, ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new CliRuntimeError('INPUT_CANCELLED')); return }
      if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); return }
      if (key.name === 'backspace') { value = value.slice(0, -1); return }
      if (text && !key.ctrl) value += text
    }
    process.stdin.on('keypress', onKey)
  })
}

export const readSecret = async (
  input: Partial<SecretInput> & Pick<SecretInput, 'isTTY' | 'env'>,
  label: string,
): Promise<string> => {
  const fdText = input.env.PANSHI_CAMP_SECRET_FD
  let secret: string
  if (fdText !== undefined) {
    if (!/^\d+$/u.test(fdText)) throw new CliRuntimeError('SECRET_FD_INVALID')
    const fd = Number(fdText)
    if (!Number.isSafeInteger(fd) || fd < 3 || fd > 1024) throw new CliRuntimeError('SECRET_FD_INVALID')
    secret = await (input.readFd ?? defaultReadFd)(fd)
  } else {
    if (!input.isTTY) throw new CliRuntimeError('INTERACTIVE_INPUT_REQUIRED')
    secret = await (input.prompt ?? promptHidden)(label)
  }
  secret = secret.replace(/\r?\n$/u, '')
  if (!secret || /[\r\n]/u.test(secret)) throw new CliRuntimeError('SECRET_INPUT_INVALID')
  return secret
}

export const readSecretBundle = async (
  input: Partial<SecretInput> & Pick<SecretInput, 'isTTY' | 'env'>,
  fields: Array<{ key: string, label: string }>,
): Promise<Record<string, string>> => {
  if (fields.length === 0) return {}
  if (input.isTTY && input.env.PANSHI_CAMP_SECRET_FD === undefined) {
    const result: Record<string, string> = {}
    for (const field of fields) {
      const secret = await (input.prompt ?? promptHidden)(field.label)
      if (!secret || /[\r\n]/u.test(secret)) throw new CliRuntimeError('SECRET_INPUT_INVALID')
      result[field.key] = secret
    }
    return result
  }
  const raw = await readSecret(input, fields.length === 1 ? fields[0]!.label : '敏感信息')
  if (fields.length === 1) return { [fields[0]!.key]: raw }
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new CliRuntimeError('SECRET_INPUT_INVALID') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliRuntimeError('SECRET_INPUT_INVALID')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !fields.some((field) => field.key === key))) throw new CliRuntimeError('SECRET_INPUT_INVALID')
  const result: Record<string, string> = {}
  for (const field of fields) {
    const secret = record[field.key]
    if (typeof secret !== 'string' || !secret || /[\r\n]/u.test(secret)) throw new CliRuntimeError('SECRET_INPUT_INVALID')
    result[field.key] = secret
  }
  return result
}
