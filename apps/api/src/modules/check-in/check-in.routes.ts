import { Router, type Response } from 'express'
import { HttpError } from '../../middleware/error-handler.js'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser, type AuthenticatedLocals } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import { CheckInError, type CheckInService } from './check-in.service.js'

const toHttpError = (error: unknown) => error instanceof CheckInError
  ? new HttpError(error.status, error.code, error.message, error.details as Record<string, unknown> | undefined)
  : error

export const createStudentCheckInRouter = (sessions: SessionService, service: CheckInService) => {
  const router = Router()
  router.use(createRequireUser(sessions))
  router.get('/', async (_request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try { response.json(await service.getStudentCredential(response.locals.authenticatedUser)) } catch (error) { next(toHttpError(error)) }
  })
  return router
}

export const createAdminCheckInRouter = (sessions: SessionService, service: CheckInService) => {
  const router = Router()
  router.use(createRequireUser(sessions, { unauthenticatedStatus: 403 }), requireAdmin)
  router.post('/lookup', async (request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try { response.json(await service.lookup(response.locals.authenticatedUser, request.body)) } catch (error) { next(toHttpError(error)) }
  })
  router.post('/:id/confirm', async (request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try { response.json(await service.confirm(response.locals.authenticatedUser, request.params.id!, request.body)) } catch (error) { next(toHttpError(error)) }
  })
  router.post('/:id/revoke', async (request, response: Response<unknown, AuthenticatedLocals>, next) => {
    try { response.json(await service.revoke(response.locals.authenticatedUser, request.params.id!, request.body)) } catch (error) { next(toHttpError(error)) }
  })
  return router
}
