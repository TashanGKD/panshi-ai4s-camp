import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { getApiEnv } from './config/env.js'
import { createDatabaseClient } from './db/client.js'

type ServerError = Error & { code?: string }

export type ManagedServer = {
  on: (event: 'error', listener: (error: unknown) => void) => ManagedServer
  once: (event: 'listening', listener: () => void) => ManagedServer
  off: (event: 'listening', listener: () => void) => ManagedServer
  close: (callback: (error?: ServerError) => void) => ManagedServer
}

type ServerLifecycleDependencies = {
  listen: () => ManagedServer
  closeDatabase: () => Promise<void>
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

export const createServerLifecycle = ({ listen, closeDatabase }: ServerLifecycleDependencies) => {
  let server: ManagedServer | undefined
  let listening = false
  let startSettled = false
  let rejectStart: ((error: Error) => void) | undefined
  let startPromise: Promise<void> | undefined
  let resourcesClosePromise: Promise<void> | undefined
  let shutdownPromise: Promise<void> | undefined

  const closeResources = () => {
    resourcesClosePromise ??= Promise.allSettled([
      closeServer(server),
      Promise.resolve().then(closeDatabase),
    ]).then((results) => {
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('Resource shutdown failed')
      }
    })
    return resourcesClosePromise
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
        if (!listening && !startSettled) {
          startSettled = true
          void closeResources().then(
            () => reject(new Error('API server failed to start')),
            () => reject(new Error('API server failed to start')),
          )
          return
        }
        void shutdown().catch(() => undefined)
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

  return { start, shutdown }
}

export const createConfiguredServerLifecycle = () => {
  const env = getApiEnv()
  const database = createDatabaseClient(env.DATABASE_URL)
  const app = createApp({
    checkDatabase: database.checkHealth,
    config: {
      allowedOrigins: env.CORS_ORIGINS,
      healthcheckTimeoutMs: env.HEALTHCHECK_TIMEOUT_MS,
      jsonLimitBytes: env.JSON_BODY_LIMIT_BYTES,
    },
  })

  return {
    lifecycle: createServerLifecycle({
      listen: () => app.listen(env.API_PORT),
      closeDatabase: database.close,
    }),
    port: env.API_PORT,
  }
}

export const runServer = async () => {
  let shutdownRequested = false

  try {
    const { lifecycle, port } = createConfiguredServerLifecycle()
    const handleSignal = () => {
      shutdownRequested = true
      void lifecycle.shutdown().catch(() => {
        console.error('API server failed to shut down cleanly')
        process.exitCode = 1
      })
    }

    process.once('SIGINT', handleSignal)
    process.once('SIGTERM', handleSignal)
    await lifecycle.start()
    console.log(`API listening on port ${port}`)
  } catch {
    if (!shutdownRequested) {
      console.error('API server failed to start')
      process.exitCode = 1
    }
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  void runServer()
}
