import { tmpdir } from 'node:os'
import { createReadStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { HttpError } from '../../middleware/error-handler.js'
import { createRequireUser, type AuthenticatedLocals } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import { buildContentDisposition, FileValidationError } from './file-validation.js'
import { FileStorageError } from './local-file-storage.js'
import { FileServiceError, type FileService } from './file.service.js'

const FileIdSchema = z.string().uuid()

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
  options: { maxBytes: number },
) => {
  const router = Router()
  const requireUser = createRequireUser(sessions)
  const upload = multer({
    dest: tmpdir(),
    preservePath: true,
    limits: { fileSize: options.maxBytes, files: 1, fields: 4, parts: 5 },
  }).single('file')

  const receiveUpload: RequestHandler = (request, response, next) => {
    upload(request, response, async (multerError) => {
      if (multerError) {
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
        const actor = (response.locals as AuthenticatedLocals).authenticatedUser
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
        if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
      }
    })
  }

  router.use(requireUser)
  router.post('/', receiveUpload)
  router.get('/:id/download', async (request, response, next) => {
    try {
      const actor = (response.locals as AuthenticatedLocals).authenticatedUser
      const { record, stream } = await service.openForDownload(parseId(request.params.id ?? ''), actor)
      response.setHeader('Content-Type', record.mimeType)
      response.setHeader('Content-Length', String(record.sizeBytes))
      response.setHeader('Content-Disposition', buildContentDisposition(record.originalName))
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Cache-Control', 'private, no-store')
      stream.on('error', next)
      stream.pipe(response)
    } catch (error) {
      next(toHttpError(error))
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
