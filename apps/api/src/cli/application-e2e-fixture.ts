import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { type JsonObject } from '@panshi/contracts'
import { eq } from 'drizzle-orm'
import { createDatabaseClient } from '../db/client.js'
import { seedInitialContent } from '../db/seeds/initial-content.js'
import { contentModules, contentVersions, registrationFormDrafts, registrationFormVersions, users } from '../db/schema.js'
import { hashPassword } from '../modules/identity/password.js'
import { authoritativeRegistrationForm } from '../db/seeds/authoritative-registration-form.js'

const exactUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
const form = authoritativeRegistrationForm

const clear = async (database: ReturnType<typeof createDatabaseClient>) => {
  await database.pool.query('TRUNCATE application_files, application_status_history, application_versions, applications, files, file_storage_recoveries, user_profiles, registration_form_drafts, registration_form_versions, audit_logs, resources, content_modules, content_versions, sessions, verification_codes, users CASCADE')
}

export const runApplicationFixture = async (operation: 'seed' | 'cleanup') => {
  if (process.env.APPLICATION_E2E !== '1' || process.env.DATABASE_URL !== exactUrl) throw new Error('Application E2E fixture refused')
  const database = createDatabaseClient(process.env.DATABASE_URL)
  try {
    await clear(database)
    if (operation === 'cleanup') {
      const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
      await Promise.all(['var/e2e-uploads', 'var/e2e-temp'].map((path) => rm(resolve(projectRoot, path), { recursive: true, force: true })))
    }
    if (operation === 'seed') {
      const [admin] = await database.db.insert(users).values({ displayName: 'E2E管理员', phoneNormalized: '+8613999999999', passwordHash: await hashPassword(process.env.E2E_ADMIN_PASSWORD ?? randomBytes(32).toString('hex')), role: 'admin' }).returning({ id: users.id })
      await seedInitialContent(database.db, admin!.id)
      const [currentDates] = await database.db.select({ version: contentVersions.version }).from(contentModules).innerJoin(contentVersions, eq(contentVersions.id, contentModules.publishedVersionId)).where(eq(contentModules.key, 'importantDates'))
      const [dates] = await database.db.insert(contentVersions).values({ moduleKey: 'importantDates', version: (currentDates?.version ?? 0) + 1, payload: { items: [{ label: '报名开放', value: '2026-08-01', machineKey: 'registrationOpen' }, { label: '报名截止', value: '2026-08-31', machineKey: 'registrationDeadline' }, { label: '开营', value: '2026-08-23', machineKey: 'campStart' }, { label: '结营', value: '2026-08-27', machineKey: 'campEnd' }] }, createdBy: admin!.id }).returning({ id: contentVersions.id })
      await database.db.update(contentModules).set({ publishedVersionId: dates!.id }).where(eq(contentModules.key, 'importantDates'))
      const [published] = await database.db.insert(registrationFormVersions).values({ version: 1, schema: form as unknown as JsonObject, createdBy: admin!.id, publishedAt: new Date() }).returning({ id: registrationFormVersions.id })
      await database.db.insert(registrationFormDrafts).values({ id: '00000000-0000-4000-8000-000000000010', schema: form, baseVersionId: published!.id })
    }
  } finally { await database.close() }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const operation = process.argv[2]
  if (operation !== 'seed' && operation !== 'cleanup') throw new Error('Expected seed or cleanup')
  await runApplicationFixture(operation)
}
