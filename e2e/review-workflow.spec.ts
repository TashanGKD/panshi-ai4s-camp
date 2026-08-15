import { expect, test, type APIResponse } from '@playwright/test'

const apiBase = 'http://127.0.0.1:3022'
const adminOrigin = 'http://127.0.0.1:4195'
const pdf = Buffer.from('JVBERi0xLjcKJcOiw6PDj8OTCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iagoyIDAgb2JqCjw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbXSAvQ291bnQgMCA+PgplbmRvYmoKeHJlZgowIDMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSAzIC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxMjAKJSVFT0YK', 'base64')
const privateResponse = (response: APIResponse) => {
  expect(response.headers()['cache-control']).toBe('private, no-store')
  expect(response.headers().etag).toBeUndefined()
}

test('review workflow enforces state, privacy, bulk, export and revision contracts', async ({ browser }) => {
  test.setTimeout(120_000)
  const studentContext = await browser.newContext()
  const student = await studentContext.newPage()
  const phone = process.env.E2E_REGISTER_PHONE!
  const password = process.env.E2E_REGISTER_PASSWORD!
  const code = process.env.E2E_VERIFICATION_CODE!
  await student.goto('http://127.0.0.1:4194/register')
  await student.getByLabel('手机号').fill(phone)
  await student.getByRole('button', { name: '获取验证码' }).click()
  await student.getByLabel('验证码').fill(code)
  await student.getByRole('button', { name: '下一步' }).click()
  await student.getByLabel('设置密码').fill(password)
  await student.getByLabel('确认密码').fill(password)
  await student.getByRole('button', { name: '创建账号' }).click()
  await expect(student.getByRole('status')).toContainText('注册成功')
  await student.goto('http://127.0.0.1:4194/login')
  await student.getByLabel('手机号').fill(phone)
  await student.getByLabel('密码').fill(password)
  await student.getByRole('button', { name: '登录' }).click()
  await expect(student.getByRole('status')).toContainText('登录成功')
  await student.goto('http://127.0.0.1:4194/application')
  await expect(student.getByRole('heading', { name: '在线报名' })).toBeVisible()
  await student.getByLabel('姓名').fill('=张三')
  await student.getByLabel('电子邮箱').fill('z@example.com')
  await student.getByLabel('所在单位').fill('中国科学院物理研究所')
  await student.getByLabel('院系/部门').fill('研究生部')
  await student.getByLabel('身份类型').fill('研究生')
  await student.getByLabel('学历阶段').fill('博士')
  await student.getByLabel('专业及研究方向').fill('凝聚态物理')
  await student.getByLabel(/拟解决的科研问题/u).fill('初始研究计划')
  await student.getByLabel(/个人简历/u).setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: pdf })
  await expect(student.getByText('resume.pdf')).toBeVisible()
  student.once('dialog', (dialog) => dialog.accept())
  await student.getByRole('button', { name: '正式提交' }).click()
  await expect(student.getByText('报名已提交，当前内容为只读。')).toBeVisible()

  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await admin.goto('http://127.0.0.1:4195')
  await admin.getByLabel('手机号').fill('+8613999999999')
  await admin.getByLabel('密码').fill(process.env.E2E_ADMIN_PASSWORD!)
  await admin.getByRole('button', { name: '登录' }).click()
  await admin.getByRole('link', { name: '报名审核' }).click()
  const listResponse = await adminContext.request.get(`${apiBase}/api/v1/admin/applications?search=%3D%E5%BC%A0%E4%B8%89`)
  privateResponse(listResponse)
  const listed = await listResponse.json()
  const application = listed.data.items[0]
  expect(application.name).toBe('=张三')
  await admin.getByRole('link', { name: '查看审核' }).click()
  const answers = admin.getByRole('heading', { name: '报名答案（只读）' }).locator('..')
  await expect(answers).toContainText('初始研究计划')
  await expect(answers.locator('input, textarea, select')).toHaveCount(0)

  const concurrentBody = { expectedRevision: application.revision, targetStatus: 'reviewing', internalNote: '仅管理员可见的并发审核说明', editableFieldIds: [], editableAttachmentIds: [] }
  const concurrent = await Promise.all([
    adminContext.request.post(`${apiBase}/api/v1/admin/applications/${application.id}/status`, { data: concurrentBody, headers: { Origin: adminOrigin } }),
    adminContext.request.post(`${apiBase}/api/v1/admin/applications/${application.id}/status`, { data: concurrentBody, headers: { Origin: adminOrigin } }),
  ])
  concurrent.forEach(privateResponse)
  expect(concurrent.map((response) => response.status()).sort()).toEqual([200, 409])
  const conflict = concurrent.find((response) => response.status() === 409)!
  expect((await conflict.json()).error.code).toBe('APPLICATION_REVISION_CONFLICT')

  const detailResponse = await adminContext.request.get(`${apiBase}/api/v1/admin/applications/${application.id}`)
  privateResponse(detailResponse)
  const current = (await detailResponse.json()).data.application
  const illegal = await adminContext.request.post(`${apiBase}/api/v1/admin/applications/${application.id}/status`, { data: { expectedRevision: current.revision, targetStatus: 'draft', editableFieldIds: [], editableAttachmentIds: [] }, headers: { Origin: adminOrigin } })
  privateResponse(illegal)
  expect(illegal.status()).toBe(409)
  expect((await illegal.json()).error.code).toBe('INVALID_STATUS_TRANSITION')

  const csvResponse = await adminContext.request.get(`${apiBase}/api/v1/admin/applications/export.csv?status=reviewing&organization=${encodeURIComponent('中国科学院物理研究所')}`)
  privateResponse(csvResponse)
  const csv = await csvResponse.body()
  expect(csv.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  const csvText = csv.toString('utf8')
  expect(csvText).toContain("'=张三")
  expect(csvText).not.toContain('仅管理员可见的并发审核说明')
  expect(csvText).not.toContain('初始研究计划')
  expect(csvText).not.toContain(phone)

  await admin.reload()
  const reviewButton = admin.getByRole('button', { name: '确认更新状态' })
  const statusSelect = admin.getByLabel('目标状态')
  await statusSelect.selectOption('needs_supplement')
  await admin.getByLabel('面向学员的说明').fill('请完善研究计划')
  await admin.getByText('拟解决的科研问题').locator('input').check()
  await reviewButton.click()
  await expect(admin.locator('dl').getByText('needs_supplement', { exact: true })).toBeVisible()
  await student.reload()
  await expect(student.getByText('请完善研究计划')).toBeVisible()
  await expect(student.getByLabel('姓名')).toBeDisabled()
  await student.getByLabel(/拟解决的科研问题/u).fill('补充后的研究计划')
  await student.getByRole('button', { name: '保存草稿' }).click()
  student.once('dialog', (dialog) => dialog.accept())
  await student.getByRole('button', { name: '正式提交' }).click()
  await expect(student.getByText('报名已提交，当前内容为只读。')).toBeVisible()

  const missingId = '30000000-0000-4000-8000-000000000099'
  const bulkResponse = await adminContext.request.post(`${apiBase}/api/v1/admin/applications/bulk-status`, { data: { applicationIds: [application.id, missingId], targetStatus: 'admitted' }, headers: { Origin: adminOrigin } })
  privateResponse(bulkResponse)
  expect(bulkResponse.status()).toBe(200)
  expect((await bulkResponse.json()).data.results).toEqual([
    expect.objectContaining({ applicationId: application.id, success: true, status: 'admitted' }),
    expect.objectContaining({ applicationId: missingId, success: false, code: 'APPLICATION_NOT_FOUND' }),
  ])
  await student.goto('http://127.0.0.1:4194/account')
  await expect(student.getByRole('definition').filter({ hasText: '已录取' })).toBeVisible()
  await studentContext.close()
  await adminContext.close()
})
