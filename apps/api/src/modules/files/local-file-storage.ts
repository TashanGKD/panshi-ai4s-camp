import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, constants, createWriteStream, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const projectRoot = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)))
const storageKeyPattern = /^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const privateDirectoryMode = 0o700
const privateFileMode = 0o600

const isInside = (root: string, target: string) => {
  const pathFromRoot = relative(root, target)
  return pathFromRoot !== '' && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}

const hasCode = (error: unknown, code: string) => (
  typeof error === 'object' && error !== null && 'code' in error && error.code === code
)
const isMissing = (error: unknown) => hasCode(error, 'ENOENT')
const isSymlinkError = (error: unknown) => hasCode(error, 'ELOOP') || hasCode(error, 'EMLINK')

const unsafeRoot = (): never => {
  throw new FileStorageError('FILE_STORAGE_ROOT_UNSAFE', '文件存储根目录不安全')
}

const allowedPlatformAlias = (path: string) => process.platform === 'darwin' && (path === '/var' || path === '/tmp')

const assertNoSymlinkComponents = (path: string) => {
  const parsed = parse(path)
  let current = parsed.root
  for (const component of path.slice(parsed.root.length).split(sep).filter(Boolean)) {
    current = join(current, component)
    try {
      if (lstatSync(current).isSymbolicLink() && !allowedPlatformAlias(current)) unsafeRoot()
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
  }
}

const assertPrivateDirectorySync = (path: string, code: string) => {
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o777) !== privateDirectoryMode) {
    throw new FileStorageError(code, '文件存储目录不安全')
  }
  return realpathSync(path)
}

export const preparePrivateDirectory = (input: string, options: { rejectBroad?: boolean } = {}) => {
  const path = resolve(input)
  if (options.rejectBroad && new Set([parse(path).root, resolve(homedir()), projectRoot]).has(path)) unsafeRoot()
  assertNoSymlinkComponents(path)
  try {
    const existing = lstatSync(path)
    if (existing.isSymbolicLink() || !existing.isDirectory()) unsafeRoot()
  } catch (error) {
    if (!isMissing(error)) throw error
    mkdirSync(path, { recursive: true, mode: privateDirectoryMode })
  }
  assertNoSymlinkComponents(path)
  chmodSync(path, privateDirectoryMode)
  const realPath = assertPrivateDirectorySync(path, 'FILE_STORAGE_ROOT_UNSAFE')
  if (options.rejectBroad && [parse(realPath).root, realpathSync(homedir()), projectRoot].includes(realPath)) unsafeRoot()
  return realPath
}

const mapError = (error: unknown): FileStorageError => {
  if (error instanceof FileStorageError) return error
  if (error instanceof FileValidationError) return new FileStorageError(error.code, error.message)
  if (isMissing(error)) return new FileStorageError('FILE_NOT_FOUND', '文件不存在')
  if (isSymlinkError(error)) return new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝符号链接文件')
  return new FileStorageError('FILE_WRITE_INTERRUPTED', '文件写入中断')
}

