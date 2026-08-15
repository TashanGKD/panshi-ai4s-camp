import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabaseClient } from '../db/client.js'
import { seedInitialContent } from '../db/seeds/initial-content.js'
import { users } from '../db/schema.js'
import { hashPassword } from '../modules/identity/password.js'

const exactDatabaseUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))

const requireVisualControls = (databaseUrl: string | undefined, enabled: string | undefined) => {
  if (enabled !== '1' || databaseUrl !== exactDatabaseUrl) {
    throw new Error('Refusing visual fixture without VISUAL_E2E=1 and the exact dedicated test database')
  }
  return databaseUrl
}

const clearFixture = async (database: ReturnType<typeof createDatabaseClient>) => {
  await database.pool.query('truncate table audit_logs, resources, content_modules, content_versions, sessions, users cascade')
}

export const runVisualFixture = async (
  operation: 'seed' | 'cleanup',
  controls = { databaseUrl: process.env.DATABASE_URL, enabled: process.env.VISUAL_E2E },
) => {
  const databaseUrl = requireVisualControls(controls.databaseUrl, controls.enabled)
  const database = createDatabaseClient(databaseUrl)
  try {
    await clearFixture(database)
    if (operation === 'cleanup') {
      await Promise.all(['var/visual-e2e-uploads', 'var/visual-e2e-temp'].map((path) => rm(resolve(projectRoot, path), { recursive: true, force: true })))
    }
    if (operation === 'seed') {
      const [creator] = await database.db.insert(users).values({
        displayName: '视觉回归测试管理员',
        phoneNormalized: '+8613999999999',
        passwordHash: await hashPassword(randomBytes(32).toString('hex')),
        role: 'admin',
      }).returning({ id: users.id })
      if (!creator) throw new Error('Failed to create visual fixture owner')
      await seedInitialContent(database.db, creator.id)
    }
  } finally {
    await database.close()
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const operation = process.argv[2]
  if (operation !== 'seed' && operation !== 'cleanup') throw new Error('Expected seed or cleanup operation')
  void runVisualFixture(operation).catch(() => {
    console.error('Visual E2E fixture refused or failed')
    process.exitCode = 1
  })
}
