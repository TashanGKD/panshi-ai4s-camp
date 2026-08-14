import { createHash } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { ContentModuleKey, JsonObject } from '@panshi/contracts'
import { createApp } from '../src/app.js'
import {
  ContentValidationError,
  validateContentForPublication,
  type ContentValidationRepository,
} from '../src/modules/content/content.validators.js'
import {
  ContentConflictError,
  type ContentPublishingService,
} from '../src/modules/content/publish.service.js'

const basic = {
  title: '磐石 AI4S 实训营',
  dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
  venue: '中国科学院物理研究所',
  intro: ['正式简介'],
}

const repository = (
  published: Partial<Record<ContentModuleKey, JsonObject>> = {},
  missingPublicResources: readonly { id: string, key: string }[] = [],
): ContentValidationRepository => ({
  findPublishedPayload: async (key) => published[key] ?? null,
  findPublicResourcesMissingFiles: async () => missingPublicResources,
})

const fields = async (key: ContentModuleKey, payload: JsonObject, validationRepository = repository()) => {
  try {
    await validateContentForPublication(key, payload, validationRepository)
    return []
  } catch (error) {
    expect(error).toBeInstanceOf(ContentValidationError)
    return (error as ContentValidationError).details.fields
  }
}

describe('content publication validation', () => {
  it('does not infer registration relations from arbitrary Chinese labels', async () => {
    await expect(validateContentForPublication('importantDates', {
      items: [
        { label: '报名开始', value: '任意说明' },
        { label: '报名截止', value: '仍是显示文本' },
      ],
    }, repository())).resolves.toBeUndefined()
  })

  it('requires machine registration dates to be real and strictly ordered', async () => {
    const malformed = await fields('importantDates', {
      items: [{ label: '报名开放', value: '八月一日', machineKey: 'registrationOpen' }],
    })
    const reversed = await fields('importantDates', {
      items: [
        { label: '报名开放', value: '2026-08-20', machineKey: 'registrationOpen' },
        { label: '报名截止', value: '2026-08-20', machineKey: 'registrationDeadline' },
      ],
    })

    expect(malformed).toContainEqual(expect.objectContaining({ path: 'items.0.value', code: 'INVALID_MACHINE_DATE' }))
    expect(reversed).toContainEqual(expect.objectContaining({ path: 'items.1.value', code: 'INVALID_REGISTRATION_WINDOW' }))
  })

  it('validates machine camp dates against published basic dates only when present', async () => {
    const issues = await fields('importantDates', {
      items: [{ label: '实训开始', value: '2026-08-22', machineKey: 'campStart' }],
    }, repository({ basic }))
    expect(issues).toContainEqual(expect.objectContaining({ path: 'items.0.value', code: 'CAMP_DATE_MISMATCH' }))

    await expect(validateContentForPublication('importantDates', { items: [] }, repository({ basic }))).resolves.toBeUndefined()
  })

  it.each([
    [{ start: '9:00', end: '10:00' }, 'days.0.sessions.0.timeRange.start'],
    [{ start: '09:00', end: '09:00' }, 'days.0.sessions.0.timeRange.end'],
    [{ start: '18:00', end: '17:59' }, 'days.0.sessions.0.timeRange.end'],
  ])('rejects malformed or reversed schedule range %#', async (timeRange, path) => {
    const issues = await fields('schedule', {
      days: [{
        date: '2026-08-23', label: '第一天', theme: '主题',
        sessions: [{ title: '课程', timeRange }],
      }],
    })
    expect(issues).toContainEqual(expect.objectContaining({ path }))
  })

  it('requires new publications to pair legacy display time with a machine range', async () => {
    const issues = await fields('schedule', {
      days: [{
        date: '2026-08-23', label: '第一天', theme: '主题',
        sessions: [{ title: '课程', time: '上午九点' }],
      }],
    })
    expect(issues).toContainEqual(expect.objectContaining({ path: 'days.0.sessions.0.timeRange', code: 'TIME_RANGE_REQUIRED' }))
  })

  it('rejects duplicate speaker IDs, dangling references, and duplicate session references', async () => {
    const issues = await fields('schedule', {
      speakers: [{ id: 'speaker-a', name: '甲' }, { id: 'speaker-a', name: '乙' }],
      days: [{
        date: '2026-08-23', label: '第一天', theme: '主题',
        sessions: [{ title: '课程', speakerIds: ['missing', 'missing'] }],
      }],
    })
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'speakers.1.id', code: 'DUPLICATE_SPEAKER_ID' }),
      expect.objectContaining({ path: 'days.0.sessions.0.speakerIds.0', code: 'UNKNOWN_SPEAKER' }),
      expect.objectContaining({ path: 'days.0.sessions.0.speakerIds.1', code: 'DUPLICATE_SPEAKER_REFERENCE' }),
    ]))
  })

  it('requires speaker references instead of display-only instructors when a registry is declared', async () => {
    const issues = await fields('schedule', {
      speakers: [{ id: 'speaker-a', name: '甲' }],
      days: [{
        date: '2026-08-23', label: '第一天', theme: '主题',
        sessions: [{ title: '课程', instructors: ['甲'] }],
      }],
    })
    expect(issues).toContainEqual(expect.objectContaining({
      path: 'days.0.sessions.0.speakerIds', code: 'SPEAKER_REFERENCES_REQUIRED',
    }))
  })

  it('returns field paths for incomplete and unsafe contacts without exposing Zod internals', async () => {
    const incomplete = await fields('contacts', { items: [{ label: '', value: '张老师' }] })
    const unsafe = await fields('contacts', { items: [{ label: '联系', value: '张老师', href: 'javascript:alert(1)' }] })
    expect(incomplete).toContainEqual(expect.objectContaining({ path: 'items.0.label' }))
    expect(unsafe).toContainEqual(expect.objectContaining({ path: 'items.0.href' }))
    expect(JSON.stringify([...incomplete, ...unsafe])).not.toContain('ZodError')
  })

  it('checks real public resource records through the injected repository', async () => {
    const issues = await fields('features', { items: [] }, repository({}, [{ id: 'r1', key: 'guide' }]))
    expect(issues).toContainEqual(expect.objectContaining({ path: 'resources.guide.fileId', code: 'PUBLIC_RESOURCE_FILE_REQUIRED' }))
  })
})

