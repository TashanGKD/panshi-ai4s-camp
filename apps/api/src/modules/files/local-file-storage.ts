import { createHash, randomUUID } from 'node:crypto'
import {
  accessSync,
  constants,
  createReadStream,
  createWriteStream,
  mkdirSync,
  realpathSync,
} from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FileStorage, FileWriteMetadata, StoredFile } from './file-storage.js'
import { FileValidationError, validateStoredFileContent } from './file-validation.js'

export class FileStorageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'FileStorageError'
  }
}

const storageKeyPattern = /^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u

const inside = (root: string, target: string) => target.startsWith(`${root}${sep}`)

const mapError = (error: unknown): FileStorageError => {
  if (error instanceof FileStorageError) return error
  if (error instanceof FileValidationError) return new FileStorageError(error.code, error.message)
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
    return new FileStorageError('FILE_NOT_FOUND', '文件不存在')
  }
  return new FileStorageError('FILE_WRITE_INTERRUPTED', '文件写入中断')
}

export const createLocalFileStorage = ({ root, maxBytes }: { root: string, maxBytes: number }): FileStorage => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid file size limit')
  mkdirSync(resolve(root), { recursive: true, mode: 0o700 })
  const resolvedRoot = realpathSync(resolve(root))
  accessSync(resolvedRoot, constants.R_OK | constants.W_OK)
  const temporaryRoot = resolve(resolvedRoot, '.tmp')
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 })

  const resolveKey = (storageKey: string) => {
    if (!storageKeyPattern.test(storageKey)) {
      throw new FileStorageError('FILE_STORAGE_KEY_INVALID', '文件存储标识无效')
    }
    const target = resolve(resolvedRoot, storageKey)
    if (!inside(resolvedRoot, target)) throw new FileStorageError('FILE_STORAGE_KEY_INVALID', '文件存储标识无效')
    return target
  }

  const put = async (input: Readable, metadata: FileWriteMetadata): Promise<StoredFile> => {
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) {
      throw new FileStorageError('FILE_SIZE_INVALID', '文件大小无效')
    }
    if (metadata.size > maxBytes) throw new FileStorageError('FILE_TOO_LARGE', '文件超过大小限制')

    const id = randomUUID()
    const storageKey = `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`
    const target = resolveKey(storageKey)
    const temporary = resolve(temporaryRoot, `${randomUUID()}.part`)
    if (!inside(resolvedRoot, temporary)) throw new FileStorageError('FILE_STORAGE_KEY_INVALID', '临时存储路径无效')
    const hash = createHash('sha256')
    let size = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > maxBytes || size > metadata.size) {
          callback(new FileStorageError('FILE_TOO_LARGE', '文件超过大小限制'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
    })

    try {
      await pipeline(input, counter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
      if (size !== metadata.size) throw new FileStorageError('FILE_SIZE_MISMATCH', '文件大小与声明不一致')
      const content = await readFile(temporary)
      validateStoredFileContent(content, metadata.mime, maxBytes)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await rename(temporary, target)
      return { storageKey, sha256: hash.digest('hex'), size, mime: metadata.mime }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw mapError(error)
    }
  }

  return {
    put,
    open: async (storageKey) => {
      const target = resolveKey(storageKey)
      try {
        accessSync(target, constants.R_OK)
        return createReadStream(target)
      } catch (error) {
        throw mapError(error)
      }
    },
    remove: async (storageKey) => {
      const target = resolveKey(storageKey)
      await rm(target, { force: true })
    },
  }
}
