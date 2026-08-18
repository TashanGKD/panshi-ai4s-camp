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
import type { StudentIdentityRepository } from './modules/identity/identity.repository.js'
import type { VerificationService } from './modules/identity/verification.service.js'
import { createAdminContentRouter } from './modules/content/admin-content.routes.js'
import type { ContentPublishingService } from './modules/content/publish.service.js'
import { createAdminSummaryRouter } from './modules/admin-summary/admin-summary.routes.js'
import type { AdminSummaryService } from './modules/admin-summary/admin-summary.service.js'
import { createRegistrationFormPublicRouter, createAdminRegistrationFormRouter } from './modules/registration/form.routes.js'
import type { RegistrationFormService } from './modules/registration/form.service.js'
import { createFileRouter } from './modules/files/file.routes.js'
import type { FileService } from './modules/files/file.service.js'
import { createApplicationRouter } from './modules/registration/application.routes.js'
import type { ApplicationService } from './modules/registration/application.service.js'
import { createAdminApplicationRouter } from './modules/registration/admin-application.routes.js'
import type { ReviewService } from './modules/registration/review.service.js'
import { createAdminResourceRouter, createResourceRouter } from './modules/resources/resource.routes.js'
import type { ResourceService } from './modules/resources/resource.service.js'
import { createStatisticsRouter } from './modules/statistics/statistics.routes.js'
import type { StatisticsService } from './modules/statistics/statistics.service.js'
import { createAdminUsersRouter, createMyAccountRouter } from './modules/identity/admin-users.routes.js'
import { createAuditRouter } from './modules/audit/audit.routes.js'
import type { AdminManagementService } from './modules/identity/admin-management.service.js'
import { createAdminHealthRouter, type AdminHealthService } from './modules/health/admin-health.routes.js'
import { createInstitutionRouter } from './modules/institutions/institution.routes.js'
import type { InstitutionDirectoryService } from './modules/institutions/institution.service.js'
import { createAdminCheckInRouter, createStudentCheckInRouter } from './modules/check-in/check-in.routes.js'
import type { CheckInService } from './modules/check-in/check-in.service.js'
import { createRateLimiter, createRateLimitMiddleware, defaultRateLimits, InMemoryRateLimitStore, type RateLimiter, type RateLimitCategory, type RateLimitPolicy, type RateLimitStore } from './middleware/rate-limit.js'

export type ApiRuntimeConfig = {
  allowedOrigins: readonly string[]
  healthcheckTimeoutMs: number
  jsonLimitBytes: number
  secureCookies?: boolean
  sessionTtlSeconds?: number
  fileUploadMaxBytes?: number
  fileUploadTempDirectory?: string
  fileUploadGlobalConcurrency?: number
  fileUploadGlobalWindowMax?: number
  fileUploadGlobalWindowMs?: number
  fileUploadPerUserConcurrency?: number
  fileUploadPerUserWindowMax?: number
  fileUploadPerUserWindowMs?: number
  trustProxyHops?: number
  rateLimitStoreMaxBuckets?: number
  rateLimitStoreSweepIntervalMs?: number
  rateLimits?: Partial<Record<RateLimitCategory, RateLimitPolicy>>
}

