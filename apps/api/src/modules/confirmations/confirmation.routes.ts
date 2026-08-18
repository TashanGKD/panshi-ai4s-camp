import { Router, type Request } from 'express'
import { ConfirmationPrepareResponseSchema } from '@panshi/contracts'
import { HttpError } from '../../middleware/error-handler.js'
import { getRequestSessionCredential } from '../../middleware/require-user.js'
import { AuthenticationError, type SessionService } from '../identity/session.service.js'
import { ConfirmationError, type ConfirmationActor, type ConfirmationService } from './confirmation.service.js'

const toHttpError = (error: unknown) => {
  if (error instanceof ConfirmationError) return new HttpError(error.status, error.code, error.message)
  if (error instanceof AuthenticationError) return new HttpError(401, 'UNAUTHORIZED', '未登录或会话已失效')
  return error
}

const resolveActor = async (sessions: SessionService, request: Request): Promise<ConfirmationActor> => {
  const credential = getRequestSessionCredential(request)
  if (!credential) return { userId: null, role: 'anonymous' }
  const user = await sessions.resolve(credential.token, credential.source === 'bearer' ? ['cli', 'admin_cli'] : ['web', 'admin_web'])
  return { userId: user.id, role: user.role, user, credential }
}

export const createConfirmationRouter = (sessions: SessionService, service: ConfirmationService) => {
  const router = Router()

  router.post('/confirmations/prepare', async (request, response, next) => {
    try {
      const actor = await resolveActor(sessions, request)
      const result = await service.prepare(actor, request.body)
      response.status(201).json(ConfirmationPrepareResponseSchema.parse({ apiVersion: 'v1', data: result }))
    } catch (error) { next(toHttpError(error)) }
  })

  router.post('/confirmations/:id/execute', async (request, response, next) => {
    try {
      const actor = await resolveActor(sessions, request)
      response.json({ apiVersion: 'v1', data: await service.execute(actor, request.params.id ?? '', request.body) })
    } catch (error) { next(toHttpError(error)) }
  })

  router.post('/confirmations/:id/upload', (_request, _response, next) => {
    next(new HttpError(409, 'STATE_NOT_ALLOWED', '文件确认执行尚未配置'))
  })

  return router
}
