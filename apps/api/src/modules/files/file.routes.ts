import { randomUUID } from 'node:crypto'
import { constants, createReadStream, createWriteStream, openSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { HttpError } from '../../middleware/error-handler.js'
import { createRequireUser, type AuthenticatedLocals } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import { buildContentDisposition, FileValidationError } from './file-validation.js'
import { FileStorageError, preparePrivateDirectory } from './local-file-storage.js'
import { FileServiceError, type FileService } from './file.service.js'

const FileIdSchema = z.string().uuid()
const HARD_UPLOAD_MAX_BYTES = 10 * 1_024 * 1_024
const MULTIPART_OVERHEAD_BYTES = 64 * 1_024

type UploadGateOptions = {
  globalConcurrency: number
  perUserConcurrency: number
  perUserWindowMax: number
  perUserWindowMs: number
  now?: () => number
}

const createUploadAdmissionGate = (options: UploadGateOptions) => {
  let globalActive = 0
  const activeByUser = new Map<string, number>()
  const windows = new Map<string, { startedAt: number, count: number }>()
  const now = options.now ?? Date.now

  return {
    acquire(userId: string) {
      const userActive = activeByUser.get(userId) ?? 0
      if (globalActive >= options.globalConcurrency || userActive >= options.perUserConcurrency) {
        throw new HttpError(429, 'FILE_UPLOAD_CONCURRENCY_LIMITED', '当前上传任务较多，请稍后重试')
      }
      const current = now()
      let window = windows.get(userId)
      if (!window || current - window.startedAt >= options.perUserWindowMs) {
        window = { startedAt: current, count: 0 }
        windows.set(userId, window)
      }
      if (window.count >= options.perUserWindowMax) {
        throw new HttpError(429, 'FILE_UPLOAD_RATE_LIMITED', '上传过于频繁，请稍后重试')
      }
      window.count += 1
      globalActive += 1
      activeByUser.set(userId, userActive + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        globalActive -= 1
        const remaining = (activeByUser.get(userId) ?? 1) - 1
        if (remaining === 0) activeByUser.delete(userId)
        else activeByUser.set(userId, remaining)
      }
    },
  }
}

const createPrivateMulterStorage = (temporaryDirectory: string): multer.StorageEngine => {
  const destination = preparePrivateDirectory(temporaryDirectory, { rejectBroad: true })
  return {
    _handleFile(_request, file, callback) {
      try {
        if (preparePrivateDirectory(destination, { rejectBroad: true }) !== destination) {
          throw new FileStorageError('FILE_STORAGE_ROOT_UNSAFE', '上传临时目录不安全')
        }
      } catch (error) {
        callback(error as Error)
        return
      }
      const filename = `${randomUUID()}.upload`
      const path = `${destination}/${filename}`
      let descriptor: number
      try {
        descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      } catch (error) {
        callback(error as Error)
        return
      }
      let size = 0
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length
          done(null, chunk)
        },
      })
      void pipeline(file.stream, counter, createWriteStream(path, { fd: descriptor, autoClose: true }))
        .then(() => callback(null, { destination, filename, path, size }))
        .catch(async (error) => {
          await unlink(path).catch(() => undefined)
          callback(error as Error)
        })
    },
    _removeFile(_request, file, callback) {
      const path = 'path' in file && typeof file.path === 'string' ? file.path : undefined
      if (!path) {
        callback(null)
        return
      }
      void unlink(path).then(() => callback(null), (error) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') callback(null)
        else callback(error as Error)
      })
    },
  }
}

const toHttpError = (error: unknown): HttpError | unknown => {
  if (error instanceof FileServiceError) return new HttpError(error.status, error.code, error.message)
  if (error instanceof FileValidationError) {
    const status = error.code === 'FILE_EXTENSION_NOT_ALLOWED' ? 415 : 400
    return new HttpError(status, error.code, error.message)
  }
  if (error instanceof FileStorageError) {
    const status = error.code === 'FILE_TOO_LARGE'
      ? 413
      : error.code === 'FILE_MIME_NOT_ALLOWED'
        ? 415
        : error.code === 'FILE_CONTENT_INVALID'
          ? 422
          : 400
    return new HttpError(status, error.code, error.message)
  }
  return error
}

const parseId = (value: string) => {
  const result = FileIdSchema.safeParse(value)
  if (!result.success) throw new HttpError(400, 'FILE_ID_INVALID', '文件标识无效')
  return result.data
}

