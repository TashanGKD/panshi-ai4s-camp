import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  createWriteStream,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { FILE_UPLOAD_HARD_MAX_BYTES, type FileStorage, type FileWriteMetadata, type StoredFile } from './file-storage.js'
import { FileValidationError, validateStoredFileContent } from './file-validation.js'

export class FileStorageError extends Error {
  readonly recoveryRequired: boolean

  constructor(readonly code: string, message: string, options: { recoveryRequired?: boolean } = {}) {
    super(message)
    this.name = 'FileStorageError'
    this.recoveryRequired = options.recoveryRequired ?? false
  }
}

const projectRoot = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)))
const storageKeyPattern = /^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const privateDirectoryMode = 0o700
const privateFileMode = 0o600
const storageMarkerName = '.panshi-storage-root'
const storageMarkerContent = 'panshi-ai4s-camp:file-storage:v1\n'
const storageMarkerSize = Buffer.byteLength(storageMarkerContent)

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

const invalidMarker = (): never => {
  throw new FileStorageError('FILE_STORAGE_MARKER_INVALID', '文件存储根目录标记无效')
}

const currentUid = (): number => {
  const uid = process.getuid?.()
  if (!Number.isInteger(uid)) unsafeRoot()
  return uid as number
}

const pathAncestors = (input: string) => {
  const ancestors: string[] = []
  let current = resolve(input)
  while (true) {
    ancestors.push(current)
    const parent = dirname(current)
    if (parent === current) return ancestors
    current = parent
  }
}

const broadRoots = new Set([
  ...pathAncestors(projectRoot),
  ...pathAncestors(resolve(projectRoot, '..')),
  ...pathAncestors(resolve(process.cwd())),
  resolve(homedir()),
  resolve(tmpdir()),
  '/', '/tmp', '/private/tmp', '/var', '/var/tmp', '/private/var/tmp', '/usr', '/usr/tmp',
  '/etc', '/System', '/Library', '/Applications', '/dev', '/dev/shm',
])

const isBroadRoot = (path: string): boolean => {
  if (broadRoots.has(path)) return true
  try {
    return broadRoots.has(realpathSync(path))
  } catch (error) {
    if (isMissing(error)) return false
    if (error instanceof FileStorageError) throw error
    return unsafeRoot()
  }
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
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || metadata.uid !== currentUid()
    || (metadata.mode & 0o777) !== privateDirectoryMode
  ) {
    throw new FileStorageError(code, '文件存储目录不安全')
  }
  return realpathSync(path)
}

const verifyStorageMarker = (root: string) => {
  const marker = resolve(root, storageMarkerName)
  if (!isInside(root, marker)) invalidMarker()
  try {
    const metadata = lstatSync(marker)
    if (
      metadata.isSymbolicLink()
      || !metadata.isFile()
      || metadata.uid !== currentUid()
      || (metadata.mode & 0o777) !== privateFileMode
      || metadata.size !== storageMarkerSize
      || realpathSync(marker) !== resolve(realpathSync(root), storageMarkerName)
      || readFileSync(marker, 'utf8') !== storageMarkerContent
    ) invalidMarker()
  } catch (error) {
    if (error instanceof FileStorageError) throw error
    invalidMarker()
  }
}

const assertSafeCreationParent = (path: string) => {
  assertNoSymlinkComponents(path)
  const metadata = lstatSync(path)
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || metadata.uid !== currentUid()
    || (metadata.mode & 0o022) !== 0
  ) unsafeRoot()
  return realpathSync(path)
}

