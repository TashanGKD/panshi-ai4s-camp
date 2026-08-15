import { expect, test, type APIResponse, type BrowserContext } from '@playwright/test'
import { runLaunchFixture } from '../apps/api/src/cli/launch-e2e-fixture'

const apiBase = 'http://127.0.0.1:3030'
const webOrigin = 'http://127.0.0.1:4200'
const adminOrigin = 'http://127.0.0.1:4201'
const code = process.env.E2E_VERIFICATION_CODE!
const password = 'Access-Matrix-Student-19!'
const pdf = Buffer.from('JVBERi0xLjcKJcOiw6PDj8OTCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iagoyIDAgb2JqCjw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbXSAvQ291bnQgMCA+PgplbmRvYmoKeHJlZgowIDMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSAzIC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxMjAKJSVFT0YK', 'base64')
const missingUuid = '40000000-0000-4000-8000-000000000099'
const internalNote = 'TASK19_INTERNAL_NOTE_DO_NOT_LEAK'

test.beforeEach(async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  await runLaunchFixture('reset')
})

const assertPrivate = (response: APIResponse) => {
  expect(response.headers()['cache-control']).toBe('private, no-store')
  expect(response.headers().etag).toBeUndefined()
}

const assertError = async (response: APIResponse, status: number, code: string) => {
  expect(response.status()).toBe(status)
  assertPrivate(response)
  const text = await response.text()
  expect(text).not.toMatch(/TASK19_INTERNAL_NOTE_DO_NOT_LEAK|storage_key|var\/e2e|verification|password|phone_normalized|stack|postgres/iu)
  expect(JSON.parse(text).error.code).toBe(code)
}

const assertPrivateBytes = async (response: APIResponse, expected: Buffer) => {
  expect(response.status()).toBe(200)
  assertPrivate(response)
  expect(await response.body()).toEqual(expected)
}

const registerLogin = async (context: BrowserContext, phone: string) => {
  let response = await context.request.post(`${apiBase}/api/v1/auth/verification/send`, { headers: { Origin: webOrigin }, data: { phone, purpose: 'register' } })
  expect(response.status()).toBe(204)
  response = await context.request.post(`${apiBase}/api/v1/auth/register`, { headers: { Origin: webOrigin }, data: { phone, code, password } })
  expect(response.status()).toBe(201)
  response = await context.request.post(`${apiBase}/api/v1/auth/login`, { headers: { Origin: webOrigin }, data: { phone, password } })
  expect(response.status()).toBe(200)
}

const submitApplication = async (context: BrowserContext, name: string) => {
  const mine = await context.request.get(`${apiBase}/api/v1/me/application`)
  const application = (await mine.json()).data.application
  const slotId = application.form.attachments[0].id
  const questionId = application.form.questions[0].id
  const upload = await context.request.post(`${apiBase}/api/v1/files`, { headers: { Origin: webOrigin }, multipart: { purpose: 'registration_attachment', attachmentSlot: slotId, file: { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: pdf } } })
  expect(upload.status()).toBe(201)
  const fileId = (await upload.json()).data.file.id
  const saved = await context.request.put(`${apiBase}/api/v1/me/application/draft`, { headers: { Origin: webOrigin }, data: { expectedRevision: application.revision, profile: { name, email: `${name}@example.test`, organization: '测试单位', department: '测试部门', identityType: '研究生', educationStage: '博士', majorResearchDirection: 'AI4S' }, answers: { [questionId]: '访问控制测试回答' }, attachments: [{ slotId, fileId }] } })
  expect(saved.status()).toBe(200)
  const savedApp = (await saved.json()).data.application
  const submitted = await context.request.post(`${apiBase}/api/v1/me/application/submit`, { headers: { Origin: webOrigin }, data: { expectedRevision: savedApp.revision } })
  expect(submitted.status()).toBe(201)
  return { applicationId: (await submitted.json()).data.applicationId, fileId }
}

