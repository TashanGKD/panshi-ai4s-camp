import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ApiErrorSchema,
  ApplicationStatusSchema,
  ContentModuleKeySchema,
  LoginResponseSchema,
  PaginationMetaSchema,
  PublicContentPayloadSchemas,
  PublicScheduleResponseSchema,
  PublicSiteResponseSchema,
  RegistrationSnapshotSchema,
  ResourceAccessSchema,
  UserRoleSchema,
  serializeLoginResponse,
  type JsonObject,
} from './index.js'

const publicSiteResponse = {
  apiVersion: 'v1',
  data: {
    contentVersion: '2026-08-13',
    basic: {
      title: '磐石 AI4S 实训营',
      dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
      venue: '中国科学院物理研究所',
      intro: [],
    },
    importantDates: { items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }] },
    contacts: { items: [] },
    display: { series: '磐石科学智能实训营', footer: '磐石 AI4S 实训营' },
  },
}

const contractsPackageRoot = fileURLToPath(new URL('..', import.meta.url))

describe('contracts', () => {
  it('is consumable through native Node package exports', () => {
    expect(() => execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      "const contracts = await import('@panshi/contracts'); contracts.ApiErrorSchema.parse({ error: { code: 'SMOKE_TEST', message: 'package export is consumable', requestId: 'smoke-1' } })",
    ], {
      cwd: contractsPackageRoot,
      stdio: 'pipe',
    })).not.toThrow()
  })

  it('accepts every approved application state', () => {
    for (const value of ['draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected']) {
      expect(ApplicationStatusSchema.parse(value)).toBe(value)
    }
  })

  it.each(['pending', 'approved', 'cancelled'])('rejects unknown application status %s', (value) => {
    expect(ApplicationStatusSchema.safeParse(value).success).toBe(false)
  })

  it('requires stable machine-readable errors', () => {
    expect(ApiErrorSchema.parse({ error: { code: 'UNAUTHORIZED', message: '未登录', requestId: 'r1' } })).toBeTruthy()
  })

  it.each([
    { error: { code: '', message: '未登录', requestId: 'r1' } },
    { error: { code: 'UNAUTHORIZED', message: '', requestId: 'r1' } },
    { error: { code: 'UNAUTHORIZED', message: '未登录' } },
  ])('rejects malformed API errors', (value) => {
    expect(ApiErrorSchema.safeParse(value).success).toBe(false)
  })

  it('freezes identity and access values', () => {
    expect(UserRoleSchema.options).toEqual(['user', 'admin'])
    expect(ResourceAccessSchema.options).toEqual(['public', 'authenticated', 'admitted'])
  })

  it('freezes public content modules', () => {
    expect(ContentModuleKeySchema.options).toEqual([
      'basic',
      'features',
      'organizations',
      'importantDates',
      'schedule',
      'contacts',
      'travel',
      'display',
    ])
  })

  it('accepts the minimum renderable public site aggregation', () => {
    expect(PublicSiteResponseSchema.parse(publicSiteResponse)).toEqual(publicSiteResponse)
  })

  it('validates every fixed content module with a module-specific schema', () => {
    expect(Object.keys(PublicContentPayloadSchemas)).toEqual(ContentModuleKeySchema.options)
    expect(PublicContentPayloadSchemas.schedule.parse({
      days: [{ date: '2026-08-23', label: '第一天', theme: '科研智能体', sessions: [] }],
    })).toBeTruthy()
    expect(PublicContentPayloadSchemas.contacts.safeParse({ email: 'invented@example.com' }).success).toBe(false)
  })

  it('keeps schedule outside the site aggregation contract', () => {
    expect(PublicScheduleResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        contentVersion: 'schedule:1',
        schedule: { days: [] },
      },
    })).toBeTruthy()
    expect(PublicSiteResponseSchema.safeParse({
      ...publicSiteResponse,
      data: { ...publicSiteResponse.data, schedule: { days: [] } },
    }).success).toBe(false)
  })

  it.each([
    { ...publicSiteResponse, data: { ...publicSiteResponse.data, display: undefined } },
    { ...publicSiteResponse, data: { ...publicSiteResponse.data, basic: [] } },
    { ...publicSiteResponse, data: { ...publicSiteResponse.data, contacts: { count: 1n } } },
  ])('rejects malformed public site responses', (value) => {
    expect(PublicSiteResponseSchema.safeParse(value).success).toBe(false)
  })

  it('accepts a minimal login response', () => {
    expect(LoginResponseSchema.parse({
      apiVersion: 'v1',
      data: { user: { id: 'u1', role: 'user' } },
    })).toBeTruthy()
  })

  it.each([
    { apiVersion: 'v1', data: { user: { role: 'user' } } },
    { apiVersion: 'v1', data: { user: { id: 'u1', role: 'owner' } } },
    { apiVersion: 'v2', data: { user: { id: 'u1', role: 'user' } } },
  ])('rejects malformed login responses', (value) => {
    expect(LoginResponseSchema.safeParse(value).success).toBe(false)
  })

  it('strips credentials from serialized login responses', () => {
    const serialized = serializeLoginResponse({
      apiVersion: 'v1',
      token: 'top-secret',
      data: {
        sessionToken: 'session-secret',
        user: { id: 'u1', role: 'user', refreshToken: 'refresh-secret' },
      },
    })

    expect(serialized).toEqual({
      apiVersion: 'v1',
      data: { user: { id: 'u1', role: 'user' } },
    })
    expect(JSON.stringify(serialized)).not.toMatch(/top-secret|session-secret|refresh-secret/)
  })

  it('validates and deeply freezes registration snapshots', () => {
    const snapshot = RegistrationSnapshotSchema.parse({
      formVersion: '2026-08-13',
      submittedAt: '2026-08-13T12:00:00.000Z',
      answers: { profile: { name: '张三', fields: ['physics', { years: 2 }] } },
    })

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.answers)).toBe(true)
    expect(Object.isFrozen(snapshot.answers.profile)).toBe(true)
    if (typeof snapshot.answers.profile === 'object' && snapshot.answers.profile !== null && !Array.isArray(snapshot.answers.profile)) {
      expect(Object.isFrozen((snapshot.answers.profile as JsonObject).fields)).toBe(true)
    }
  })

  it.each([
    'not-a-date',
    '2026-08-13',
    '2026-08-13T12:00:00',
  ])('rejects invalid submitted timestamp %s', (submittedAt) => {
    expect(RegistrationSnapshotSchema.safeParse({
      formVersion: 'v1',
      submittedAt,
      answers: {},
    }).success).toBe(false)
  })

  it.each([
    undefined,
    () => 'secret',
    Symbol('answer'),
    1n,
    new Date(),
    new (class Answer { value = 'x' })(),
  ])('rejects non-JSON registration answer %#', (answer) => {
    expect(RegistrationSnapshotSchema.safeParse({
      formVersion: 'v1',
      submittedAt: '2026-08-13T12:00:00.000Z',
      answers: { answer },
    }).success).toBe(false)
  })

  it('validates pagination metadata', () => {
    expect(PaginationMetaSchema.parse({ page: 1, pageSize: 20, totalItems: 21, totalPages: 2 })).toBeTruthy()
  })
})
