import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ApiErrorSchema,
  AdminLoginRequestSchema,
  PasswordResetRequestSchema,
  SendVerificationCodeRequestSchema,
  StudentLoginRequestSchema,
  StudentRegistrationRequestSchema,
  ApplicationStatusSchema,
  ContentModuleKeySchema,
  LoginResponseSchema,
  ProfileResponseSchema,
  RegistrationResponseSchema,
  PaginationMetaSchema,
  PublicContentPayloadSchemas,
  PublicContentModuleResponseSchema,
  PublicScheduleResponseSchema,
  PublicSiteResponseSchema,
  RegistrationSnapshotSchema,
  ResourceAccessSchema,
  UserRoleSchema,
  serializeLoginResponse,
  serializeRegistrationResponse,
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
    features: { items: [] },
    organizations: { items: [] },
    homeSectionOrder: ['intro', 'target', 'scale', 'features', 'scheduleOverview', 'organizations', 'registrationCta', 'registrationCount'],
    visibleNavigation: ['home', 'schedule', 'register', 'travel', 'contacts', 'resources', 'account'],
    scheduleOverview: [],
    registrationCta: { label: '在线注册', to: '/application' },
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

  it('accepts only safe contact link protocols', () => {
    for (const href of [
      'https://camp.example/contact',
      'mailto:camp@example.com',
      'tel:+8613800138000',
    ]) {
      expect(PublicContentPayloadSchemas.contacts.parse({
        items: [{ label: '联系方式', value: '联系我们', href }],
      })).toBeTruthy()
    }
  })

  it('keeps legacy contacts readable and accepts structured publishable contacts', () => {
    expect(PublicContentPayloadSchemas.contacts.safeParse({
      items: [{ label: '联系方式', value: '历史展示值', href: 'mailto:legacy@example.com' }],
    }).success).toBe(true)
    expect(PublicContentPayloadSchemas.contacts.safeParse({
      items: [{
        name: '测试联系人',
        responsibility: '课程咨询',
        methods: [
          { type: 'phone', value: '+8613800138000' },
          { type: 'email', value: 'test@example.com' },
        ],
        consultationNote: '仅用于测试',
      }],
    }).success).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://user:secret@camp.example/contact',
    'not a URL',
    'mailto:not-an-email',
    'tel:call-me',
  ])('rejects unsafe or malformed contact href %s', (href) => {
    expect(PublicContentPayloadSchemas.contacts.safeParse({
      items: [{ label: '联系方式', value: '联系我们', href }],
    }).success).toBe(false)
  })

  it.each([
    '2026-00-10',
    '2026-13-01',
    '2026-04-31',
    '2026-02-29',
    '0000-01-01',
  ])('rejects invalid Gregorian content date %s', (date) => {
    expect(PublicContentPayloadSchemas.schedule.safeParse({
      days: [{ date, label: '第一天', theme: '主题', sessions: [] }],
    }).success).toBe(false)
  })

  it('accepts a real leap day and rejects a reversed event date range', () => {
    expect(PublicContentPayloadSchemas.schedule.safeParse({
      days: [{ date: '2024-02-29', label: '第一天', theme: '主题', sessions: [] }],
    }).success).toBe(true)
    expect(PublicContentPayloadSchemas.basic.safeParse({
      ...publicSiteResponse.data.basic,
      dates: { start: '2026-08-27', end: '2026-08-23', label: '倒序日期' },
    }).success).toBe(false)
  })

  it('strips unknown additive fields from public response envelopes', () => {
    expect(PublicSiteResponseSchema.parse({
      ...publicSiteResponse,
      requestTrace: 'future-top-level-field',
      data: { ...publicSiteResponse.data, futureData: { enabled: true } },
    })).toEqual(publicSiteResponse)

    expect(PublicContentModuleResponseSchema.parse({
      apiVersion: 'v1',
      futureTopLevel: true,
      data: {
        contentVersion: 'travel:1',
        key: 'travel',
        payload: { sections: [] },
        futureData: true,
      },
    })).toEqual({
      apiVersion: 'v1',
      data: { contentVersion: 'travel:1', key: 'travel', payload: { sections: [] } },
    })
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
    expect(PublicSiteResponseSchema.parse({
      ...publicSiteResponse,
      data: { ...publicSiteResponse.data, schedule: { days: [] } },
    })).toEqual(publicSiteResponse)
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
      data: { user: { id: 'u1', displayName: '张三', role: 'user' } },
    })).toBeTruthy()
  })

  it.each([
    ['13800138000', '+8613800138000'],
    ['+8613800138000', '+8613800138000'],
  ])('normalizes the whole mainland mobile input %s', (phone, normalized) => {
    expect(AdminLoginRequestSchema.parse({ phone, password: '12345678' }).phone).toBe(normalized)
  })

  it.each([
    'phone=13800138000',
    '01012345678',
    '+8610123456789',
    '+86 13800138000',
    '12800138000',
    '1380013800',
    '138001380000',
  ])('rejects non-mobile or malformed whole phone input %s', (phone) => {
    expect(AdminLoginRequestSchema.safeParse({ phone, password: '12345678' }).success).toBe(false)
  })

  it.each([
    '1234567',
    'a'.repeat(73),
    `${'密'.repeat(24)}a`,
  ])('rejects password outside the 8..72 UTF-8 byte boundary', (password) => {
    expect(AdminLoginRequestSchema.safeParse({ phone: '13800138000', password }).success).toBe(false)
  })

  it.each(['12345678', 'a'.repeat(72), '密'.repeat(24)])('accepts password within the UTF-8 byte boundary', (password) => {
    expect(AdminLoginRequestSchema.safeParse({ phone: '13800138000', password }).success).toBe(true)
  })

  it('validates student auth requests without accepting plaintext extras', () => {
    expect(StudentLoginRequestSchema.parse({ phone: '13800138000', password: 'password-1' }).phone)
      .toBe('+8613800138000')
    expect(SendVerificationCodeRequestSchema.parse({ phone: '13800138000', purpose: 'reset_password' })).toEqual({
      phone: '+8613800138000', purpose: 'reset_password',
    })
    expect(StudentRegistrationRequestSchema.safeParse({
      phone: '13800138000', code: '246810', password: 'password-1', purpose: 'register',
    }).success).toBe(false)
    expect(PasswordResetRequestSchema.safeParse({
      phone: '13800138000', code: '246810', newPassword: 'password-2', password: 'do-not-accept',
    }).success).toBe(false)
  })

  it.each(['12345', '1234567', 'abcdef'])('rejects malformed verification code %s', (code) => {
    expect(StudentRegistrationRequestSchema.safeParse({ phone: '13800138000', code, password: 'password-1' }).success).toBe(false)
  })

  it.each([
    { apiVersion: 'v1', data: { user: { displayName: '张三', role: 'user' } } },
    { apiVersion: 'v1', data: { user: { id: 'u1', displayName: '张三', role: 'owner' } } },
    { apiVersion: 'v2', data: { user: { id: 'u1', displayName: '张三', role: 'user' } } },
  ])('rejects malformed login responses', (value) => {
    expect(LoginResponseSchema.safeParse(value).success).toBe(false)
  })

  it('strips credentials from serialized login responses', () => {
    const serialized = serializeLoginResponse({
      apiVersion: 'v1',
      token: 'top-secret',
      data: {
        sessionToken: 'session-secret',
        user: { id: 'u1', displayName: '张三', role: 'user', refreshToken: 'refresh-secret' },
      },
    })

    expect(serialized).toEqual({
      apiVersion: 'v1',
      data: { user: { id: 'u1', displayName: '张三', role: 'user' } },
    })
    expect(JSON.stringify(serialized)).not.toMatch(/top-secret|session-secret|refresh-secret/)
  })

  it('serializes registration independently from login without session fields', () => {
    const serialized = serializeRegistrationResponse({
      apiVersion: 'v1',
      sessionToken: 'must-not-be-returned',
      data: {
        user: { id: 'u1', displayName: '实训营学员', role: 'user' },
      },
    })

    expect(RegistrationResponseSchema.parse(serialized)).toEqual({
      apiVersion: 'v1',
      data: { user: { id: 'u1', displayName: '实训营学员', role: 'user' } },
    })
    expect(JSON.stringify(serialized)).not.toContain('must-not-be-returned')
  })

  it('accepts a forward-compatible authenticated profile without credential fields', () => {
    const profile = ProfileResponseSchema.parse({
      apiVersion: 'v1',
      trace: 'future-field',
      data: {
        future: true,
        user: {
          id: 'admin-1',
          displayName: '管理员',
          phoneNormalized: '+8613800138000',
          role: 'admin',
          passwordHash: 'must-not-survive',
        },
      },
    })

    expect(profile).toEqual({
      apiVersion: 'v1',
      data: {
        user: {
          id: 'admin-1',
          displayName: '管理员',
          phoneNormalized: '+8613800138000',
          role: 'admin',
        },
      },
    })
    expect(JSON.stringify(profile)).not.toContain('must-not-survive')
  })

  it.each([
    '+8610123456789',
    '+8612800138000',
    '+861380013800',
    '13800138000',
  ])('rejects invalid normalized profile phone %s', (phoneNormalized) => {
    expect(ProfileResponseSchema.safeParse({
      apiVersion: 'v1',
      data: { user: { id: 'u1', displayName: '用户', phoneNormalized, role: 'user' } },
    }).success).toBe(false)
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
