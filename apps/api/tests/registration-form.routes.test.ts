import { hashSessionToken } from '../src/modules/identity/session.service.js'
import { createApp } from '../src/app.js'
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import {
  DEFAULT_REGISTRATION_FORM,
  type RegistrationForm,
  type RegistrationFormPublishResponse,
} from '@panshi/contracts'
import { RegistrationFormValidationError, type RegistrationFormService } from '../src/modules/registration/form.service.js'

const admin = { id: '00000000-0000-4000-8000-000000000010', displayName: '管理员', phoneNormalized: '+8613800138000', passwordHash: 'unused', role: 'admin' as const, disabledAt: null }
const student = { ...admin, id: '00000000-0000-4000-8000-000000000011', role: 'user' as const }
const service = (published: boolean): RegistrationFormService => {
  const publishedVersion = {
    id: '00000000-0000-4000-8000-000000000020', version: 1, form: DEFAULT_REGISTRATION_FORM as RegistrationForm,
    createdBy: admin.id, createdAt: new Date('2026-08-15T00:00:00.000Z'),
  }
  const response: RegistrationFormPublishResponse = { apiVersion: 'v1', data: { formVersionId: publishedVersion.id, revision: 0, version: 1 } }
  return {
    getDraft: async () => ({ apiVersion: 'v1', data: { form: DEFAULT_REGISTRATION_FORM as RegistrationForm, revision: 0, baseVersion: published ? 1 : null, publishedVersionId: published ? publishedVersion.id : null } }),
    saveDraft: async (input) => {
      if ((input as RegistrationForm).questions[0]?.label === '') throw new RegistrationFormValidationError({ fields: [{ path: 'questions.0.label', code: 'INVALID_FIELD', message: '不能为空' }] })
      return { apiVersion: 'v1', data: { form: DEFAULT_REGISTRATION_FORM as RegistrationForm, revision: 1, baseVersion: null, publishedVersionId: null } }
    },
    preview: async () => ({ apiVersion: 'v1', data: { form: DEFAULT_REGISTRATION_FORM as RegistrationForm, revision: 0, baseVersion: null, publishedVersionId: null } }),
    publish: async () => response,
    getHistory: async () => ({ apiVersion: 'v1', data: { publishedVersion: published ? 1 : null, versions: published ? [{ ...publishedVersion, createdAt: publishedVersion.createdAt.toISOString() }] : [] } }),
    getPublished: async () => published ? publishedVersion : null,
    getVersion: async (id) => id === publishedVersion.id ? publishedVersion : null,
  }
}

const app = (published: boolean) => createApp({
  checkDatabase: async () => undefined,
  identityRepository: {
    findUserByPhoneNormalized: async () => null,
    findSessionByTokenHash: async (tokenHash) => {
      const user = tokenHash === hashSessionToken('admin-token') ? admin : tokenHash === hashSessionToken('student-token') ? student : null
      return user ? { tokenHash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user } : null
    },
    revokeSessionByTokenHash: async () => undefined,
  },
  authTransactionRepository: { rotateSessionAndAudit: async () => undefined, revokeSessionAndAudit: async () => undefined },
  registrationFormService: service(published),
  config: { allowedOrigins: ['https://admin.example'], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
})

describe('registration form HTTP contract', () => {
  it('returns 401 to anonymous admin reads and 403 to ordinary users', async () => {
    expect((await request(app(false)).get('/api/v1/admin/registration-form/draft')).status).toBe(401)
    expect((await request(app(false)).get('/api/v1/admin/registration-form/draft').set('Cookie', 'panshi_session=student-token')).status).toBe(403)
  })

  it('allows an administrator to read the draft and returns an explicit empty public state', async () => {
    const adminResponse = await request(app(false)).get('/api/v1/admin/registration-form/draft').set('Cookie', 'panshi_session=admin-token')
    expect(adminResponse.status).toBe(200)
    expect(adminResponse.body.data.form.attachments).toHaveLength(1)
    expect((await request(app(false)).get('/api/v1/public/registration-form')).status).toBe(404)
  })

  it('returns field-level 422 details for an invalid schema submitted by an administrator', async () => {
    const response = await request(app(false)).put('/api/v1/admin/registration-form/draft')
      .set('Origin', 'https://admin.example').set('Cookie', 'panshi_session=admin-token')
      .send({ expectedRevision: 0, form: { ...DEFAULT_REGISTRATION_FORM, questions: [{ id: '11111111-1111-4111-8111-111111111111', type: 'short_text', label: '', helpText: '', required: true, order: 0, active: true, validation: {} }] } })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('REGISTRATION_FORM_VALIDATION_FAILED')
    expect(response.body.error.details.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'questions.0.label' })]))
  })

  it('returns only the published snapshot and supports immutable version lookup', async () => {
    const publicResponse = await request(app(true)).get('/api/v1/public/registration-form')
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.body.data.form.coreFields.find((field: { key: string }) => field.key === 'phone')).toMatchObject({ readOnly: true })
    const versionResponse = await request(app(true)).get('/api/v1/public/registration-forms/00000000-0000-4000-8000-000000000020')
    expect(versionResponse.status).toBe(200)
    expect(versionResponse.body.data.version).toBe(1)
  })
})
