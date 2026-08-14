import { Router } from 'express'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import type { AdminSummaryService } from './admin-summary.service.js'

export const createAdminSummaryRouter = (sessions: SessionService, service: AdminSummaryService) => {
  const router = Router()
  router.use(createRequireUser(sessions), requireAdmin)
  router.get('/', async (_request, response) => response.json(await service.getSummary()))
  return router
}