test('anonymous, student, admitted student and admin enforce the launch access matrix', async ({ browser }) => {
  test.setTimeout(180_000)
  const anonymous = await browser.newContext()
  const ordinary = await browser.newContext()
  const admitted = await browser.newContext()
  const admin = await browser.newContext()
  await registerLogin(ordinary, '+8613800000020')
  await registerLogin(admitted, '+8613800000021')
  const ordinaryData = await submitApplication(ordinary, 'ordinary')
  const admittedData = await submitApplication(admitted, 'admitted')
  const adminLogin = await admin.request.post(`${apiBase}/api/v1/auth/admin/login`, { headers: { Origin: adminOrigin }, data: { phone: '+8613999999999', password: process.env.E2E_ADMIN_PASSWORD } })
  expect(adminLogin.status()).toBe(200)

  const admittedDetail = await admin.request.get(`${apiBase}/api/v1/admin/applications/${admittedData.applicationId}`)
  let revision = (await admittedDetail.json()).data.application.revision
  for (const targetStatus of ['reviewing', 'admitted']) {
    const transitioned = await admin.request.post(`${apiBase}/api/v1/admin/applications/${admittedData.applicationId}/status`, { headers: { Origin: adminOrigin }, data: { expectedRevision: revision, targetStatus, internalNote: targetStatus === 'reviewing' ? internalNote : undefined, editableFieldIds: [], editableAttachmentIds: [] } })
    expect(transitioned.status()).toBe(200)
    revision = (await transitioned.json()).data.revision
  }

  const upload = await admin.request.post(`${apiBase}/api/v1/files`, { headers: { Origin: adminOrigin }, multipart: { purpose: 'resource', visibility: 'admitted', file: { name: 'matrix-admitted.pdf', mimeType: 'application/pdf', buffer: pdf } } })
  const resourceFileId = (await upload.json()).data.file.id
  const draft = await admin.request.post(`${apiBase}/api/v1/admin/resources`, { headers: { Origin: adminOrigin }, data: { key: 'matrix-admitted', title: 'Matrix admitted', description: null, fileId: resourceFileId, accessScope: 'admitted', sortOrder: 19, expectedRevision: 0 } })
  const resource = (await draft.json()).data.resource
  const published = await admin.request.post(`${apiBase}/api/v1/admin/resources/${resource.id}/publish`, { headers: { Origin: adminOrigin }, data: { expectedRevision: resource.revision } })
  expect(published.status()).toBe(200)

  expect((await anonymous.request.get(`${apiBase}/api/v1/public/site`)).status()).toBe(200)
  expect((await ordinary.request.get(`${apiBase}/api/v1/public/site`)).status()).toBe(200)
  expect((await admitted.request.get(`${apiBase}/api/v1/public/site`)).status()).toBe(200)
  expect((await admin.request.get(`${apiBase}/api/v1/public/site`)).status()).toBe(200)

  await assertError(await anonymous.request.get(`${apiBase}/api/v1/me/application`), 401, 'UNAUTHORIZED')
  for (const actor of [ordinary, admitted]) {
    const mine = await actor.request.get(`${apiBase}/api/v1/me/application`)
    expect(mine.status()).toBe(200); assertPrivate(mine)
    expect(await mine.text()).not.toMatch(/TASK19_INTERNAL_NOTE_DO_NOT_LEAK|storage_key|var\/e2e|postgres|password_hash|token_hash/iu)
  }
  await assertError(await admin.request.get(`${apiBase}/api/v1/me/application`), 403, 'FORBIDDEN')

  await assertPrivateBytes(await ordinary.request.get(`${apiBase}/api/v1/files/${ordinaryData.fileId}/download`), pdf)
  await assertPrivateBytes(await admitted.request.get(`${apiBase}/api/v1/files/${admittedData.fileId}/download`), pdf)
  await assertError(await anonymous.request.get(`${apiBase}/api/v1/files/${ordinaryData.fileId}/download`), 401, 'UNAUTHORIZED')
  await assertError(await ordinary.request.get(`${apiBase}/api/v1/files/${admittedData.fileId}/download`), 404, 'FILE_NOT_AVAILABLE')
  await assertError(await admitted.request.get(`${apiBase}/api/v1/files/${ordinaryData.fileId}/download`), 404, 'FILE_NOT_AVAILABLE')
  await assertError(await ordinary.request.get(`${apiBase}/api/v1/files/${missingUuid}/download`), 404, 'FILE_NOT_AVAILABLE')
  await assertError(await ordinary.request.get(`${apiBase}/api/v1/files/not-a-uuid/download`), 400, 'FILE_ID_INVALID')
  await assertPrivateBytes(await admin.request.get(`${apiBase}/api/v1/files/${ordinaryData.fileId}/download`), pdf)

  await assertError(await anonymous.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`), 404, 'RESOURCE_NOT_AVAILABLE')
  await assertError(await ordinary.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`), 404, 'RESOURCE_NOT_AVAILABLE')
  const admittedDownload = await admitted.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`)
  await assertPrivateBytes(admittedDownload, pdf)
  await assertPrivateBytes(await admin.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`), pdf)
  for (const actor of [anonymous, ordinary]) {
    const existing = await actor.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`)
    const missing = await actor.request.get(`${apiBase}/api/v1/resources/${missingUuid}/download`)
    await assertError(existing, 404, 'RESOURCE_NOT_AVAILABLE')
    await assertError(missing, 404, 'RESOURCE_NOT_AVAILABLE')
    expect((await existing.json()).error).toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
    expect((await missing.json()).error).toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
  }
  await assertError(await admitted.request.get(`${apiBase}/api/v1/resources/${missingUuid}/download`), 404, 'RESOURCE_NOT_AVAILABLE')
  await assertError(await anonymous.request.get(`${apiBase}/api/v1/resources/not-a-uuid/download`), 400, 'RESOURCE_ID_INVALID')

  for (const actor of [anonymous, ordinary, admitted]) {
    const existing = await actor.request.get(`${apiBase}/api/v1/admin/applications/${ordinaryData.applicationId}`)
    const missing = await actor.request.get(`${apiBase}/api/v1/admin/applications/${missingUuid}`)
    await assertError(existing, 403, 'FORBIDDEN')
    await assertError(missing, 403, 'FORBIDDEN')
    const existingError = (await existing.json()).error
    const missingError = (await missing.json()).error
    expect(existingError).toMatchObject({ code: 'FORBIDDEN' })
    expect(missingError).toMatchObject({ code: 'FORBIDDEN', message: existingError.message })
    await assertError(await actor.request.get(`${apiBase}/api/v1/admin/audit-logs`), 403, 'FORBIDDEN')
    await assertError(await actor.request.get(`${apiBase}/api/v1/admin/users`), 403, 'FORBIDDEN')
  }
  const adminApplication = await admin.request.get(`${apiBase}/api/v1/admin/applications/${ordinaryData.applicationId}`)
  expect(adminApplication.status()).toBe(200); assertPrivate(adminApplication)
  const auditList = await admin.request.get(`${apiBase}/api/v1/admin/audit-logs`)
  expect(auditList.status()).toBe(200); assertPrivate(auditList)
  expect(await auditList.text()).not.toContain(internalNote)
  const auditId = (await auditList.json()).data.items[0].id
  const auditDetail = await admin.request.get(`${apiBase}/api/v1/admin/audit-logs/${auditId}`)
  expect(auditDetail.status()).toBe(200); assertPrivate(auditDetail)
  expect(await auditDetail.text()).not.toMatch(/TASK19_INTERNAL_NOTE_DO_NOT_LEAK|storage_key|var\/e2e|postgres/iu)
  await assertError(await admin.request.get(`${apiBase}/api/v1/admin/audit-logs/not-a-uuid`), 422, 'AUDIT_LOG_ID_INVALID')
  await assertError(await admin.request.get(`${apiBase}/api/v1/admin/applications/not-a-uuid`), 400, 'INVALID_APPLICATION_ID')

  await assertError(await anonymous.request.post(`${apiBase}/api/v1/me/application`), 403, 'ORIGIN_REQUIRED')
  await assertError(await anonymous.request.post(`${apiBase}/api/v1/me/application`, { headers: { Origin: webOrigin }, data: {} }), 401, 'UNAUTHORIZED')
  await assertError(await ordinary.request.post(`${apiBase}/api/v1/me/application`, { headers: { Origin: webOrigin }, data: {} }), 404, 'NOT_FOUND')
  await assertError(await admin.request.patch(`${apiBase}/api/v1/admin/audit-logs/${auditId}`, { headers: { Origin: adminOrigin }, data: {} }), 404, 'NOT_FOUND')

  for (const actor of [anonymous, ordinary, admitted]) {
    for (const url of [`${apiBase}/api/v1/public/site`, `${apiBase}/api/v1/resources`, `${apiBase}/api/v1/me/application`]) {
      expect(await (await actor.request.get(url)).text()).not.toContain(internalNote)
    }
  }

  const boundaries = [
    [anonymous, 'GET', '/api/v1/files/not-a-uuid/download', 401, 'UNAUTHORIZED'],
    [ordinary, 'GET', '/api/v1/files/not-a-uuid/download', 400, 'FILE_ID_INVALID'],
    [ordinary, 'POST', '/api/v1/me/application', 404, 'NOT_FOUND'],
    [anonymous, 'GET', '/api/v1/admin/applications/not-a-uuid', 403, 'FORBIDDEN'],
    [admin, 'GET', '/api/v1/admin/applications/not-a-uuid', 400, 'INVALID_APPLICATION_ID'],
    [admin, 'GET', '/api/v1/admin/audit-logs/not-a-uuid', 422, 'AUDIT_LOG_ID_INVALID'],
    [admin, 'PATCH', `/api/v1/admin/audit-logs/${auditId}`, 404, 'NOT_FOUND'],
  ] as const
  for (const [actor, method, path, status, errorCode] of boundaries) {
    const response = await actor.request.fetch(`${apiBase}${path}`, { method, ...(method === 'GET' ? {} : { headers: { Origin: actor === admin ? adminOrigin : webOrigin }, data: {} }) })
    await assertError(response, status, errorCode)
  }

  await Promise.all([anonymous.close(), ordinary.close(), admitted.close(), admin.close()])
})
