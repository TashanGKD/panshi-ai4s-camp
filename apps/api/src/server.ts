import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { getApiEnv } from './config/env.js'
import { createDatabaseClient } from './db/client.js'
import { createContentPublishingRepository, createContentRepository } from './modules/content/content.repository.js'
import { createContentPublishingService } from './modules/content/publish.service.js'
import { createIdentityRepository } from './modules/identity/identity.repository.js'
import { createSessionService } from './modules/identity/session.service.js'
import { createAdminSummaryRepository } from './modules/admin-summary/admin-summary.repository.js'
import { createAdminSummaryService } from './modules/admin-summary/admin-summary.service.js'
import { createMockVerificationProvider } from './modules/identity/mock-verification-provider.js'
import { createAliyunVerificationProvider } from './modules/identity/aliyun-verification-provider.js'
import { createVerificationService } from './modules/identity/verification.service.js'
import { createRegistrationFormRepository } from './modules/registration/form.repository.js'
import { createRegistrationFormService } from './modules/registration/form.service.js'
import { createFileRepository } from './modules/files/file.repository.js'
import { createFileService } from './modules/files/file.service.js'
import { createLocalFileStorage } from './modules/files/local-file-storage.js'
import { createApplicationRepository } from './modules/registration/application.repository.js'
import { createApplicationService } from './modules/registration/application.service.js'
import { createReviewRepository } from './modules/registration/review.repository.js'
import { createReviewService } from './modules/registration/review.service.js'
import { createResourceRepository } from './modules/resources/resource.repository.js'
import { createResourceService } from './modules/resources/resource.service.js'
import { createStatisticsRepository } from './modules/statistics/statistics.repository.js'
import { createStatisticsService } from './modules/statistics/statistics.service.js'
import { createAdminManagementRepository } from './modules/identity/admin-management.repository.js'
import { createAdminManagementService } from './modules/identity/admin-management.service.js'
import { createAdminHealthFileChecks, createAdminHealthService } from './modules/health/admin-health.routes.js'
import { createInstitutionDirectoryService } from './modules/institutions/institution.service.js'
import { createCheckInRepository } from './modules/check-in/check-in.repository.js'
import { createCheckInService } from './modules/check-in/check-in.service.js'
import { createConfirmationRepository } from './modules/confirmations/confirmation.repository.js'
import { createConfirmationService } from './modules/confirmations/confirmation.service.js'
import { createLearnerConfirmationHandlers } from './modules/confirmations/confirmation-handlers.js'
import { createAliyunNotificationProvider } from './modules/sms/aliyun-notification-provider.js'
import { createSmsNotificationRepository } from './modules/sms/notification.repository.js'
import { createSmsNotificationWorker } from './modules/sms/notification.worker.js'

type ServerError = Error & { code?: string }
type RuntimeSignal = 'SIGINT' | 'SIGTERM'

export type ManagedServer = {
  on: (event: 'error', listener: (error: unknown) => void) => ManagedServer
  once: (event: 'listening', listener: () => void) => ManagedServer
  close: (callback: (error?: ServerError) => void) => ManagedServer
}

export type SignalSource = {
  on: (signal: RuntimeSignal, listener: () => void) => unknown
  off: (signal: RuntimeSignal, listener: () => void) => unknown
}

type ServerLifecycleDependencies = {
  listen: () => ManagedServer
  closeDatabase: () => Promise<void>
  onFatal?: () => void
}

type ShutdownLifecycle = {
  shutdown: () => Promise<void>
}

const isServerNotRunning = (error: unknown): boolean => (
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && error.code === 'ERR_SERVER_NOT_RUNNING'
)

const closeServer = (server: ManagedServer | undefined): Promise<void> => {
  if (!server) {
    return Promise.resolve()
  }

  return new Promise((resolveClose, rejectClose) => {
    try {
      server.close((error) => {
        if (!error || isServerNotRunning(error)) {
          resolveClose()
          return
        }
        rejectClose(error)
      })
    } catch (error) {
      if (isServerNotRunning(error)) {
        resolveClose()
        return
      }
      rejectClose(error)
    }
  })
}

