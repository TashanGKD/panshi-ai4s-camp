import { Router } from 'express'
import { HttpError } from '../../middleware/error-handler.js'
import { ContentNotFoundError, type ContentService } from './content.service.js'
import { ContentModuleKeySchema } from './content.schemas.js'

const sendContentNotFound = (): HttpError => (
  new HttpError(404, 'CONTENT_NOT_FOUND', '已发布内容不存在')
)

export const createContentRouter = (service: ContentService) => {
  const router = Router()

  router.get('/site', async (_request, response) => {
    try {
      response.json(await service.getPublicSite())
    } catch (error) {
      if (error instanceof ContentNotFoundError) throw sendContentNotFound()
      throw error
    }
  })

  router.get('/schedule', async (_request, response) => {
    try {
      response.json(await service.getPublicSchedule())
    } catch (error) {
      if (error instanceof ContentNotFoundError) throw sendContentNotFound()
      throw error
    }
  })

  router.get('/content/:key', async (request, response) => {
    const parsedKey = ContentModuleKeySchema.safeParse(request.params.key)
    if (!parsedKey.success) throw new HttpError(404, 'CONTENT_NOT_FOUND', '已发布内容不存在')

    try {
      response.json(await service.getPublicModule(parsedKey.data))
    } catch (error) {
      if (error instanceof ContentNotFoundError) throw sendContentNotFound()
      throw error
    }
  })

  return router
}
