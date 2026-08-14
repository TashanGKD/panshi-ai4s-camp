import { randomBytes } from 'node:crypto'
import { normalizeMainlandChinaMobile } from '@panshi/contracts'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabaseClient } from '../db/client.js'
import { seedInitialContent } from '../db/seeds/initial-content.js'
import { users } from '../db/schema.js'
import { hashPassword } from '../modules/identity/password.js'

const exactDatabaseUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'

type Controls = {
  databaseUrl: string | undefined
  enabled: string | undefined
  resetPhone: string | undefined
  resetPassword: string | undefined
}

const requireControls = (controls: Controls) => {
  if (controls.enabled !== '1' || controls.databaseUrl !== exactDatabaseUrl) {
    throw new Error('Refusing student auth fixture without explicit test controls and exact dedicated database')
  }
  if (!controls.resetPhone || !controls.resetPassword) throw new Error('Reset account test credentials are required')
  return {
    databaseUrl: controls.databaseUrl,
    resetPhone: normalizeMainlandChinaMobile(controls.resetPhone),
    resetPassword: controls.resetPassword,
  }
}

const clearFixture = async (database: ReturnType<typeof createDatabaseClient>) => {
  const fixtureTables = [
    'audit_logs', 'resources', 'content_modules', 'content_versions', 'sessions', 'verification_codes', 'users',
  ] as const
  const existing = await database.pool.query<{ tablename: string }>(`
    select tablename from pg_tables
    where schemaname = current_schema() and tablename = any($1::text[])
  `, [fixtureTables])
  if (existing.rows.length === 0) return
  const safeNames = existing.rows.map(({ tablename }) => `"${tablename}"`).join(', ')
  await database.pool.query(`truncate table ${safeNames} cascade`)
}

export const runStudentAuthFixture = async (
  operation: 'seed' | 'cleanup',
  controls: Controls = {
    databaseUrl: process.env.DATABASE_URL,
    enabled: process.env.STUDENT_AUTH_E2E,
    resetPhone: process.env.E2E_RESET_PHONE,
    resetPassword: process.env.E2E_RESET_PASSWORD,
  },
) => {
  const safe = requireControls(controls)
  const database = createDatabaseClient(safe.databaseUrl)
  try {
    await clearFixture(database)
    if (operation === 'seed') {
      const [contentOwner] = await database.db.insert(users).values({
        displayName: 'E2E 内容维护账号', phoneNormalized: '+8613999999999',
        passwordHash: await hashPassword(randomBytes(32).toString('hex')), role: 'admin',
      }).returning({ id: users.id })
      if (!contentOwner) throw new Error('Failed to create E2E content owner')
      await seedInitialContent(database.db, contentOwner.id)
      await database.db.insert(users).values({
        displayName: 'E2E 重置学员', phoneNormalized: safe.resetPhone,
        passwordHash: await hashPassword(safe.resetPassword), role: 'user',
      })
    }
  } finally {
    await database.close()
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const operation = process.argv[2]
  if (operation !== 'seed' && operation !== 'cleanup') throw new Error('Expected seed or cleanup operation')
  void runStudentAuthFixture(operation).catch(() => {
    console.error('Student auth E2E fixture refused or failed')
    process.exitCode = 1
  })
}
