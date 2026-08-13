import { describe, expect, it } from 'vitest'
import {
  ApiErrorSchema,
  ApplicationStatusSchema,
  ContentModuleKeySchema,
  LoginResponseSchema,
  PaginationMetaSchema,
  PublicSiteResponseSchema,
  RegistrationSnapshotSchema,
  ResourceAccessSchema,
  UserRoleSchema,
} from './index.js'

describe('contracts', () => {
  it('accepts every approved application state', () => {
    for (const value of ['draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected']) {
      expect(ApplicationStatusSchema.parse(value)).toBe(value)
    }
  })

  it('requires stable machine-readable errors', () => {
    expect(ApiErrorSchema.parse({ error: { code: 'UNAUTHORIZED', message: '未登录', requestId: 'r1' } })).toBeTruthy()
  })

  it('freezes identity and access values', () => {
    expect(UserRoleSchema.options).toEqual(['user', 'admin'])
    expect(ResourceAccessSchema.options).toEqual(['public', 'authenticated', 'admitted'])
  })

  it('freezes public content modules', () => {
    expect(ContentModuleKeySchema.options).toEqual([
      'home',
      'schedule',
      'registration',
      'travel',
      'contact',
      'resources',
    ])
  })

  it('validates minimal versioned response envelopes', () => {
    expect(PublicSiteResponseSchema.parse({
      apiVersion: 'v1',
      data: { contentVersion: '2026-08-13', modules: ['home', 'schedule'] },
    })).toBeTruthy()
    expect(LoginResponseSchema.parse({
      apiVersion: 'v1',
      data: { user: { id: 'u1', role: 'user' } },
    })).toBeTruthy()
  })

  it('validates immutable registration snapshot semantics', () => {
    expect(RegistrationSnapshotSchema.parse({
      formVersion: '2026-08-13',
      submittedAt: '2026-08-13T12:00:00.000Z',
      answers: { name: '张三' },
    })).toBeTruthy()
  })

  it('validates pagination metadata', () => {
    expect(PaginationMetaSchema.parse({ page: 1, pageSize: 20, totalItems: 21, totalPages: 2 })).toBeTruthy()
  })
})
