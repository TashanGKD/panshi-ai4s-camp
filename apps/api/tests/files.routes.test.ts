import { createServer, request as httpRequest } from 'node:http'
import { lstat, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, type ApiRuntimeConfig } from '../src/app.js'
import { FileServiceError, type FileService } from '../src/modules/files/file.service.js'
import { createUploadAdmissionGate } from '../src/modules/files/file.routes.js'
import { hashSessionToken } from '../src/modules/identity/session.service.js'

const origin = 'https://camp.example'
const users = new Map([
  ['one-token', { id: '00000000-0000-4000-8000-000000000201', displayName: '用户一', phoneNormalized: '+8613800138201', passwordHash: 'unused', role: 'user' as const, disabledAt: null }],
  ['two-token', { id: '00000000-0000-4000-8000-000000000202', displayName: '用户二', phoneNormalized: '+8613800138202', passwordHash: 'unused', role: 'user' as const, disabledAt: null }],
  ['three-token', { id: '00000000-0000-4000-8000-000000000203', displayName: '用户三', phoneNormalized: '+8613800138203', passwordHash: 'unused', role: 'user' as const, disabledAt: null }],
])
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n45\n%%EOF\n')

const identityRepository = {
  findUserByPhoneNormalized: async () => null,
  findSessionByTokenHash: async (hash: string) => {
    const entry = [...users.entries()].find(([token]) => hashSessionToken(token) === hash)?.[1]
    return entry ? { tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: entry } : null
  },
  revokeSessionByTokenHash: async () => undefined,
}

const responseFile = { id: '00000000-0000-4000-8000-000000000210', originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, purpose: 'registration_attachment' as const, attachmentSlot: 'resume' }

const makeService = (upload: FileService['upload']): FileService => ({
  upload: async (input, actor) => {
    const result = await upload(input, actor)
    if (!input.stream.destroyed) for await (const chunk of input.stream) void chunk
    return result
  },
  openForDownload: async () => { throw new Error('unused') },
  openPublishedResource: async () => { throw new Error('unused') },
  hide: async () => undefined,
  remove: async () => undefined,
})

const makeApp = (service: FileService, tempDirectory: string, limits: Partial<ApiRuntimeConfig> = {}) => createApp({
  checkDatabase: async () => undefined,
  identityRepository,
  authTransactionRepository: { rotateSessionAndAudit: async () => undefined },
  fileService: service,
  config: {
    allowedOrigins: [origin], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576,
    fileUploadMaxBytes: 1024,
    fileUploadTempDirectory: tempDirectory,
    fileUploadGlobalConcurrency: 2,
    fileUploadGlobalWindowMax: 10,
    fileUploadGlobalWindowMs: 60_000,
    fileUploadPerUserConcurrency: 1,
    fileUploadPerUserWindowMax: 2,
    fileUploadPerUserWindowMs: 60_000,
    ...limits,
  } as ApiRuntimeConfig,
})

const upload = (app: ReturnType<typeof makeApp>, token = 'one-token') => request(app).post('/api/v1/files')
  .set('Origin', origin).set('Cookie', `panshi_session=${token}`)
  .field('purpose', 'registration_attachment').field('attachmentSlot', 'resume')
  .attach('file', PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })

describe('file upload route resource boundaries', () => {
  const roots: string[] = []
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

  const temporaryRoot = async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-upload-route-'))
    roots.push(root)
    return join(root, 'incoming')
  }

  it('uses an application-private 0700 upload directory and wx 0600 temporary files', async () => {
    const temp = await temporaryRoot()
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const service = makeService(async ({ stream }) => {
      entered()
      await blocked
      for await (const chunk of stream) void chunk
      return responseFile
    })
    const app = makeApp(service, temp)
    const pending = upload(app).then((response) => response)
    await started
    expect((await lstat(temp)).mode & 0o777).toBe(0o700)
    const names = await readdir(temp)
    const uploads = names.filter((name) => name.endsWith('.upload'))
    expect(uploads).toHaveLength(1)
    const temporaryMetadata = await lstat(join(temp, uploads[0]!))
    expect(temporaryMetadata.mode & 0o777).toBe(0o600)
    expect(temporaryMetadata.uid).toBe(process.getuid?.())
    release()
    expect((await pending).status).toBe(201)
    expect((await readdir(temp)).filter((name) => name.endsWith('.upload'))).toEqual([])
  })

  it('rejects excessive multipart fields with a stable parser error', async () => {
    const temp = await temporaryRoot()
    const app = makeApp(makeService(async () => responseFile), temp)
    const response = await request(app).post('/api/v1/files')
      .set('Origin', origin).set('Cookie', 'panshi_session=one-token')
      .field('purpose', 'x'.repeat(2_000)).field('attachmentSlot', 'resume').field('extra', 'not-allowed')
      .attach('file', PDF, { filename: 'resume.pdf', contentType: 'application/pdf' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('FILE_MULTIPART_INVALID')
  })

  it('refuses an upload limit above the application hard maximum', async () => {
    const temp = await temporaryRoot()
    expect(() => makeApp(makeService(async () => responseFile), temp, { fileUploadMaxBytes: 5 * 1_024 * 1_024 + 1 }))
      .toThrow('Invalid file upload size limit')
  })

  it('rejects a temporary directory replaced by a symlink before upload', async () => {
    const temp = await temporaryRoot()
    const outside = await mkdtemp(join(tmpdir(), 'panshi-upload-route-outside-'))
    roots.push(outside)
    const app = makeApp(makeService(async () => responseFile), temp)
    await rm(temp, { recursive: true })
    await symlink(outside, temp, 'dir')
    const response = await upload(app)
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('FILE_MULTIPART_INVALID')
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects an obviously oversized Content-Length before multipart parsing or validation', async () => {
    const temp = await temporaryRoot()
    let calls = 0
    const app = makeApp(makeService(async () => {
      calls += 1
      return responseFile
    }), temp)
    const response = await request(app).post('/api/v1/files')
      .set('Origin', origin).set('Cookie', 'panshi_session=one-token')
      .set('Content-Type', 'multipart/form-data; boundary=oversized')
      .send(Buffer.alloc(1_024 + 65_536 + 1))
    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('FILE_TOO_LARGE')
    expect(calls).toBe(0)
  })

  it('limits concurrent uploads for one account before validation begins', async () => {
    const temp = await temporaryRoot()
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    const app = makeApp(makeService(async () => {
      calls += 1
      if (calls === 1) {
        entered()
        await blocked
      }
      return responseFile
    }), temp)
    const first = upload(app).then((response) => response)
    await started
    const second = await upload(app)
    expect(second.status).toBe(429)
    expect(second.body.error.code).toBe('FILE_UPLOAD_CONCURRENCY_LIMITED')
    expect(calls).toBe(1)
    release()
    expect((await first).status).toBe(201)
  })

  it('limits global concurrent uploads across accounts', async () => {
    const temp = await temporaryRoot()
    let release!: () => void
    let enteredCount = 0
    let signalEntered!: () => void
    const twoEntered = new Promise<void>((resolve) => { signalEntered = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const app = makeApp(makeService(async () => {
      enteredCount += 1
      if (enteredCount === 2) signalEntered()
      await blocked
      return responseFile
    }), temp)
    const first = upload(app, 'one-token').then((response) => response)
    const second = upload(app, 'two-token').then((response) => response)
    await twoEntered
    const third = await upload(app, 'three-token')
    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('FILE_UPLOAD_CONCURRENCY_LIMITED')
    expect(enteredCount).toBe(2)
    release()
    expect((await first).status).toBe(201)
    expect((await second).status).toBe(201)
  })

  it('rate-limits repeated uploads by account', async () => {
    const temp = await temporaryRoot()
    const app = makeApp(makeService(async () => responseFile), temp)
    const first = await upload(app)
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    const second = await upload(app)
    expect(second.status, JSON.stringify(second.body)).toBe(201)
    const limited = await upload(app)
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('FILE_UPLOAD_RATE_LIMITED')
  })

  it('rate-limits uploads globally across multiple accounts', async () => {
    const temp = await temporaryRoot()
    const app = makeApp(makeService(async () => responseFile), temp, {
      fileUploadGlobalWindowMax: 2,
      fileUploadPerUserWindowMax: 5,
    })
    expect((await upload(app, 'one-token')).status).toBe(201)
    expect((await upload(app, 'two-token')).status).toBe(201)
    const limited = await upload(app, 'three-token')
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('FILE_UPLOAD_GLOBAL_RATE_LIMITED')
  })

  it('evicts expired account windows and caps tracking capacity', () => {
    let now = 1_000
    const gate = createUploadAdmissionGate({
      globalConcurrency: 2, perUserConcurrency: 1,
      globalWindowMax: 10, globalWindowMs: 1_000,
      perUserWindowMax: 2, perUserWindowMs: 1_000,
      windowMapMaxEntries: 2, now: () => now,
    })
    gate.acquire('one')()
    gate.acquire('two')()
    expect(() => gate.acquire('three')).toThrowError(expect.objectContaining({ code: 'FILE_UPLOAD_RATE_LIMITED' }))
    now += 1_001
    expect(() => gate.acquire('three')()).not.toThrow()
  })

  it('releases concurrency after an exceptional upload path', async () => {
    const temp = await temporaryRoot()
    let calls = 0
    const app = makeApp(makeService(async () => {
      calls += 1
      if (calls === 1) throw new Error('simulated validation failure')
      return responseFile
    }), temp, { fileUploadGlobalConcurrency: 1 })
    expect((await upload(app, 'one-token')).status).toBe(500)
    expect((await upload(app, 'two-token')).status).toBe(201)
  })
})

describe('file download streaming', () => {
  it('does not send download headers when the secure open fails', async () => {
    const service = makeService(async () => responseFile)
    service.openForDownload = async () => {
      throw new FileServiceError(404, 'FILE_NOT_AVAILABLE', '文件不存在或不可访问')
    }
    const parent = await mkdtemp(join(tmpdir(), 'panshi-download-open-failure-'))
    const temp = join(parent, 'incoming')
    const response = await request(makeApp(service, temp))
      .get('/api/v1/files/00000000-0000-4000-8000-000000000210/download')
      .set('Cookie', 'panshi_session=one-token')
    await rm(parent, { recursive: true, force: true })
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('FILE_NOT_AVAILABLE')
    expect(response.headers).not.toHaveProperty('content-disposition')
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.headers['content-length']).not.toBe(String(PDF.length))
  })

  it('destroys the source stream when the client aborts', async () => {
    let destroyed = false
    let emitted = false
    const source = new Readable({
      read() {
        if (emitted) return
        emitted = true
        setImmediate(() => this.push(Buffer.alloc(1_024, 1)))
      },
      destroy(error, callback) {
        destroyed = true
        callback(error)
      },
    })
    const service = makeService(async () => responseFile)
    service.openForDownload = async () => ({
      record: { ...responseFile, sizeBytes: 1_000_000, storageKey: 'unused', sha256: 'a'.repeat(64), uploadedBy: users.get('one-token')!.id, ownerUserId: users.get('one-token')!.id, visibility: 'owner_admin', hiddenAt: null, deletedAt: null, lifecycleState: 'active', deleteFailureCode: null, createdAt: new Date() },
      stream: source,
    })
    const parent = await mkdtemp(join(tmpdir(), 'panshi-download-route-'))
    const temp = join(parent, 'incoming')
    const app = makeApp(service, temp)
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    await new Promise<void>((resolve) => {
      const client = httpRequest({ hostname: '127.0.0.1', port: address.port, path: `/${'api/v1/files/00000000-0000-4000-8000-000000000210/download'}`, headers: { Cookie: 'panshi_session=one-token' } })
      client.on('response', (response) => response.once('data', () => {
        client.destroy()
        resolve()
      }))
      client.end()
    })
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(parent, { recursive: true, force: true })
    expect(destroyed).toBe(true)
  })
})