export type AppDependencies = {
  checkDatabase: DatabaseHealthCheck
  contentRepository?: PublicContentRepository
  identityRepository?: IdentityRepository
  authTransactionRepository?: AuthTransactionRepository
  studentIdentityRepository?: StudentIdentityRepository
  verificationService?: VerificationService
  contentPublishingService?: ContentPublishingService
  adminSummaryService?: AdminSummaryService
  registrationFormService?: RegistrationFormService
  fileService?: FileService
  applicationService?: ApplicationService
  reviewService?: ReviewService
  resourceService?: ResourceService
  statisticsService?: StatisticsService
  adminManagementService?: AdminManagementService
  auditQueryService?: Pick<AdminManagementService, 'auditLogs' | 'auditLog'>
  adminHealthService?: AdminHealthService
  institutionDirectoryService?: Pick<InstitutionDirectoryService, 'getDirectory'>
  checkInService?: CheckInService
  rateLimitStore?: RateLimitStore
  rateLimitNow?: () => number
  config: ApiRuntimeConfig
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const privateNoStore: RequestHandler = (_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store')
  const setHeader = response.setHeader.bind(response)
  response.setHeader = ((name: string, value: unknown) => {
    if (name.toLowerCase() === 'etag') return response
    return setHeader(name, value as string)
  }) as typeof response.setHeader
  response.removeHeader('ETag')
  next()
}

const createOriginGuard = (allowedOrigins: readonly string[]): RequestHandler => {
  const allowlist = new Set(allowedOrigins)

  return (request, response, next) => {
    const origin = request.get('Origin')
    const originAllowed = origin !== undefined && allowlist.has(origin)

    response.vary('Origin')
    if (originAllowed) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Credentials', 'true')
      response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
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
      const bearerOnly = /^Bearer [a-f0-9]{64}$/u.test(request.get('Authorization') ?? '')
        && typeof request.cookies?.panshi_session !== 'string'
      const cliLoginWithoutBrowserState = request.path === '/api/v1/auth/cli/login'
        && request.get('Authorization') === undefined
        && typeof request.cookies?.panshi_session !== 'string'
      if (origin === undefined) {
        if (bearerOnly || cliLoginWithoutBrowserState) {
          next()
          return
        }
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
  studentIdentityRepository,
  verificationService,
  contentPublishingService,
  adminSummaryService,
  registrationFormService,
  fileService,
  applicationService,
  reviewService,
  resourceService,
  statisticsService,
  adminManagementService,
  auditQueryService,
  adminHealthService,
  institutionDirectoryService,
  checkInService,
  rateLimitStore,
  rateLimitNow,
  config,
}: AppDependencies) => {
  const app = express()
  const sessionTtlSeconds = config.sessionTtlSeconds ?? 28_800
  const limiterNow = rateLimitNow ?? Date.now
  const rateLimiter: RateLimiter = createRateLimiter({ store: rateLimitStore ?? new InMemoryRateLimitStore({ now: limiterNow, maxBuckets: config.rateLimitStoreMaxBuckets, sweepIntervalMs: config.rateLimitStoreSweepIntervalMs }), now: limiterNow })
  const rateLimits = { ...defaultRateLimits, ...config.rateLimits }

  app.set('trust proxy', config.trustProxyHops && config.trustProxyHops > 0 ? config.trustProxyHops : false)
  app.use(requestId)
  app.use(['/api/v1/me', '/api/v1/files', '/api/v1/auth', '/api/v1/admin'], privateNoStore)
  app.use(express.json({ limit: config.jsonLimitBytes, strict: true }))
  app.use(cookieParser())
  app.use(createRateLimitMiddleware(rateLimiter, rateLimits))
  app.use(createOriginGuard(config.allowedOrigins))
  app.use('/healthz', createHealthRouter(checkDatabase, config.healthcheckTimeoutMs))
  if (identityRepository && authTransactionRepository) {
    const sessions = createSessionService(identityRepository, authTransactionRepository, { sessionTtlSeconds })
    app.use('/api/v1', createAuthRouter(sessions, {
      secureCookies: config.secureCookies ?? false,
      sessionTtlSeconds,
      ...(studentIdentityRepository && verificationService ? { verificationService } : {}),
      rateLimiter,
      loginFailurePolicy: rateLimits.login_failure,
    }))
    if (contentPublishingService) {
      app.use('/api/v1/admin/content', createAdminContentRouter(sessions, contentPublishingService))
    }
    if (adminSummaryService) app.use('/api/v1/admin/summary', createAdminSummaryRouter(sessions, adminSummaryService))
    if (registrationFormService) app.use('/api/v1/admin/registration-form', createAdminRegistrationFormRouter(sessions, registrationFormService))
    if (applicationService) app.use('/api/v1/me/application', createApplicationRouter(sessions, applicationService))
    if (checkInService) app.use('/api/v1/me/check-in', createStudentCheckInRouter(sessions, checkInService))
    if (reviewService) app.use('/api/v1/admin/applications', createAdminApplicationRouter(sessions, reviewService))
    if (checkInService) app.use('/api/v1/admin/check-in', createAdminCheckInRouter(sessions, checkInService))
    if (fileService) {
      if (!config.fileUploadTempDirectory) throw new Error('File upload temporary directory is required')
      app.use('/api/v1/files', createFileRouter(sessions, fileService, {
        maxBytes: config.fileUploadMaxBytes ?? 5_242_880,
        temporaryDirectory: config.fileUploadTempDirectory,
        globalConcurrency: config.fileUploadGlobalConcurrency,
        globalWindowMax: config.fileUploadGlobalWindowMax,
        globalWindowMs: config.fileUploadGlobalWindowMs,
        perUserConcurrency: config.fileUploadPerUserConcurrency,
        perUserWindowMax: config.fileUploadPerUserWindowMax,
        perUserWindowMs: config.fileUploadPerUserWindowMs,
      }))
    }
    if (resourceService) app.use('/api/v1/resources', createResourceRouter(sessions, resourceService))
    if (resourceService) app.use('/api/v1/admin/resources', createAdminResourceRouter(sessions, resourceService))
    if (adminManagementService) app.use('/api/v1/admin/users', createAdminUsersRouter(sessions, adminManagementService))
    if (adminManagementService) app.use('/api/v1/me/account', createMyAccountRouter(sessions, adminManagementService))
    if (auditQueryService) app.use('/api/v1/admin/audit-logs', createAuditRouter(sessions, auditQueryService))
    if (adminHealthService) app.use('/api/v1/admin/system-health', createAdminHealthRouter(sessions, adminHealthService))
  }
  if (registrationFormService) app.use('/api/v1/public', createRegistrationFormPublicRouter(registrationFormService))
  if (institutionDirectoryService) app.use('/api/v1/public', createInstitutionRouter(institutionDirectoryService))
  app.use('/api/v1/public', createContentRouter(createContentService(contentRepository ?? {
    findPublishedByKeys: async () => [],
  })))
  if (statisticsService) app.use('/api/v1/public/statistics', createStatisticsRouter(statisticsService))
  app.use(notFound)
  app.use(errorHandler)

  return app
}
