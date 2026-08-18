import { Router } from 'express'
import type { InstitutionDirectoryService } from './institution.service.js'

export const createInstitutionRouter = (service: Pick<InstitutionDirectoryService, 'getDirectory'>) => {
  const router = Router()

  router.get('/institutions', (_request, response) => {
    response.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
    response.json(service.getDirectory())
  })

  return router
}
