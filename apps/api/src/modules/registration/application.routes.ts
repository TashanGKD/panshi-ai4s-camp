import { Router, type Response } from 'express'
import { HttpError } from '../../middleware/error-handler.js'
import { createRequireUser, type AuthenticatedLocals } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import { ApplicationError, type ApplicationService } from './application.service.js'

const toHttpError = (error: unknown) => {
  if (error instanceof ApplicationError) return new HttpError(error.status, error.code, error.message, error.fields ? { fields: error.fields } : undefined)
  if (error instanceof Error && error.message === 'APPLICATION_ATTACHMENT_INVALID') return new HttpError(422, 'APPLICATION_ATTACHMENT_INVALID', '附件不存在或不符合当前报名表要求')
  return error
}

export const createApplicationRouter = (sessions: SessionService, service: ApplicationService) => {
  const router = Router()
  router.use(createRequireUser(sessions))
  router.get('/', async (_request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try { response.json(await service.getMine(response.locals.authenticatedUser)) } catch (error) { next(toHttpError(error)) }
  })
  router.put('/draft', async (request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try { response.json(await service.saveDraft(response.locals.authenticatedUser, request.body)) } catch (error) { next(toHttpError(error)) }
  })
  router.post('/submit', async (request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try { response.status(201).json(await service.submit(response.locals.authenticatedUser, request.body)) } catch (error) { next(toHttpError(error)) }
  })
  return router
}
