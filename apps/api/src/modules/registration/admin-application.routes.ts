import { Router } from 'express'
import { requireAdmin } from '../../middleware/require-admin.js'
import { HttpError } from '../../middleware/error-handler.js'
import type { SessionService } from '../identity/session.service.js'
import { createRequireUser } from '../../middleware/require-user.js'
import { ReviewError, type ReviewService } from './review.service.js'

const http = (error: unknown) => error instanceof ReviewError ? new HttpError(error.status, error.code, error.message, error.details as Record<string, unknown> | undefined) : error
export const createAdminApplicationRouter = (sessions: SessionService, service: ReviewService) => {
  const router = Router(); router.use(createRequireUser(sessions, { unauthenticatedStatus: 403 }), requireAdmin)
  router.get('/', async (request, response, next) => { try { response.json(await service.list(response.locals.authenticatedUser, request.query)) } catch (error) { next(http(error)) } })
  router.get('/export.csv', async (request, response, next) => { try { const result = await service.exportCsv(response.locals.authenticatedUser, request.query); response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', 'attachment; filename="applications.csv"'); response.send(result.csv) } catch (error) { next(http(error)) } })
  router.post('/bulk-status', async (request, response, next) => { try { response.json(await service.bulkTransition(response.locals.authenticatedUser, request.body)) } catch (error) { next(http(error)) } })
  router.get('/:id', async (request, response, next) => { try { response.json(await service.detail(response.locals.authenticatedUser, request.params.id!)) } catch (error) { next(http(error)) } })
  router.post('/:id/status', async (request, response, next) => { try { response.json(await service.transition(response.locals.authenticatedUser, request.params.id!, request.body)) } catch (error) { next(http(error)) } })
  return router
}