const createStorageMarker = (root: string) => {
  const marker = resolve(root, storageMarkerName)
  let descriptor: number | undefined
  try {
    descriptor = openSync(
      marker,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      privateFileMode,
    )
    writeFileSync(descriptor, storageMarkerContent, 'utf8')
    fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

export const preparePrivateDirectory = (input: string, options: { rejectBroad?: boolean } = {}): string => {
  const path = resolve(input)
  if (options.rejectBroad && isBroadRoot(path)) unsafeRoot()
  assertNoSymlinkComponents(path)
  try {
    assertPrivateDirectorySync(path, 'FILE_STORAGE_ROOT_UNSAFE')
    verifyStorageMarker(path)
    return realpathSync(path)
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  const parent = dirname(path)
  const realParent = assertSafeCreationParent(parent)
  if (options.rejectBroad && isBroadRoot(realParent)) unsafeRoot()
  let created = false
  try {
    mkdirSync(path, { mode: privateDirectoryMode })
    created = true
    assertNoSymlinkComponents(path)
    if (assertPrivateDirectorySync(path, 'FILE_STORAGE_ROOT_UNSAFE') !== resolve(realParent, parse(path).base)) unsafeRoot()
    createStorageMarker(path)
    verifyStorageMarker(path)
    return realpathSync(path)
  } catch (error) {
    if (created) {
      try { unlinkSync(resolve(path, storageMarkerName)) } catch { /* best-effort rollback */ }
      try { rmdirSync(path) } catch { /* leave an unsafe partial root untouched */ }
    }
    if (error instanceof FileStorageError) throw error
    return unsafeRoot()
  }
}

const prepareInternalDirectory = (root: string, input: string) => {
  const path = resolve(input)
  if (!isInside(root, path)) unsafeRoot()
  try {
    const actual = assertPrivateDirectorySync(path, 'FILE_STORAGE_SYMLINK_REJECTED')
    if (!isInside(root, actual)) unsafeRoot()
    return actual
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const parent = dirname(path)
  const actualParent = assertPrivateDirectorySync(parent, 'FILE_STORAGE_SYMLINK_REJECTED')
  if (actualParent !== root && !isInside(root, actualParent)) unsafeRoot()
  mkdirSync(path, { mode: privateDirectoryMode })
  const actual = assertPrivateDirectorySync(path, 'FILE_STORAGE_SYMLINK_REJECTED')
  if (!isInside(root, actual)) unsafeRoot()
  return actual
}

const mapError = (error: unknown): FileStorageError => {
  if (error instanceof FileStorageError) return error
  if (error instanceof FileValidationError) return new FileStorageError(error.code, error.message)
  if (isMissing(error)) return new FileStorageError('FILE_NOT_FOUND', '文件不存在')
  if (isSymlinkError(error)) return new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝符号链接文件')
  return new FileStorageError('FILE_WRITE_INTERRUPTED', '文件写入中断')
}

export const createLocalFileStorage = ({ root, maxBytes }: { root: string, maxBytes: number }): FileStorage => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > FILE_UPLOAD_HARD_MAX_BYTES) throw new Error('Invalid file size limit')
  const resolvedRoot = preparePrivateDirectory(root, { rejectBroad: true })
  const temporaryRoot = prepareInternalDirectory(resolvedRoot, resolve(resolvedRoot, '.tmp'))
  if (!isInside(resolvedRoot, temporaryRoot)) unsafeRoot()

  const verifyRoot = () => {
    if (assertPrivateDirectorySync(resolvedRoot, 'FILE_STORAGE_ROOT_UNSAFE') !== resolvedRoot) unsafeRoot()
    verifyStorageMarker(resolvedRoot)
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
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || metadata.uid !== currentUid() || (metadata.mode & 0o777) !== privateDirectoryMode) {
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
      if (!metadata.isSymbolicLink() && metadata.isFile() && metadata.uid === currentUid()) await unlink(path)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }

  const safeUnlinkFinal = async (storageKey: string, path: string) => {
    try {
      await verifyKeyParent(storageKey, false)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || (metadata.isFile() && metadata.uid === currentUid())) {
        await unlink(path)
        return true
      }
    } catch {
      // Refuse to follow a changed parent; the recovery ledger and audit retain the anomaly for reconciliation.
    }
    return false
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
    let renamed = false
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
        if (
          !temporaryMetadata.isFile()
          || temporaryMetadata.uid !== currentUid()
          || (temporaryMetadata.mode & 0o777) !== privateFileMode
        ) {
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
      renamed = true
      await verifyKeyParent(storageKey, false)
      const finalMetadata = await lstat(target)
      if (finalMetadata.isSymbolicLink() || !finalMetadata.isFile() || finalMetadata.uid !== currentUid() || (finalMetadata.mode & 0o777) !== privateFileMode) {
        throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '最终文件不安全')
      }
      return { storageKey, sha256: hash.digest('hex'), size, mime: metadata.mime }
    } catch (error) {
      await safeUnlinkTemporary(temporary).catch(() => undefined)
      const targetCleanupFailed = renamed && !await safeUnlinkFinal(storageKey, target)
      const mapped = mapError(error)
      if (targetCleanupFailed) {
        throw new FileStorageError(mapped.code, mapped.message, { recoveryRequired: true })
      }
      throw mapped
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
        if (
          pathMetadata.isSymbolicLink()
          || !pathMetadata.isFile()
          || pathMetadata.uid !== currentUid()
          || (pathMetadata.mode & 0o777) !== privateFileMode
        ) throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝不安全文件')
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
        if (
          before.isSymbolicLink()
          || !before.isFile()
          || before.uid !== currentUid()
          || (before.mode & 0o777) !== privateFileMode
        ) throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝不安全文件')
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
