import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { getApiEnv } from './config/env.js'
import { createDatabaseClient } from './db/client.js'
import { createContentPublishingRepository, createContentRepository } from './modules/content/content.repository.js'
import { createContentPublishingService } from './modules/content/publish.service.js'
import { createIdentityRepository } from './modules/identity/identity.repository.js'
import { createAdminSummaryRepository } from './modules/admin-summary/admin-summary.repository.js'
import { createAdminSummaryService } from './modules/admin-summary/admin-summary.service.js'

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
  const contentPublishingService = createContentPublishingService(createContentPublishingRepository(database.db))
  const app = createApp({
    checkDatabase: database.checkHealth,
    contentRepository: createContentRepository(database.db),
    identityRepository,
    authTransactionRepository: identityRepository,
    contentPublishingService,
    adminSummaryService: createAdminSummaryService(createAdminSummaryRepository(database.db)),
    config: {
      allowedOrigins: env.CORS_ORIGINS,
      healthcheckTimeoutMs: env.HEALTHCHECK_TIMEOUT_MS,
      jsonLimitBytes: env.JSON_BODY_LIMIT_BYTES,
      secureCookies: env.SECURE_COOKIES,
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    },
  })

  return {
    lifecycle: createServerLifecycle({
      listen: () => app.listen(env.API_PORT),
      closeDatabase: database.close,
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
