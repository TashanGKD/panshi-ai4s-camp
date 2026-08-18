import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser } from '../../middleware/require-user.js'
import { HttpError } from '../../middleware/error-handler.js'
import type { SessionService } from './session.service.js'
import { AdminManagementError, type AdminManagementService } from './admin-management.service.js'
import type { ConfirmationService } from '../confirmations/confirmation.service.js'
import { executeConfirmedRequest } from '../confirmations/confirmed-request.js'

const CreateInput = z.object({ displayName: z.string().trim().min(1).max(100), phone: z.string().trim().min(1).max(30), password: z.string().min(1).max(128), currentPassword: z.string().min(1).max(128) }).strict()
const PasswordInput = z.object({ currentPassword: z.string().min(1).max(128) }).strict()
const ResetPasswordInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) }).strict()
const SelfInput = z.object({ currentPassword: z.string().min(1).max(128), displayName: z.string().trim().min(1).max(100) }).strict()
const StatusInput = z.object({ currentPassword: z.string().min(1).max(128), disabled: z.boolean() }).strict()
const Id = z.string().uuid()
const http = (error: unknown) => error instanceof AdminManagementError ? new HttpError(error.status, error.code, error.message) : error
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => { const result = schema.safeParse(value); if (!result.success) throw new HttpError(422, 'VALIDATION_FAILED', '请求字段无效'); return result.data }

export const createAdminUsersRouter = (sessions: SessionService, service: AdminManagementService) => {
  const router = Router(); router.use(createRequireUser(sessions, { unauthenticatedStatus: 403 }), requireAdmin)
  router.get('/', async (_request, response, next) => { try { response.json(await service.list(response.locals.authenticatedUser)) } catch (error) { next(http(error)) } })
  router.get('/students', async (request, response, next) => { try { response.json(await service.listStudents(typeof request.query.search === 'string' ? request.query.search : undefined)) } catch (error) { next(http(error)) } })
  router.patch('/me', async (request, response, next) => { try { response.json(await service.updateSelf(response.locals.authenticatedUser, parse(SelfInput, request.body))) } catch (error) { next(http(error)) } })
  router.post('/me/password', async (request, response, next) => { try { response.json(await service.changeOwnPassword(response.locals.authenticatedUser, parse(ResetPasswordInput, request.body))) } catch (error) { next(http(error)) } })
  router.post('/students/:id/status', async (request, response, next) => { try { response.json(await service.setStudentStatus(response.locals.authenticatedUser, parse(Id, request.params.id), parse(StatusInput, request.body))) } catch (error) { next(http(error)) } })
  router.post('/students/:id/force-password-reset', async (request, response, next) => { try { response.json(await service.forceStudentPasswordReset(response.locals.authenticatedUser, parse(Id, request.params.id), parse(PasswordInput, request.body))) } catch (error) { next(http(error)) } })
  router.post('/', async (request, response, next) => { try { response.status(201).json(await service.create(response.locals.authenticatedUser, parse(CreateInput, request.body))) } catch (error) { next(http(error)) } })
  router.post('/:id/disable', async (request, response, next) => { try { response.json(await service.disable(response.locals.authenticatedUser, parse(Id, request.params.id), parse(PasswordInput, request.body))) } catch (error) { next(http(error)) } })
  router.post('/:id/reset-password', async (request, response, next) => { try { response.json(await service.resetPassword(response.locals.authenticatedUser, parse(Id, request.params.id), parse(ResetPasswordInput, request.body))) } catch (error) { next(http(error)) } })
  return router
}

export const createMyAccountRouter = (sessions: SessionService, service: AdminManagementService, confirmations?: ConfirmationService) => {
  const router = Router(); router.use(createRequireUser(sessions))
  router.post('/password', async (request, response, next) => { try {
    if (!confirmations) response.json(await service.changeOwnPassword(response.locals.authenticatedUser, parse(ResetPasswordInput, request.body)))
    else response.json(await executeConfirmedRequest(confirmations, { userId: response.locals.authenticatedUser.id, role: response.locals.authenticatedUser.role, user: response.locals.authenticatedUser }, 'account.password_change', request))
  } catch (error) { next(http(error)) } })
  return router
}