export const createFileRouter = (
  sessions: SessionService,
  service: FileService,
  options: {
    maxBytes: number
    temporaryDirectory: string
    globalConcurrency?: number
    perUserConcurrency?: number
    perUserWindowMax?: number
    perUserWindowMs?: number
  },
) => {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1_024 || options.maxBytes > HARD_UPLOAD_MAX_BYTES) {
    throw new Error('Invalid file upload size limit')
  }
  const router = Router()
  const requireUser = createRequireUser(sessions)
  const gate = createUploadAdmissionGate({
    globalConcurrency: options.globalConcurrency ?? 4,
    perUserConcurrency: options.perUserConcurrency ?? 1,
    perUserWindowMax: options.perUserWindowMax ?? 5,
    perUserWindowMs: options.perUserWindowMs ?? 60_000,
  })
  const upload = multer({
    storage: createPrivateMulterStorage(options.temporaryDirectory),
    preservePath: true,
    limits: {
      fileSize: options.maxBytes,
      fieldSize: 1_024,
      fieldNameSize: 64,
      files: 1,
      fields: 2,
      parts: 4,
    },
  }).single('file')

  const receiveUpload: RequestHandler = (request, response, next) => {
    const declaredLength = Number(request.get('Content-Length'))
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes + MULTIPART_OVERHEAD_BYTES) {
      next(new HttpError(413, 'FILE_TOO_LARGE', '文件超过大小限制'))
      return
    }
    const actor = (response.locals as AuthenticatedLocals).authenticatedUser
    let release: (() => void) | undefined
    try {
      release = gate.acquire(actor.id)
    } catch (error) {
      next(error)
      return
    }
    upload(request, response, async (multerError) => {
      if (multerError) {
        release?.()
        if (request.file?.path) await unlink(request.file.path).catch(() => undefined)
        if (multerError instanceof multer.MulterError && multerError.code === 'LIMIT_FILE_SIZE') {
          next(new HttpError(413, 'FILE_TOO_LARGE', '文件超过大小限制'))
          return
        }
        next(new HttpError(400, 'FILE_MULTIPART_INVALID', '附件上传请求无效'))
        return
      }
      const temporaryPath = request.file?.path
      try {
        if (!request.file) throw new HttpError(400, 'FILE_REQUIRED', '请选择要上传的文件')
        const purpose = typeof request.body.purpose === 'string' ? request.body.purpose : ''
        const attachmentSlot = typeof request.body.attachmentSlot === 'string' && request.body.attachmentSlot !== ''
          ? request.body.attachmentSlot
          : undefined
        const file = await service.upload({
          stream: createReadStream(request.file.path),
          originalName: request.file.originalname,
          mimeType: request.file.mimetype,
          sizeBytes: request.file.size,
          purpose,
          ...(attachmentSlot ? { attachmentSlot } : {}),
        }, actor)
        response.status(201).json({ apiVersion: 'v1', data: { file } })
      } catch (error) {
        next(toHttpError(error))
      } finally {
        release?.()
        if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
      }
    })
  }

  router.use(requireUser)
  router.post('/', receiveUpload)
  router.get('/:id/download', async (request, response, next) => {
    let stream: Awaited<ReturnType<FileService['openForDownload']>>['stream'] | undefined
    const abort = () => stream?.destroy(new Error('Download client disconnected'))
    try {
      const actor = (response.locals as AuthenticatedLocals).authenticatedUser
      const opened = await service.openForDownload(parseId(request.params.id ?? ''), actor)
      stream = opened.stream
      response.setHeader('Content-Type', opened.record.mimeType)
      response.setHeader('Content-Length', String(opened.record.sizeBytes))
      response.setHeader('Content-Disposition', buildContentDisposition(opened.record.originalName))
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Cache-Control', 'private, no-store')
      request.once('aborted', abort)
      response.once('close', abort)
      await pipeline(stream, response)
    } catch (error) {
      if (request.aborted || response.destroyed) return
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined)
        return
      }
      next(toHttpError(error))
    } finally {
      request.off('aborted', abort)
      response.off('close', abort)
      stream?.destroy()
    }
  })
  router.patch('/:id/hide', async (request, response, next) => {
    try {
      await service.hide(parseId(request.params.id ?? ''), (response.locals as AuthenticatedLocals).authenticatedUser)
      response.sendStatus(204)
    } catch (error) {
      next(toHttpError(error))
    }
  })
  router.delete('/:id', async (request, response, next) => {
    try {
      await service.remove(parseId(request.params.id ?? ''), (response.locals as AuthenticatedLocals).authenticatedUser)
      response.sendStatus(204)
    } catch (error) {
      next(toHttpError(error))
    }
  })
  return router
}
