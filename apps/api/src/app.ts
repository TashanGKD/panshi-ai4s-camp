import cookieParser from 'cookie-parser'
import express from 'express'
import type { RequestHandler } from 'express'
import { errorHandler, HttpError, notFound } from './middleware/error-handler.js'
import { requestId } from './middleware/request-id.js'
import { createHealthRouter, type DatabaseHealthCheck } from './modules/health/health.routes.js'
import { createContentRouter } from './modules/content/content.routes.js'
import { createContentService } from './modules/content/content.service.js'
import type { PublicContentRepository } from './modules/content/content.repository.js'
import { createAuthRouter } from './modules/identity/auth.routes.js'
import { createSessionService } from './modules/identity/session.service.js'
import type { AuthTransactionRepository, IdentityRepository } from './modules/identity/identity.repository.js'
import { createAdminContentRouter } from './modules/content/admin-content.routes.js'
import type { ContentPublishingService } from './modules/content/publish.service.js'

export type ApiRuntimeConfig = {
  allowedOrigins: readonly string[]
  healthcheckTimeoutMs: number
  jsonLimitBytes: number
  secureCookies?: boolean
  sessionTtlSeconds?: number
}

export type AppDependencies = {
  checkDatabase: DatabaseHealthCheck
  contentRepository?: PublicContentRepository
  identityRepository?: IdentityRepository
  authTransactionRepository?: AuthTransactionRepository
  contentPublishingService?: ContentPublishingService
  config: ApiRuntimeConfig
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

const createOriginGuard = (allowedOrigins: readonly string[]): RequestHandler => {
  const allowlist = new Set(allowedOrigins)

  return (request, response, next) => {
    const origin = request.get('Origin')
    const originAllowed = origin !== undefined && allowlist.has(origin)

    response.vary('Origin')
    if (originAllowed) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    if (request.method === 'OPTIONS') {
      if (originAllowed) {
        response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Request-Id')
      }
      response.sendStatus(204)
      return
    }

    if (!safeMethods.has(request.method)) {
      if (origin === undefined) {
        next(new HttpError(403, 'ORIGIN_REQUIRED', '请求来源不可验证'))
        return
      }
      if (!originAllowed) {
        next(new HttpError(403, 'ORIGIN_FORBIDDEN', '请求来源不被允许'))
        return
      }
    }

    next()
  }
}

export const createApp = ({
  checkDatabase,
  contentRepository,
  identityRepository,
  authTransactionRepository,
  contentPublishingService,
  config,
}: AppDependencies) => {
  const app = express()
  const sessionTtlSeconds = config.sessionTtlSeconds ?? 28_800

  app.use(requestId)
  app.use(express.json({ limit: config.jsonLimitBytes, strict: true }))
  app.use(cookieParser())
  app.use(createOriginGuard(config.allowedOrigins))
  app.use('/healthz', createHealthRouter(checkDatabase, config.healthcheckTimeoutMs))
  if (identityRepository && authTransactionRepository) {
    const sessions = createSessionService(identityRepository, authTransactionRepository, { sessionTtlSeconds })
    app.use('/api/v1', createAuthRouter(sessions, {
      secureCookies: config.secureCookies ?? false,
      sessionTtlSeconds,
    }))
    if (contentPublishingService) {
      app.use('/api/v1/admin/content', createAdminContentRouter(sessions, contentPublishingService))
    }
  }
  app.use('/api/v1/public', createContentRouter(createContentService(contentRepository ?? {
    findPublishedByKeys: async () => [],
  })))
  app.use(notFound)
  app.use(errorHandler)

  return app
}
