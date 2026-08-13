import { Router } from 'express'

export type DatabaseHealthCheck = () => Promise<void>

export const createHealthRouter = (checkDatabase: DatabaseHealthCheck) => {
  const router = Router()

  router.get('/', async (_request, response) => {
    await checkDatabase()
    response.json({ status: 'ok', database: 'ok' })
  })

  return router
}
