import { normalizeMainlandChinaMobile } from '@panshi/contracts'
import { eq } from 'drizzle-orm'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabaseClient } from '../db/client.js'
import { contentModules, contentVersions, users } from '../db/schema.js'
import { hashPassword } from '../modules/identity/password.js'

const exactDatabaseUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'

type PublishingFixtureControls = {
  databaseUrl: string | undefined
  enabled: string | undefined
  phone: string | undefined
  password: string | undefined
}

const requireTestControls = (controls: PublishingFixtureControls) => {
  const { databaseUrl, enabled, phone, password } = controls
  if (enabled !== '1' || databaseUrl !== exactDatabaseUrl) {
    throw new Error('Refusing E2E fixture without explicit test controls and exact dedicated database')
  }
  if (!phone || !password) throw new Error('E2E_ADMIN_PHONE and E2E_ADMIN_PASSWORD are required')
  return { databaseUrl, phone: normalizeMainlandChinaMobile(phone), password }
}

const clearFixture = async (database: ReturnType<typeof createDatabaseClient>) => {
  const fixtureTables = ['audit_logs', 'resources', 'content_modules', 'content_versions', 'sessions', 'users'] as const
  const existing = await database.pool.query<{ tablename: string }>(`
    select tablename from pg_tables
    where schemaname = current_schema() and tablename = any($1::text[])
  `, [fixtureTables])
  if (existing.rows.length === 0) return
  const safeNames = existing.rows.map(({ tablename }) => `"${tablename}"`).join(', ')
  await database.pool.query(`truncate table ${safeNames} cascade`)
}

const seedFixture = async (database: ReturnType<typeof createDatabaseClient>, phone: string, password: string) => {
  await clearFixture(database)
  const [admin] = await database.db.insert(users).values({
    displayName: 'E2E 内容管理员', phoneNormalized: phone, passwordHash: await hashPassword(password), role: 'admin',
  }).returning({ id: users.id })
  if (!admin) throw new Error('Failed to create E2E administrator')

  const payloads = {
    basic: {
      title: 'E2E 初始标题',
      dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
      venue: 'E2E 测试地点', intro: ['E2E 初始正文'],
    },
    importantDates: { items: [] },
    contacts: { items: [] },
    display: { series: '磐石 E2E 实训营', footer: 'E2E 测试页脚' },
  } as const
  for (const [key, payload] of Object.entries(payloads)) {
    const [module] = await database.db.insert(contentModules).values({ key, draft: payload, draftRevision: 0 })
      .returning({ key: contentModules.key })
    if (!module) throw new Error('Failed to create E2E content module')
    const [version] = await database.db.insert(contentVersions).values({
      moduleKey: key, version: 1, payload, createdBy: admin.id,
    }).returning({ id: contentVersions.id })
    if (!version) throw new Error('Failed to create E2E content version')
    await database.db.update(contentModules).set({ publishedVersionId: version.id }).where(eq(contentModules.key, key))
  }
  for (const key of ['features', 'organizations', 'schedule', 'travel']) {
    await database.db.insert(contentModules).values({ key, draft: {}, draftRevision: 0 })
  }
}

export const runContentPublishingFixture = async (
  operation: 'seed' | 'cleanup',
  controls: PublishingFixtureControls = {
    databaseUrl: process.env.DATABASE_URL,
    enabled: process.env.PUBLISHING_E2E,
    phone: process.env.E2E_ADMIN_PHONE,
    password: process.env.E2E_ADMIN_PASSWORD,
  },
) => {
  const { databaseUrl, phone, password } = requireTestControls(controls)
  const database = createDatabaseClient(databaseUrl)
  try {
    if (operation === 'seed') await seedFixture(database, phone, password)
    else await clearFixture(database)
  } finally {
    await database.close()
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const operation = process.argv[2]
  if (operation !== 'seed' && operation !== 'cleanup') throw new Error('Expected seed or cleanup operation')
  void runContentPublishingFixture(operation).catch(() => {
    console.error('Content publishing E2E fixture refused or failed')
    process.exitCode = 1
  })
}
