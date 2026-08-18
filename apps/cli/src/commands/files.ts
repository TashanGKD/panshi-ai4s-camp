import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { extractConfirmationOptions, runConfirmedOperation } from '../confirmation-flow.js'
import { CliRuntimeError } from '../errors.js'
import { parseOptions, requiredString } from './options.js'
import type { CommandHandler } from './types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

const validateUpload = async (rawPath: string) => {
  if (/\$[A-Za-z_{]|%[A-Za-z_][A-Za-z0-9_]*%|^~/u.test(rawPath)) throw new CliRuntimeError('INPUT_INVALID', '上传路径无效')
  const path = resolve(rawPath)
  const metadata = await lstat(path).catch(() => { throw new CliRuntimeError('RESOURCE_NOT_FOUND', '上传文件不存在') })
  const mimeType = MIME[extname(path).toLowerCase()]
  if (!metadata.isFile() || metadata.isSymbolicLink() || !mimeType || metadata.size <= 0 || metadata.size > 5 * 1024 * 1024) {
    throw new CliRuntimeError('INPUT_INVALID', '仅支持不超过 5 MB 的 PDF、DOCX、JPG 文件')
  }
  const bytes = await readFile(path)
  return { path, bytes, mimeType, originalName: basename(path), sizeBytes: metadata.size, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export const runFileUpload: CommandHandler = async (context) => {
  const extracted = extractConfirmationOptions(context.args)
  const { positionals, values } = parseOptions(extracted.remaining, { '--slot': 'string' })
  if (positionals.length !== 1) throw new CliRuntimeError('INPUT_INVALID', '请提供一个上传文件路径')
  const slot = requiredString(values, 'slot')
  if (!UUID.test(slot)) throw new CliRuntimeError('INPUT_INVALID', '附件 slot-id 格式无效')
  const file = await validateUpload(positionals[0]!)
  const preview = { sha256: file.sha256, sizeBytes: file.sizeBytes, originalName: file.originalName, mimeType: file.mimeType, purpose: 'registration_attachment', attachmentSlot: slot }
  const response = await runConfirmedOperation({
    capabilityId: 'file.upload', previewPayload: preview, executionPayload: preview, json: context.json,
    options: extracted.options, prepare: context.client.confirmations.prepare, confirm: context.confirm as never,
    execute: async (confirmation) => {
      const form = new FormData()
      form.append('file', new Blob([file.bytes], { type: file.mimeType }), file.originalName)
      form.append('purpose', 'registration_attachment'); form.append('attachmentSlot', slot)
      return await context.client.files.upload(form, confirmation)
    },
  })
  return { data: response.data }
}

const runFileStateChange = async (context: Parameters<CommandHandler>[0], capabilityId: 'file.hide' | 'file.delete') => {
  const extracted = extractConfirmationOptions(context.args)
  if (extracted.remaining.length !== 1 || !UUID.test(extracted.remaining[0]!)) throw new CliRuntimeError('INPUT_INVALID', '请提供有效的附件 ID')
  const fileId = extracted.remaining[0]!
  const payload = { fileId }
  const response = await runConfirmedOperation({
    capabilityId, previewPayload: payload, executionPayload: payload, json: context.json,
    options: extracted.options, targetIdentifier: fileId, prepare: context.client.confirmations.prepare,
    confirm: context.confirm as never,
    execute: async (confirmation) => capabilityId === 'file.delete'
      ? await context.client.files.delete(fileId, confirmation)
      : await context.client.files.hide(fileId, confirmation),
  })
  return { data: response.data }
}

export const runFileHide: CommandHandler = async (context) => runFileStateChange(context, 'file.hide')
export const runFileDelete: CommandHandler = async (context) => runFileStateChange(context, 'file.delete')
