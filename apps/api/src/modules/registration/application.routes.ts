import { Router, type Response } from 'express'
import { HttpError } from '../../middleware/error-handler.js'
import { createRequireUser, type AuthenticatedLocals } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import { ApplicationError, type ApplicationService } from './application.service.js'
import type { ConfirmationService } from '../confirmations/confirmation.service.js'
import { executeConfirmedRequest } from '../confirmations/confirmed-request.js'

const toHttpError = (error: unknown) => {
  if (error instanceof ApplicationError) return new HttpError(error.status, error.code, error.message, error.fields ? { fields: error.fields } : undefined)
  if (error instanceof Error && error.message === 'APPLICATION_ATTACHMENT_INVALID') return new HttpError(422, 'APPLICATION_ATTACHMENT_INVALID', '附件不存在或不符合当前报名表要求')
  return error
}

export const createApplicationRouter = (sessions: SessionService, service: ApplicationService, confirmations?: ConfirmationService) => {
  const router = Router()
  router.use(createRequireUser(sessions), (_request, response: Response<unknown, AuthenticatedLocals>, next) => {
    if (response.locals.authenticatedUser.role !== 'user') {
      next(new HttpError(403, 'FORBIDDEN', '仅学员账号可访问报名'))
      return
    }
    next()
  })
  router.get('/', async (_request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try { response.json(await service.getMine(response.locals.authenticatedUser)) } catch (error) { next(toHttpError(error)) }
  })
  router.put('/draft', async (request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try {
      if (!confirmations) response.json(await service.saveDraft(response.locals.authenticatedUser, request.body))
      else response.json(await executeConfirmedRequest(confirmations, { userId: response.locals.authenticatedUser.id, role: 'user', user: response.locals.authenticatedUser }, 'application.draft.save', request))
    } catch (error) { next(toHttpError(error)) }
  })
  router.post('/reopen', async (request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try {
      if (!confirmations) response.json(await service.reopen(response.locals.authenticatedUser, request.body))
      else response.json(await executeConfirmedRequest(confirmations, { userId: response.locals.authenticatedUser.id, role: 'user', user: response.locals.authenticatedUser }, 'application.reopen', request))
    } catch (error) { next(toHttpError(error)) }
  })
  router.post('/submit', async (request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try {
      const result = !confirmations
        ? await service.submit(response.locals.authenticatedUser, request.body)
        : await executeConfirmedRequest(confirmations, { userId: response.locals.authenticatedUser.id, role: 'user', user: response.locals.authenticatedUser }, 'application.submit', request)
      response.status(201).json(result)
    } catch (error) { next(toHttpError(error)) }
  })
  return router
}
