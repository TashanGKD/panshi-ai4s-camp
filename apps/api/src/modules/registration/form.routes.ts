import { PublicRegistrationFormResponseSchema, RegistrationFormPublishRequestSchema } from '@panshi/contracts'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { HttpError } from '../../middleware/error-handler.js'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser, type AuthenticatedLocals } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import {
  RegistrationFormConflictError,
  RegistrationFormNotFoundError,
  RegistrationFormValidationError,
  type RegistrationFormService,
} from './form.service.js'

const expectedRevisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() })

const handleFormError = (error: unknown): never => {
  if (error instanceof RegistrationFormConflictError) throw new HttpError(409, 'REGISTRATION_FORM_CONFLICT', '报名表已被其他管理员修改，请刷新后重试')
  if (error instanceof RegistrationFormValidationError) throw new HttpError(422, 'REGISTRATION_FORM_VALIDATION_FAILED', '报名表未通过校验', error.details)
  if (error instanceof RegistrationFormNotFoundError) throw new HttpError(404, 'REGISTRATION_FORM_NOT_FOUND', '报名表不存在')
  throw error
}

const publicVersionResponse = (record: Awaited<ReturnType<RegistrationFormService['getPublished']>>) => {
  if (!record) throw new HttpError(404, 'REGISTRATION_FORM_NOT_FOUND', '报名表尚未发布')
  return PublicRegistrationFormResponseSchema.parse({
    apiVersion: 'v1', data: { formVersionId: record.id, version: record.version, form: record.form },
  })
}

export const createRegistrationFormPublicRouter = (service: RegistrationFormService) => {
  const router = Router()
  router.get('/registration-form', async (_request, response) => {
    try { response.json(publicVersionResponse(await service.getPublished())) } catch (error) { handleFormError(error) }
  })
  router.get('/registration-forms/:id', async (request, response) => {
    if (!z.uuid().safeParse(request.params.id).success) throw new HttpError(404, 'REGISTRATION_FORM_NOT_FOUND', '报名表版本不存在')
    try { response.json(publicVersionResponse(await service.getVersion(request.params.id))) } catch (error) { handleFormError(error) }
  })
  return router
}

export const createAdminRegistrationFormRouter = (sessions: SessionService, service: RegistrationFormService) => {
  const router = Router()
  router.use(createRequireUser(sessions), requireAdmin)

  router.get('/draft', async (_request, response) => {
    try { response.json(await service.getDraft()) } catch (error) { handleFormError(error) }
  })

  router.put('/draft', async (request, response: Response<unknown, AuthenticatedLocals>) => {
    const input = expectedRevisionSchema.safeParse(request.body)
    if (!input.success || typeof request.body !== 'object' || request.body === null || !('form' in request.body)) {
      throw new HttpError(400, 'INVALID_REQUEST', '报名表草稿请求格式错误')
    }
    try {
      response.json(await service.saveDraft(
        (request.body as { form: unknown }).form, input.data.expectedRevision, response.locals.authenticatedUser.id,
      ))
    } catch (error) { handleFormError(error) }
  })

  router.get('/preview', async (_request, response) => {
    try { response.json(await service.preview()) } catch (error) { handleFormError(error) }
  })

  router.post('/publish', async (request, response: Response<unknown, AuthenticatedLocals>) => {
    const input = RegistrationFormPublishRequestSchema.safeParse(request.body)
    if (!input.success) throw new HttpError(400, 'INVALID_REQUEST', '报名表发布请求格式错误')
    try { response.json(await service.publish(input.data.expectedRevision, response.locals.authenticatedUser.id)) } catch (error) { handleFormError(error) }
  })

  router.get('/history', async (_request, response) => {
    try { response.json(await service.getHistory()) } catch (error) { handleFormError(error) }
  })

  return router
}
