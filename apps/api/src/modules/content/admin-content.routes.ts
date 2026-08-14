import {
  ContentModuleKeySchema,
  ContentPublishRequestSchema,
  ContentRollbackRequestSchema,
  ContentSaveDraftRequestSchema,
  type ContentModuleKey,
} from '@panshi/contracts'
import { Router, type Response } from 'express'
import { HttpError } from '../../middleware/error-handler.js'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser, type AuthenticatedLocals } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import { ContentValidationError } from './content.validators.js'
import { ContentConflictError, ContentRecordNotFoundError, type ContentPublishingService } from './publish.service.js'

const invalidRequest = () => new HttpError(400, 'INVALID_REQUEST', '内容请求格式错误')

const handleContentError = (error: unknown): never => {
  if (error instanceof ContentConflictError) throw new HttpError(409, 'CONTENT_CONFLICT', '内容已被其他管理员修改，请刷新后重试')
  if (error instanceof ContentValidationError) {
    throw new HttpError(422, 'CONTENT_VALIDATION_FAILED', '内容未通过发布校验', error.details)
  }
  if (error instanceof ContentRecordNotFoundError) throw new HttpError(404, 'CONTENT_NOT_FOUND', '内容不存在')
  throw error
}

export const createAdminContentRouter = (sessions: SessionService, service: ContentPublishingService) => {
  const router = Router()
  router.use(createRequireUser(sessions, { unauthenticatedStatus: 403 }), requireAdmin)
  router.param('key', (request, _response, next, key) => {
    const parsed = ContentModuleKeySchema.safeParse(key)
    if (!parsed.success) return next(new HttpError(404, 'CONTENT_NOT_FOUND', '内容不存在'))
    request.params.key = parsed.data
    next()
  })

  router.get('/:key/draft', async (request, response) => {
    try { response.json(await service.getDraft(request.params.key as ContentModuleKey)) } catch (error) { handleContentError(error) }
  })

  router.put('/:key/draft', async (request, response: Response<unknown, AuthenticatedLocals>) => {
    const input = ContentSaveDraftRequestSchema.safeParse(request.body)
    if (!input.success) throw invalidRequest()
    try {
      response.json(await service.saveDraft(
        request.params.key as ContentModuleKey, input.data.payload, input.data.expectedRevision,
        response.locals.authenticatedUser.id,
      ))
    } catch (error) { handleContentError(error) }
  })

  router.get('/:key/preview', async (request, response) => {
    try { response.json(await service.previewDraft(request.params.key as ContentModuleKey)) } catch (error) { handleContentError(error) }
  })

  router.post('/:key/publish', async (request, response: Response<unknown, AuthenticatedLocals>) => {
    const input = ContentPublishRequestSchema.safeParse(request.body)
    if (!input.success) throw invalidRequest()
    try {
      response.json(await service.publish(request.params.key as ContentModuleKey, input.data.expectedRevision, response.locals.authenticatedUser.id))
    } catch (error) { handleContentError(error) }
  })

  router.get('/:key/versions', async (request, response) => {
    try { response.json(await service.getHistory(request.params.key as ContentModuleKey)) } catch (error) { handleContentError(error) }
  })

  router.post('/:key/rollback', async (request, response: Response<unknown, AuthenticatedLocals>) => {
    const input = ContentRollbackRequestSchema.safeParse(request.body)
    if (!input.success) throw invalidRequest()
    try {
      response.json(await service.rollback(request.params.key as ContentModuleKey, input.data.version, response.locals.authenticatedUser.id))
    } catch (error) { handleContentError(error) }
  })

  return router
}
