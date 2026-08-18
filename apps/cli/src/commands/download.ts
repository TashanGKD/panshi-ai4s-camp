import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, lstat, open, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { CliRuntimeError } from '../errors.js'

type DownloadInput = {
  outputPath: string
  stream: ReadableStream<Uint8Array>
  headers: Headers
  workspaceRoot: string
  homeDirectory: string
}

const unresolvedVariable = /(?:\$[A-Za-z_{]|%[A-Za-z_][A-Za-z0-9_]*%|^~(?:\/|$))/u

const assertServerFilenameSafe = (headers: Headers) => {
  const disposition = headers.get('Content-Disposition')
  const match = disposition?.match(/filename\*?=(?:UTF-8''|)["']?([^"';]+)["']?/iu)
  if (!match) return
  let filename: string
  try { filename = decodeURIComponent(match[1]!) } catch { throw new CliRuntimeError('INPUT_INVALID', '服务端文件名无效') }
  if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
    throw new CliRuntimeError('INPUT_INVALID', '服务端文件名包含不安全路径')
  }
}

export const resolveSafeOutputPath = async (raw: string, workspaceRoot: string, homeDirectory: string) => {
  if (!raw.trim() || unresolvedVariable.test(raw)) throw new CliRuntimeError('INPUT_INVALID', '输出路径无效')
  const target = resolve(raw)
  const protectedPaths = ['/', resolve(workspaceRoot), resolve(homeDirectory)]
  if (protectedPaths.includes(target)) throw new CliRuntimeError('INPUT_INVALID', '不能写入受保护路径')
  const parent = dirname(target)
  const parentMetadata = await lstat(parent).catch(() => { throw new CliRuntimeError('INPUT_INVALID', '输出目录不存在') })
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) throw new CliRuntimeError('INPUT_INVALID', '输出目录不安全')
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing) throw new CliRuntimeError('OUTPUT_EXISTS', '输出目标已存在')
  return target
}

export const saveDownload = async (input: DownloadInput) => {
  assertServerFilenameSafe(input.headers)
  const target = await resolveSafeOutputPath(input.outputPath, input.workspaceRoot, input.homeDirectory)
  const temporary = `${target}.panshi-${randomUUID()}.tmp`
  let created = false
  try {
    const handle = await open(temporary, 'wx', 0o600)
    await handle.close(); created = true
    await pipeline(Readable.fromWeb(input.stream as never), createWriteStream(temporary, { flags: 'r+', mode: 0o600 }))
    await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new CliRuntimeError('OUTPUT_EXISTS', '输出目标已存在')
      throw error
    })
    await unlink(temporary); created = false
    return { output: target }
  } finally {
    if (created) await unlink(temporary).catch(() => undefined)
  }
}

export const savePrivateBytes = async (input: Omit<DownloadInput, 'stream' | 'headers'> & { bytes: Uint8Array }) => saveDownload({
  ...input,
  headers: new Headers(),
  stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(input.bytes); controller.close() } }),
})