export const createServerLifecycle = ({
  listen,
  closeDatabase,
  onFatal = () => undefined,
}: ServerLifecycleDependencies) => {
  let server: ManagedServer | undefined
  let listening = false
  let startSettled = false
  let fatalHandled = false
  let rejectStart: ((error: Error) => void) | undefined
  let startPromise: Promise<void> | undefined
  let resourcesClosePromise: Promise<void> | undefined
  let shutdownPromise: Promise<void> | undefined

  const closeResources = () => {
    resourcesClosePromise ??= (async () => {
      let failed = false

      try {
        await closeServer(server)
      } catch {
        failed = true
      }

      try {
        await closeDatabase()
      } catch {
        failed = true
      }

      if (failed) {
        throw new Error('Resource shutdown failed')
      }
    })()
    return resourcesClosePromise
  }

  const shutdown = () => {
    if (shutdownPromise) {
      return shutdownPromise
    }

    if (!startSettled && rejectStart) {
      startSettled = true
      rejectStart(new Error('API server stopped before listening'))
    }

    shutdownPromise = closeResources().catch(() => {
      throw new Error('API server shutdown failed')
    })
    return shutdownPromise
  }

  const handleFatalError = () => {
    if (fatalHandled || shutdownPromise) {
      return
    }
    fatalHandled = true
    void shutdown().then(
      () => onFatal(),
      () => onFatal(),
    )
  }

  const start = () => {
    if (startPromise) {
      return startPromise
    }

    startPromise = new Promise<void>((resolveStart, reject) => {
      rejectStart = reject

      const onListening = () => {
        listening = true
        startSettled = true
        resolveStart()
      }

      const onError = () => {
        if (!listening) {
          if (!startSettled) {
            startSettled = true
            void closeResources().then(
              () => reject(new Error('API server failed to start')),
              () => reject(new Error('API server failed to start')),
            )
          }
          return
        }
        handleFatalError()
      }

      try {
        server = listen()
        server.once('listening', onListening)
        server.on('error', onError)
      } catch {
        startSettled = true
        void closeResources().then(
          () => reject(new Error('API server failed to start')),
          () => reject(new Error('API server failed to start')),
        )
      }
    })

    return startPromise
  }

  return { start, shutdown }
}

export const installSignalHandlers = (
  signals: SignalSource,
  lifecycle: ShutdownLifecycle,
  onFailure: () => void,
) => {
  let shutdownRequested = false
  let signalShutdownPromise: Promise<void> | undefined

  const remove = () => {
    signals.off('SIGINT', handleSignal)
    signals.off('SIGTERM', handleSignal)
  }

  const handleSignal = () => {
    shutdownRequested = true
    if (signalShutdownPromise) {
      return
    }

    try {
      signalShutdownPromise = lifecycle.shutdown()
        .catch(() => onFailure())
        .finally(remove)
    } catch {
      onFailure()
      remove()
      signalShutdownPromise = Promise.resolve()
    }
  }

  signals.on('SIGINT', handleSignal)
  signals.on('SIGTERM', handleSignal)

  return {
    remove,
    shutdownRequested: () => shutdownRequested,
  }
}

