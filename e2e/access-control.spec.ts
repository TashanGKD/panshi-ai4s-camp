import { expect, test, type APIResponse, type BrowserContext } from '@playwright/test'

const apiBase = 'http://127.0.0.1:3030'
const webOrigin = 'http://127.0.0.1:4200'
const adminOrigin = 'http://127.0.0.1:4201'
const code = process.env.E2E_VERIFICATION_CODE!
const password = 'Access-Matrix-Student-19!'
const pdf = Buffer.from('JVBERi0xLjcKJcOiw6PDj8OTCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iagoyIDAgb2JqCjw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbXSAvQ291bnQgMCA+PgplbmRvYmoKeHJlZgowIDMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSAzIC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxMjAKJSVFT0YK', 'base64')

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
    const transitioned = await admin.request.post(`${apiBase}/api/v1/admin/applications/${admittedData.applicationId}/status`, { headers: { Origin: adminOrigin }, data: { expectedRevision: revision, targetStatus, editableFieldIds: [], editableAttachmentIds: [] } })
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
  expect((await ordinary.request.get(`${apiBase}/api/v1/me/application`)).status()).toBe(200)
  expect((await admitted.request.get(`${apiBase}/api/v1/me/application`)).status()).toBe(200)
  await assertError(await admin.request.get(`${apiBase}/api/v1/me/application`), 403, 'FORBIDDEN')

  await assertError(await ordinary.request.get(`${apiBase}/api/v1/files/${admittedData.fileId}/download`), 404, 'FILE_NOT_AVAILABLE')
  await assertError(await ordinary.request.get(`${apiBase}/api/v1/files/40000000-0000-4000-8000-000000000099/download`), 404, 'FILE_NOT_AVAILABLE')
  await assertError(await ordinary.request.get(`${apiBase}/api/v1/files/not-a-uuid/download`), 400, 'FILE_ID_INVALID')
  expect((await admin.request.get(`${apiBase}/api/v1/files/${ordinaryData.fileId}/download`)).status()).toBe(200)

  await assertError(await anonymous.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`), 404, 'RESOURCE_NOT_AVAILABLE')
  await assertError(await ordinary.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`), 404, 'RESOURCE_NOT_AVAILABLE')
  const admittedDownload = await admitted.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`)
  expect(admittedDownload.status()).toBe(200)
  assertPrivate(admittedDownload)
  expect(await admittedDownload.body()).toEqual(pdf)
  expect((await admin.request.get(`${apiBase}/api/v1/resources/${resource.id}/download`)).status()).toBe(200)
  await assertError(await anonymous.request.get(`${apiBase}/api/v1/resources/not-a-uuid/download`), 400, 'RESOURCE_ID_INVALID')

  for (const actor of [anonymous, ordinary, admitted]) {
    await assertError(await actor.request.get(`${apiBase}/api/v1/admin/applications/${ordinaryData.applicationId}`), 403, 'FORBIDDEN')
    await assertError(await actor.request.get(`${apiBase}/api/v1/admin/audit-logs`), 403, 'FORBIDDEN')
    await assertError(await actor.request.get(`${apiBase}/api/v1/admin/users`), 403, 'FORBIDDEN')
  }
  const adminApplication = await admin.request.get(`${apiBase}/api/v1/admin/applications/${ordinaryData.applicationId}`)
  expect(adminApplication.status()).toBe(200); assertPrivate(adminApplication)
  const auditList = await admin.request.get(`${apiBase}/api/v1/admin/audit-logs`)
  expect(auditList.status()).toBe(200); assertPrivate(auditList)
  const auditId = (await auditList.json()).data.items[0].id
  expect((await admin.request.get(`${apiBase}/api/v1/admin/audit-logs/${auditId}`)).status()).toBe(200)
  await assertError(await admin.request.get(`${apiBase}/api/v1/admin/audit-logs/not-a-uuid`), 422, 'AUDIT_LOG_ID_INVALID')
  await assertError(await admin.request.get(`${apiBase}/api/v1/admin/applications/not-a-uuid`), 400, 'INVALID_APPLICATION_ID')

  await assertError(await anonymous.request.post(`${apiBase}/api/v1/me/application`), 403, 'ORIGIN_REQUIRED')
  await assertError(await anonymous.request.post(`${apiBase}/api/v1/me/application`, { headers: { Origin: webOrigin }, data: {} }), 401, 'UNAUTHORIZED')
  await assertError(await ordinary.request.post(`${apiBase}/api/v1/me/application`, { headers: { Origin: webOrigin }, data: {} }), 404, 'NOT_FOUND')
  await assertError(await admin.request.patch(`${apiBase}/api/v1/admin/audit-logs/${auditId}`, { headers: { Origin: adminOrigin }, data: {} }), 404, 'NOT_FOUND')

  await Promise.all([anonymous.close(), ordinary.close(), admitted.close(), admin.close()])
})
