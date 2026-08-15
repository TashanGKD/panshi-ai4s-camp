import { Router } from 'express'
import type { StatisticsService } from './statistics.service.js'

export const createStatisticsRouter = (service: StatisticsService) => {
  const router = Router()
  router.get('/applications', async (_request, response, next) => {
    try {
      const data = await service.readPublic()
      response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
      response.json({ apiVersion: 'v1', data })
    } catch (error) { next(error) }
  })
  return router
}
