import { Router } from 'express'
import { HttpError } from '../../middleware/error-handler.js'

export type DatabaseHealthCheck = () => Promise<void>

const checkWithTimeout = async (checkDatabase: DatabaseHealthCheck, timeoutMs: number) => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const databaseCheck = Promise.resolve().then(checkDatabase)
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Health check timed out')), timeoutMs)
  })

  try {
    await Promise.race([databaseCheck, deadline])
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
  }
}

export const createHealthRouter = (checkDatabase: DatabaseHealthCheck, timeoutMs: number) => {
  const router = Router()

  router.get('/', async (_request, response) => {
    try {
      await checkWithTimeout(checkDatabase, timeoutMs)
    } catch {
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', '服务暂时不可用')
    }
    response.json({ status: 'ok', database: 'ok' })
  })

  return router
}