const adminToken = 'a'.repeat(64)
const studentToken = 'b'.repeat(64)
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const origin = 'https://admin.example'

const publishingService = (): ContentPublishingService => ({
  getDraft: vi.fn(async (key: ContentModuleKey) => ({ apiVersion: 'v1' as const, data: { key, revision: 2, payload: basic, publishedVersion: 1 } })),
  saveDraft: vi.fn(async (key: ContentModuleKey) => ({ apiVersion: 'v1' as const, data: { key, revision: 3, payload: basic, publishedVersion: 1 } })),
  previewDraft: vi.fn(async (key: ContentModuleKey) => ({ apiVersion: 'v1' as const, data: { key, revision: 2, payload: basic } })),
  publish: vi.fn(async (key: ContentModuleKey) => ({ apiVersion: 'v1' as const, data: { key, revision: 2, version: 2 } })),
  getHistory: vi.fn(async (key: ContentModuleKey) => ({ apiVersion: 'v1' as const, data: { key, publishedVersion: 1, versions: [] } })),
  rollback: vi.fn(async (key: ContentModuleKey, version: number) => ({ apiVersion: 'v1' as const, data: { key, revision: 2, version: 3, sourceVersion: version } })),
})

const authenticatedApp = (service: ContentPublishingService = publishingService()) => {
  const admin = { id: 'admin-1', displayName: '管理员', phoneNormalized: '+8613800138000', passwordHash: 'unused', role: 'admin' as const, disabledAt: null }
  const student = { ...admin, id: 'student-1', role: 'user' as const }
  return createApp({
    checkDatabase: async () => undefined,
    contentPublishingService: service,
    identityRepository: {
      findUserByPhoneNormalized: async () => null,
      findSessionByTokenHash: async (tokenHash: string) => {
        const user = tokenHash === hashToken(adminToken) ? admin : tokenHash === hashToken(studentToken) ? student : null
        return user ? { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, createdAt: new Date(), user } : null
      },
      revokeSessionByTokenHash: async () => undefined,
    },
    authTransactionRepository: { rotateSessionAndAudit: async () => undefined },
    config: { allowedOrigins: [origin], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
  })
}

describe('administrator content routes', () => {
  it('returns 401 for missing sessions and 403 for authenticated non-admins', async () => {
    const app = authenticatedApp()
    const missing = await request(app).get('/api/v1/admin/content/basic/preview')
    const student = await request(app).get('/api/v1/admin/content/basic/preview').set('Cookie', `panshi_session=${studentToken}`)
    expect(missing.status).toBe(401)
    expect(missing.body.error.code).toBe('UNAUTHORIZED')
    expect(student.status).toBe(403)
    expect(student.body.error.code).toBe('FORBIDDEN')
    expect(JSON.stringify(missing.body)).not.toContain('正式简介')
  })

  it('returns protected draft preview through the admin cookie without a token URL', async () => {
    const response = await request(authenticatedApp())
      .get('/api/v1/admin/content/basic/preview')
      .set('Cookie', `panshi_session=${adminToken}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ key: 'basic', revision: 2, payload: basic })
  })

  it('maps stale revisions to 409 CONTENT_CONFLICT', async () => {
    const service = publishingService()
    vi.mocked(service.saveDraft).mockRejectedValue(new ContentConflictError())
    const response = await request(authenticatedApp(service))
      .put('/api/v1/admin/content/basic/draft')
      .set('Cookie', `panshi_session=${adminToken}`)
      .set('Origin', origin)
      .send({ expectedRevision: 1, payload: basic })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONTENT_CONFLICT')
  })

  it('returns stable field validation details without raw internal errors', async () => {
    const service = publishingService()
    vi.mocked(service.publish).mockRejectedValue(new ContentValidationError([
      { path: 'items.0.href', code: 'INVALID_FIELD', message: '字段格式不正确' },
    ]))
    const response = await request(authenticatedApp(service))
      .post('/api/v1/admin/content/contacts/publish')
      .set('Cookie', `panshi_session=${adminToken}`)
      .set('Origin', origin)
      .send({ expectedRevision: 2 })
    expect(response.status).toBe(422)
    expect(response.body.error.details.fields).toEqual([
      { path: 'items.0.href', code: 'INVALID_FIELD', message: '字段格式不正确' },
    ])
    expect(JSON.stringify(response.body)).not.toMatch(/Zod|stack|javascript:alert/u)
  })

  it.each([undefined, 'https://evil.example'])('keeps exact Origin protection for writes: %s', async (requestOrigin) => {
    let pending = request(authenticatedApp()).put('/api/v1/admin/content/basic/draft')
      .set('Cookie', `panshi_session=${adminToken}`)
      .send({ expectedRevision: 2, payload: basic })
    if (requestOrigin) pending = pending.set('Origin', requestOrigin)
    const response = await pending
    expect(response.status).toBe(403)
  })

  it('does not mount admin content routes without the real publishing dependency', async () => {
    const app = createApp({
      checkDatabase: async () => undefined,
      identityRepository: {
        findUserByPhoneNormalized: async () => null,
        findSessionByTokenHash: async () => null,
        revokeSessionByTokenHash: async () => undefined,
      },
      authTransactionRepository: { rotateSessionAndAudit: async () => undefined },
      config: { allowedOrigins: [origin], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
    })
    expect((await request(app).get('/api/v1/admin/content/basic/draft')).status).toBe(404)
  })
})