export const createLocalFileStorage = ({ root, maxBytes }: { root: string, maxBytes: number }): FileStorage => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid file size limit')
  const resolvedRoot = preparePrivateDirectory(root, { rejectBroad: true })
  const temporaryRoot = preparePrivateDirectory(resolve(resolvedRoot, '.tmp'))
  if (!isInside(resolvedRoot, temporaryRoot)) unsafeRoot()

  const verifyRoot = () => {
    if (assertPrivateDirectorySync(resolvedRoot, 'FILE_STORAGE_ROOT_UNSAFE') !== resolvedRoot) unsafeRoot()
  }
  const verifyTemporaryRoot = () => {
    verifyRoot()
    if (assertPrivateDirectorySync(temporaryRoot, 'FILE_STORAGE_SYMLINK_REJECTED') !== temporaryRoot) {
      throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '临时文件目录不安全')
    }
  }
  const resolveKey = (storageKey: string) => {
    if (!storageKeyPattern.test(storageKey)) throw new FileStorageError('FILE_STORAGE_KEY_INVALID', '文件存储标识无效')
    const target = resolve(resolvedRoot, storageKey)
    if (!isInside(resolvedRoot, target)) throw new FileStorageError('FILE_STORAGE_KEY_INVALID', '文件存储标识无效')
    return target
  }
  const verifyDirectory = async (path: string, create: boolean) => {
    if (create) {
      try {
        await mkdir(path, { mode: privateDirectoryMode })
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
      }
    }
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o777) !== privateDirectoryMode) {
      throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '文件分片目录不安全')
    }
    const actual = await realpath(path)
    if (!isInside(resolvedRoot, actual)) throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '文件分片目录越界')
  }
  const verifyKeyParent = async (storageKey: string, create: boolean) => {
    verifyRoot()
    const [first, second] = storageKey.split('/')
    const firstPath = resolve(resolvedRoot, first!)
    const secondPath = resolve(firstPath, second!)
    await verifyDirectory(firstPath, create)
    await verifyDirectory(secondPath, create)
  }
  const safeUnlinkTemporary = async (path: string) => {
    try {
      verifyTemporaryRoot()
      const metadata = await lstat(path)
      if (!metadata.isSymbolicLink() && metadata.isFile()) await unlink(path)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }

  const createStorageKey = () => {
    const id = randomUUID()
    return `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`
  }

  const put = async (input: Readable, metadata: FileWriteMetadata, requestedStorageKey?: string): Promise<StoredFile> => {
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) throw new FileStorageError('FILE_SIZE_INVALID', '文件大小无效')
    if (metadata.size > maxBytes) throw new FileStorageError('FILE_TOO_LARGE', '文件超过大小限制')
    verifyTemporaryRoot()
    const storageKey = requestedStorageKey ?? createStorageKey()
    const target = resolveKey(storageKey)
    const temporary = resolve(temporaryRoot, `${randomUUID()}.part`)
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
      const writeFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
      const descriptor = openSync(temporary, writeFlags, privateFileMode)
      await pipeline(input, counter, createWriteStream(temporary, { fd: descriptor, autoClose: true }))
      if (size !== metadata.size) throw new FileStorageError('FILE_SIZE_MISMATCH', '文件大小与声明不一致')
      verifyTemporaryRoot()
      const temporaryHandle = await open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW)
      let content: Buffer
      try {
        const temporaryMetadata = await temporaryHandle.stat()
        if (!temporaryMetadata.isFile() || (temporaryMetadata.mode & 0o777) !== privateFileMode) {
          throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '临时文件不安全')
        }
        content = await temporaryHandle.readFile()
      } finally {
        await temporaryHandle.close()
      }
      validateStoredFileContent(content, metadata.mime, maxBytes)
      await verifyKeyParent(storageKey, true)
      try {
        await lstat(target)
        throw new FileStorageError('FILE_STORAGE_COLLISION', '文件存储标识冲突')
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await rename(temporary, target)
      await verifyKeyParent(storageKey, false)
      const finalMetadata = await lstat(target)
      if (finalMetadata.isSymbolicLink() || !finalMetadata.isFile() || (finalMetadata.mode & 0o777) !== privateFileMode) {
        throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '最终文件不安全')
      }
      return { storageKey, sha256: hash.digest('hex'), size, mime: metadata.mime }
    } catch (error) {
      await safeUnlinkTemporary(temporary).catch(() => undefined)
      throw mapError(error)
    }
  }

  return {
    createStorageKey,
    put,
    open: async (storageKey) => {
      const target = resolveKey(storageKey)
      try {
        await verifyKeyParent(storageKey, false)
        const pathMetadata = await lstat(target)
        if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝符号链接文件')
        const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const descriptorMetadata = await handle.stat()
          if (!descriptorMetadata.isFile() || descriptorMetadata.dev !== pathMetadata.dev || descriptorMetadata.ino !== pathMetadata.ino) {
            throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '文件打开期间发生变化')
          }
          return handle.createReadStream({ autoClose: true })
        } catch (error) {
          await handle.close().catch(() => undefined)
          throw error
        }
      } catch (error) {
        throw mapError(error)
      }
    },
    remove: async (storageKey) => {
      const target = resolveKey(storageKey)
      try {
        await verifyKeyParent(storageKey, false)
        const before = await lstat(target)
        if (before.isSymbolicLink() || !before.isFile()) throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝符号链接文件')
        const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const opened = await handle.stat()
          if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
            throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '文件删除期间发生变化')
          }
        } finally {
          await handle.close()
        }
        const after = await lstat(target)
        if (after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino) {
          throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '文件删除期间发生变化')
        }
        await unlink(target)
      } catch (error) {
        if (isMissing(error)) return
        throw mapError(error)
      }
    },
  }
}
