import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { auditLogs, files, fileStorageRecoveries, sessions, users } from '../src/db/schema.js'
import { createIdentityRepository } from '../src/modules/identity/identity.repository.js'
import { createFileRepository } from '../src/modules/files/file.repository.js'
import { createFileService } from '../src/modules/files/file.service.js'
import { createLocalFileStorage } from '../src/modules/files/local-file-storage.js'
import type { FileStorage } from '../src/modules/files/file-storage.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const parsed = testDatabaseUrl ? new URL(testDatabaseUrl) : undefined
if (!testDatabaseUrl || !parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const database = createDatabaseClient(testDatabaseUrl)
const origin = 'https://camp.example'
const studentId = '00000000-0000-4000-8000-000000000101'
const otherId = '00000000-0000-4000-8000-000000000102'
const adminId = '00000000-0000-4000-8000-000000000103'
const buildPdf = () => {
  const header = Buffer.from('%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n')
  const objects = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n'),
  ]
  const offsets: number[] = []
  let cursor = header.length
  for (const object of objects) {
    offsets.push(cursor)
    cursor += object.length
  }
  const xrefOffset = cursor
  return Buffer.concat([
    header,
    ...objects,
    Buffer.from(
      `xref\n0 3\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\n`
      + `trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  ])
}

const PDF = buildPdf()
let uploadRoot = ''

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
const cookie = (token: string) => `panshi_session=${token}`

describe('protected file PostgreSQL integration', () => {
  beforeAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
  })

  beforeEach(async () => {
    await database.pool.query('TRUNCATE file_storage_recoveries, files, audit_logs, sessions, users CASCADE')
    uploadRoot = await mkdtemp(join(tmpdir(), 'panshi-file-integration-'))
    await database.db.insert(users).values([
      { id: studentId, displayName: '学员一', phoneNormalized: '+8613800138101', passwordHash: 'unused', role: 'user' },
      { id: otherId, displayName: '学员二', phoneNormalized: '+8613800138102', passwordHash: 'unused', role: 'user' },
      { id: adminId, displayName: '管理员', phoneNormalized: '+8613800138103', passwordHash: 'unused', role: 'admin' },
    ])
    await database.db.insert(sessions).values([
      { tokenHash: tokenHash('student-token'), userId: studentId, expiresAt: new Date(Date.now() + 60_000) },
      { tokenHash: tokenHash('other-token'), userId: otherId, expiresAt: new Date(Date.now() + 60_000) },
      { tokenHash: tokenHash('admin-token'), userId: adminId, expiresAt: new Date(Date.now() + 60_000) },
    ])
  })

  afterEach(async () => {
    if (uploadRoot) await rm(uploadRoot, { recursive: true, force: true })
    uploadRoot = ''
  })

  afterAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await database.close()
  })

  const app = () => {
    const identity = createIdentityRepository(database.db)
    return createApp({
      checkDatabase: async () => undefined,
      identityRepository: identity,
      authTransactionRepository: identity,
      fileService: createFileService(
        createFileRepository(database.db),
        createLocalFileStorage({ root: uploadRoot, maxBytes: 1024 }),
      ),
      config: {
        allowedOrigins: [origin],
        healthcheckTimeoutMs: 2_000,
        jsonLimitBytes: 1_048_576,
        fileUploadMaxBytes: 1_024,
        fileUploadTempDirectory: join(uploadRoot, '.incoming'),
      },
    })
  }

  const upload = (token = 'student-token', name = '简历.pdf', type = 'application/pdf', body: Buffer<ArrayBufferLike> = PDF) => request(app())
    .post('/api/v1/files')
    .set('Origin', origin)
    .set('Cookie', cookie(token))
    .field('purpose', 'registration_attachment')
    .field('attachmentSlot', 'resume')
    .attach('file', body, { filename: name, contentType: type })

  it('migrates owner metadata, uploads two same-name files without collision, and audits metadata only', async () => {
    const first = await upload()
    const second = await upload()
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(first.body.data.file.id).not.toBe(second.body.data.file.id)
    const rows = await database.db.select().from(files)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ ownerUserId: studentId, uploadedBy: studentId, purpose: 'registration_attachment', visibility: 'owner_admin', attachmentSlot: 'resume' })
    expect(rows[0]!.storageKey).not.toContain('简历')
    expect(await database.db.select().from(fileStorageRecoveries)).toHaveLength(0)
    const logs = await database.db.select().from(auditLogs)
    expect(JSON.stringify(logs)).not.toContain('简历')
    expect(JSON.stringify(logs)).not.toContain(PDF.toString('base64'))
  })

  it('allows an active administrator to upload but rejects a disabled account with a live session', async () => {
    expect((await upload('admin-token')).status).toBe(201)
    await database.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, studentId))
    const disabled = await upload('student-token')
    expect(disabled.status).toBe(403)
    expect(disabled.body.error.code).toBe('ACCOUNT_DISABLED')
  })

  it('enforces anonymous, owner, other-user and administrator download boundaries with safe headers', async () => {
    const uploaded = await upload()
    const id = uploaded.body.data.file.id as string
    expect((await request(app()).get(`/api/v1/files/${id}/download`)).status).toBe(401)
    const other = await request(app()).get(`/api/v1/files/${id}/download`).set('Cookie', cookie('other-token'))
    expect(other.status).toBe(404)
    expect(other.body.error.code).toBe('FILE_NOT_AVAILABLE')
    const owner = await request(app()).get(`/api/v1/files/${id}/download`).set('Cookie', cookie('student-token'))
    expect(owner.status).toBe(200)
    expect(owner.headers['content-disposition']).toContain("filename*=UTF-8''")
    expect(owner.headers['x-content-type-options']).toBe('nosniff')
    const admin = await request(app()).get(`/api/v1/files/${id}/download`).set('Cookie', cookie('admin-token'))
    expect(admin.status).toBe(200)
    expect(admin.body).toEqual(owner.body)
  })

  it('invalidates hidden and deleted metadata immediately', async () => {
    const hiddenId = (await upload()).body.data.file.id as string
    expect((await request(app()).patch(`/api/v1/files/${hiddenId}/hide`).set('Origin', origin).set('Cookie', cookie('student-token'))).status).toBe(204)
    expect((await request(app()).get(`/api/v1/files/${hiddenId}/download`).set('Cookie', cookie('student-token'))).status).toBe(404)

    const deletedId = (await upload()).body.data.file.id as string
    expect((await request(app()).delete(`/api/v1/files/${deletedId}`).set('Origin', origin).set('Cookie', cookie('student-token'))).status).toBe(204)
    expect((await request(app()).get(`/api/v1/files/${deletedId}/download`).set('Cookie', cookie('admin-token'))).status).toBe(404)
    expect((await database.db.select().from(files).where(eq(files.id, deletedId)))[0]).toMatchObject({
      lifecycleState: 'deleted',
      deleteFailureCode: null,
      deletedAt: expect.any(Date),
    })
  })

  it('persists recoverable state for physical delete failure and permits the same delete to retry', async () => {
    const id = (await upload()).body.data.file.id as string
    const repository = createFileRepository(database.db)
    const local = createLocalFileStorage({ root: uploadRoot, maxBytes: 1_024 })
    let attempts = 0
    const storage: FileStorage = {
      ...local,
      remove: async (key) => {
        attempts += 1
        if (attempts === 1) throw new Error('simulated storage outage')
        await local.remove(key)
      },
    }
    const service = createFileService(repository, storage)
    const actor = { id: studentId, displayName: '学员一', phoneNormalized: '+8613800138101', passwordHash: 'unused', role: 'user' as const, disabledAt: null }

    await expect(service.remove(id, actor)).rejects.toMatchObject({ code: 'FILE_DELETE_FAILED', status: 503 })
    expect((await database.db.select().from(files).where(eq(files.id, id)))[0]).toMatchObject({
      lifecycleState: 'delete_failed', deleteFailureCode: 'FILE_STORAGE_DELETE_FAILED', deletedAt: null,
    })
    await expect(service.remove(id, actor)).resolves.toBeUndefined()
    expect((await database.db.select().from(files).where(eq(files.id, id)))[0]).toMatchObject({
      lifecycleState: 'deleted', deleteFailureCode: null, deletedAt: expect.any(Date),
    })
  })

  it('keeps a metadata-only recovery row when metadata finalization and physical cleanup both fail', async () => {
    const repository = createFileRepository(database.db)
    const key = 'aa/bb/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const failingRepository = {
      ...repository,
      finalizeUploadWithAudit: async () => { throw new Error('simulated metadata failure') },
    }
    const storage = {
      createStorageKey: () => key,
      put: async () => ({ storageKey: key, sha256: 'a'.repeat(64), size: PDF.length, mime: 'application/pdf' }),
      open: async () => Readable.from(PDF),
      remove: async () => { throw new Error('simulated cleanup failure') },
    } satisfies FileStorage
    const actor = { id: studentId, displayName: '学员一', phoneNormalized: '+8613800138101', passwordHash: 'unused', role: 'user' as const, disabledAt: null }

    await expect(createFileService(failingRepository, storage).upload({
      stream: Readable.from(PDF), originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length,
      purpose: 'registration_attachment', attachmentSlot: 'resume',
    }, actor)).rejects.toThrow('simulated metadata failure')
    expect(await database.db.select().from(fileStorageRecoveries)).toEqual([
      expect.objectContaining({ storageKey: key, actorUserId: studentId, state: 'delete_failed', failureCode: 'FILE_STORAGE_DELETE_FAILED' }),
    ])
    const logs = await database.db.select().from(auditLogs)
    expect(logs.at(-1)).toMatchObject({
      action: 'file.upload_cleanup_failed',
      metadata: { failureCode: 'FILE_STORAGE_DELETE_FAILED' },
    })
    expect(JSON.stringify(logs)).not.toContain('resume.pdf')
    expect(JSON.stringify(logs)).not.toContain(uploadRoot)
  })

  it('atomically refuses metadata finalization against a mismatched recovery key', async () => {
    const repository = createFileRepository(database.db)
    const recovery = await repository.beginUploadRecovery('aa/bb/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', studentId)
    await expect(repository.finalizeUploadWithAudit(recovery.id, {
      storageKey: 'cc/dd/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, sha256: 'a'.repeat(64),
      uploadedBy: studentId, ownerUserId: studentId, purpose: 'registration_attachment', visibility: 'owner_admin', attachmentSlot: 'resume',
    }, studentId)).rejects.toThrow('Matching file upload recovery row is missing')
    expect(await database.db.select().from(files)).toHaveLength(0)
    expect(await database.db.select().from(fileStorageRecoveries)).toEqual([
      expect.objectContaining({ id: recovery.id, state: 'pending' }),
    ])
  })

  it.each([
    ['伪装.pdf', 'application/pdf', Buffer.from('not a pdf'), 422, 'FILE_CONTENT_INVALID'],
    ['最小伪造.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n%%EOF\n'), 422, 'FILE_CONTENT_INVALID'],
    ['简历.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', PDF, 415, 'FILE_MIME_MISMATCH'],
    ['简历.pdf', 'application/pdf', Buffer.concat([PDF, Buffer.alloc(2048)]), 413, 'FILE_TOO_LARGE'],
  ])('rejects unsafe upload %s with a stable non-leaking code', async (name, type, body, status, code) => {
    const response = await upload('student-token', name as string, type as string, body as Buffer)
    expect(response.status).toBe(status)
    expect(response.body.error.code).toBe(code)
    expect(JSON.stringify(response.body)).not.toContain(uploadRoot)
  })

  it('rejects a raw multipart path-traversal filename before storing metadata', async () => {
    const boundary = 'panshi-file-boundary'
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nregistration_attachment\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../resume.pdf"\r\n`
      + 'Content-Type: application/pdf\r\n\r\n',
    )
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
    const response = await request(app()).post('/api/v1/files')
      .set('Origin', origin).set('Cookie', cookie('student-token'))
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(Buffer.concat([prefix, PDF, suffix]))
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('FILE_NAME_INVALID')
    expect(await database.db.select().from(files)).toHaveLength(0)
  })
})
