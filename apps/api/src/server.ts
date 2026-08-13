import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { getApiEnv } from './config/env.js'
import { createDatabaseClient } from './db/client.js'

export const startServer = () => {
  const env = getApiEnv()
  const database = createDatabaseClient(env.DATABASE_URL)
  const app = createApp({
    checkDatabase: database.checkHealth,
    config: {
      allowedOrigins: env.CORS_ORIGINS,
      jsonLimit: env.JSON_BODY_LIMIT,
    },
  })
  const server = app.listen(env.API_PORT, () => {
    console.log(`API listening on port ${env.API_PORT}`)
  })

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    server.close(async (serverError) => {
      let exitCode = serverError ? 1 : 0
      try {
        await database.close()
      } catch {
        console.error('Database pool failed to close cleanly')
        exitCode = 1
      }
      process.exit(exitCode)
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  return server
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  startServer()
}