export const createConfiguredServerLifecycle = (onFatal?: () => void) => {
  const env = getApiEnv()
  const database = createDatabaseClient(env.DATABASE_URL, env.HEALTHCHECK_TIMEOUT_MS)
  const identityRepository = createIdentityRepository(database.db)
  const verificationProvider = env.VERIFICATION_PROVIDER === 'mock'
    ? createMockVerificationProvider({
      ...(env.VERIFICATION_MOCK_CODE ? { code: env.VERIFICATION_MOCK_CODE } : {}),
      ...(env.NODE_ENV === 'development'
        ? { logger: ({ phone, code, purpose }) => console.info(`[verification:${purpose}] ${phone} ${code}`) }
        : {}),
    })
    : env.VERIFICATION_PROVIDER === 'aliyun'
      ? createAliyunVerificationProvider({
        accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID!,
        accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET!,
        signName: env.ALIYUN_SMS_SIGN_NAME!,
        templateCode: env.ALIYUN_SMS_TEMPLATE_CODE!,
        templateParamKey: env.ALIYUN_SMS_TEMPLATE_PARAM_KEY,
        endpoint: env.ALIYUN_SMS_ENDPOINT,
        regionId: env.ALIYUN_SMS_REGION_ID,
      })
      : undefined
  const verificationService = env.VERIFICATION_PROVIDER !== 'disabled'
    ? createVerificationService(identityRepository, verificationProvider, {
      secret: env.VERIFICATION_SECRET!,
      ttlSeconds: env.VERIFICATION_TTL_SECONDS,
      cooldownSeconds: env.VERIFICATION_COOLDOWN_SECONDS,
      maxAttempts: env.VERIFICATION_MAX_ATTEMPTS,
    })
    : undefined
  const smsNotificationWorker = env.SMS_NOTIFICATION_PROVIDER === 'aliyun'
    ? createSmsNotificationWorker(
      createSmsNotificationRepository(database.db),
      createAliyunNotificationProvider({
        accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID!,
        accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET!,
        signName: env.ALIYUN_NOTIFICATION_SMS_SIGN_NAME!,
        endpoint: env.ALIYUN_SMS_ENDPOINT,
        regionId: env.ALIYUN_SMS_REGION_ID,
        templateCodes: {
          application_submitted: env.ALIYUN_NOTIFICATION_SMS_TEMPLATE_SUBMITTED!,
          needs_supplement: env.ALIYUN_NOTIFICATION_SMS_TEMPLATE_SUPPLEMENT!,
          admitted: env.ALIYUN_NOTIFICATION_SMS_TEMPLATE_ADMITTED!,
          waitlisted: env.ALIYUN_NOTIFICATION_SMS_TEMPLATE_WAITLISTED!,
          rejected: env.ALIYUN_NOTIFICATION_SMS_TEMPLATE_REJECTED!,
        },
      }),
      {
        pollIntervalMs: env.SMS_NOTIFICATION_POLL_INTERVAL_MS,
        batchSize: env.SMS_NOTIFICATION_BATCH_SIZE,
        maxAttempts: env.SMS_NOTIFICATION_MAX_ATTEMPTS,
        retryDelayMs: env.SMS_NOTIFICATION_RETRY_DELAY_MS,
        staleLockMs: env.SMS_NOTIFICATION_STALE_LOCK_MS,
        onCycleError: () => console.error('SMS notification worker cycle failed'),
      },
    )
    : undefined
  const contentPublishingService = createContentPublishingService(createContentPublishingRepository(database.db))
  const adminHealthFileChecks = createAdminHealthFileChecks(env.FILE_STORAGE_ROOT, env.BACKUP_ROOT)
  const adminManagementService = createAdminManagementService(createAdminManagementRepository(database.db))
  const registrationFormService = createRegistrationFormService(createRegistrationFormRepository(database.db))
  const institutionDirectoryService = createInstitutionDirectoryService()
  const applicationService = createApplicationService(createApplicationRepository(database.db), {
    isUcasTrainingUnit: institutionDirectoryService.isUcasTrainingUnit,
  })
  const checkInService = createCheckInService(createCheckInRepository(database.db), { tokenSecret: env.CHECK_IN_TOKEN_SECRET })
  const fileService = createFileService(
    createFileRepository(database.db),
    createLocalFileStorage({ root: env.FILE_STORAGE_ROOT, maxBytes: env.FILE_UPLOAD_MAX_BYTES }),
  )
  const confirmationService = createConfirmationService(
    createConfirmationRepository(database.db),
    createLearnerConfirmationHandlers({
      sessions: createSessionService(identityRepository, identityRepository, { sessionTtlSeconds: env.SESSION_TTL_SECONDS }),
      verificationService,
      applicationService,
      fileService,
      accountService: adminManagementService,
    }),
  )
  const app = createApp({
    checkDatabase: database.checkHealth,
    contentRepository: createContentRepository(database.db),
    identityRepository,
    authTransactionRepository: identityRepository,
    studentIdentityRepository: identityRepository,
    verificationService,
    contentPublishingService,
    registrationFormService,
    institutionDirectoryService,
    applicationService,
    checkInService,
    confirmationService,
    reviewService: createReviewService(createReviewRepository(database.db)),
    fileService,
    resourceService: createResourceService(createResourceRepository(database.db), fileService),
    statisticsService: createStatisticsService(createStatisticsRepository(database.db)),
    adminSummaryService: createAdminSummaryService(createAdminSummaryRepository(database.db)),
    adminManagementService,
    auditQueryService: adminManagementService,
    adminHealthService: createAdminHealthService({
      checkDatabase: database.checkHealth,
      ...adminHealthFileChecks,
      timeoutMs: env.HEALTHCHECK_TIMEOUT_MS,
      appVersion: env.APP_VERSION,
    }),
    config: {
      allowedOrigins: env.CORS_ORIGINS,
      healthcheckTimeoutMs: env.HEALTHCHECK_TIMEOUT_MS,
      jsonLimitBytes: env.JSON_BODY_LIMIT_BYTES,
      secureCookies: env.SECURE_COOKIES,
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
      trustProxyHops: env.TRUST_PROXY_HOPS,
      rateLimitStoreMaxBuckets: env.RATE_LIMIT_STORE_MAX_BUCKETS,
      rateLimitStoreSweepIntervalMs: env.RATE_LIMIT_STORE_SWEEP_INTERVAL_MS,
      rateLimits: {
        login_failure: { max: env.RATE_LIMIT_LOGIN_FAILURE_MAX, windowMs: env.RATE_LIMIT_LOGIN_FAILURE_WINDOW_MS },
        auth_verification: { max: env.RATE_LIMIT_AUTH_MAX, windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS },
        public: { max: env.RATE_LIMIT_PUBLIC_MAX, windowMs: env.RATE_LIMIT_PUBLIC_WINDOW_MS },
        authenticated: { max: env.RATE_LIMIT_AUTHENTICATED_MAX, windowMs: env.RATE_LIMIT_AUTHENTICATED_WINDOW_MS },
        admin: { max: env.RATE_LIMIT_ADMIN_MAX, windowMs: env.RATE_LIMIT_ADMIN_WINDOW_MS },
      },
      fileUploadMaxBytes: env.FILE_UPLOAD_MAX_BYTES,
      fileUploadTempDirectory: env.FILE_UPLOAD_TEMP_ROOT,
      fileUploadGlobalConcurrency: env.FILE_UPLOAD_GLOBAL_CONCURRENCY,
      fileUploadGlobalWindowMax: env.FILE_UPLOAD_GLOBAL_WINDOW_MAX,
      fileUploadGlobalWindowMs: env.FILE_UPLOAD_GLOBAL_WINDOW_MS,
      fileUploadPerUserConcurrency: env.FILE_UPLOAD_PER_USER_CONCURRENCY,
      fileUploadPerUserWindowMax: env.FILE_UPLOAD_PER_USER_WINDOW_MAX,
      fileUploadPerUserWindowMs: env.FILE_UPLOAD_PER_USER_WINDOW_MS,
    },
  })

  return {
    lifecycle: createServerLifecycle({
      listen: () => {
        smsNotificationWorker?.start()
        return app.listen(env.API_PORT)
      },
      closeDatabase: async () => {
        await smsNotificationWorker?.stop()
        await database.close()
      },
      onFatal,
    }),
    port: env.API_PORT,
  }
}

export const runServer = async () => {
  let signalRegistration: ReturnType<typeof installSignalHandlers> | undefined

  const reportFatal = () => {
    signalRegistration?.remove()
    console.error('API server encountered a fatal runtime error')
    process.exitCode = 1
  }

  try {
    const { lifecycle, port } = createConfiguredServerLifecycle(reportFatal)
    signalRegistration = installSignalHandlers(process, lifecycle, () => {
      console.error('API server failed to shut down cleanly')
      process.exitCode = 1
    })
    await lifecycle.start()
    console.log(`API listening on port ${port}`)
  } catch {
    signalRegistration?.remove()
    if (!signalRegistration?.shutdownRequested()) {
      console.error('API server failed to start')
      process.exitCode = 1
    }
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  void runServer()
}
