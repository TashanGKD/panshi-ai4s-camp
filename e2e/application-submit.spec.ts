import { expect, test, type Page } from '@playwright/test'
import { eq, isNotNull } from 'drizzle-orm'
import { createDatabaseClient } from '../apps/api/src/db/client'
import { sessions, users } from '../apps/api/src/db/schema'

const phone = process.env.E2E_REGISTER_PHONE!
const password = process.env.E2E_REGISTER_PASSWORD!
const code = process.env.E2E_VERIFICATION_CODE!
const pdf = Buffer.from('JVBERi0xLjcKJcOiw6PDj8OTCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iagoyIDAgb2JqCjw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbXSAvQ291bnQgMCA+PgplbmRvYmoKeHJlZgowIDMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSAzIC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxMjAKJSVFT0YK', 'base64')

test.describe.configure({ mode: 'serial' })

const completeQuestions = async (page: Page) => {
  for (const row of await page.locator('.proficiency-matrix__row').all()) await row.getByRole('radio', { name: '了解并会简单使用' }).check()
  await page.getByRole('group', { name: /感兴趣的课程专题/u }).getByRole('checkbox', { name: /科研智能体/u }).check()
  await page.getByRole('group', { name: /是否可以线下参加实训/u }).getByRole('radio', { name: '是' }).check()
  const willingness = page.getByRole('group', { name: /是否愿意参加晚间研讨/u })
  await willingness.getByRole('checkbox', { name: '晚间研讨' }).check()
  await willingness.getByRole('checkbox', { name: '开放实践' }).check()
  const problemPool = page.getByRole('group', { name: /从实训营问题池中选择/u })
  const problemChoices = await problemPool.getByRole('checkbox').all()
  await problemChoices[0]!.check(); await problemChoices[1]!.check(); await problemChoices.at(-1)!.check()
  await page.getByRole('textbox', { name: /本人希望提出和研讨的科研问题/u }).fill('面向凝聚态物理数据的可复现科研智能体研究')
  await page.getByLabel(/对课程的主要预期/u).fill('掌握从科学问题定义到模型与智能体验证的完整方法。')
}

test('student replaces an attachment, submits once, and is logged out when disabled', async ({ page, context }) => {
  await page.goto('/register'); await page.getByLabel('手机号').fill(phone); await page.getByRole('button', { name: '获取验证码' }).click(); await page.getByLabel('验证码').fill(code); await page.getByRole('button', { name: '下一步' }).click(); await page.getByLabel('设置密码').fill(password); await page.getByLabel('确认密码').fill(password); await page.getByRole('button', { name: '创建账号' }).click(); await expect(page.getByRole('status')).toContainText('注册成功')
  await page.goto('/login'); await page.getByLabel('手机号').fill(phone); await page.getByLabel('密码').fill(password); await page.getByRole('button', { name: '登录' }).click(); await expect(page.getByRole('status')).toContainText('登录成功')
  await page.goto('/application'); await expect(page.getByRole('heading', { name: '在线报名' })).toBeVisible()
  await page.getByLabel('姓名').fill('临时姓名')
  await Promise.all([page.waitForEvent('dialog').then((dialog) => dialog.dismiss()), page.getByRole('link', { name: '个人中心' }).click()]); await expect(page).toHaveURL(/\/application$/u)
  await Promise.all([page.waitForEvent('dialog').then((dialog) => dialog.accept()), page.getByRole('link', { name: '个人中心' }).click()]); await expect(page).toHaveURL(/\/account$/u)
  await page.goto('/application'); await expect(page.getByRole('heading', { name: '在线报名' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '正式提交' }).click(); await expect(page.getByText('请完成所有必填项')).toBeVisible()
  await page.getByLabel('姓名').fill('张三'); await page.getByLabel('电子邮箱').fill('z@example.com'); await page.getByLabel('当前身份').selectOption({ label: '博士研究生' })
  await page.getByLabel('所在学校').fill('中国科学院大学'); await page.getByRole('option', { name: '中国科学院大学' }).click()
  await page.getByLabel('培养单位').fill('中国科学院物理研究所'); await page.getByRole('option', { name: '中国科学院物理研究所' }).click()
  await page.getByRole('textbox', { name: '专业', exact: true }).fill('物理学'); await page.getByRole('textbox', { name: '研究方向', exact: true }).fill('凝聚态物理'); await completeQuestions(page)
  await page.getByLabel(/个人简历/u).setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: pdf })
  await expect(page.getByText('resume.pdf')).toBeVisible(); await expect(page.getByRole('status')).toContainText('草稿已保存')
  await page.reload(); await expect(page.getByRole('textbox', { name: /本人希望提出和研讨的科研问题/u })).toHaveValue('面向凝聚态物理数据的可复现科研智能体研究'); await expect(page.getByText('resume.pdf')).toBeVisible()
  await page.getByRole('button', { name: '删除并替换' }).click(); await expect(page.getByText('resume.pdf')).not.toBeVisible(); await expect(page.getByLabel(/个人简历/u)).toBeVisible()
  await page.getByLabel(/个人简历/u).setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: pdf }); await expect(page.getByText('replacement.pdf')).toBeVisible(); await expect(page.getByRole('status')).toContainText('草稿已保存')

  let submitRequests = 0
  await page.route('**/api/v1/me/application/submit', async (route) => { submitRequests += 1; await new Promise((resolve) => setTimeout(resolve, 150)); await route.continue() })
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '正式提交' }).click(); await expect(page.getByRole('button', { name: '处理中' })).toBeDisabled(); await expect(page.getByText('报名已提交，当前内容为只读。')).toBeVisible(); expect(submitRequests).toBe(1); await expect(page.getByRole('textbox', { name: /本人希望提出和研讨的科研问题/u })).toBeDisabled()
  await page.goto('/account'); await expect(page.getByRole('heading', { name: '个人中心' })).toBeVisible(); await expect(page.getByRole('definition').filter({ hasText: '已提交' })).toBeVisible(); await expect(page.getByRole('link', { name: '查看报名信息' })).toBeVisible()

  const database = createDatabaseClient(process.env.TEST_DATABASE_URL!)
  try {
    await database.db.update(users).set({ disabledAt: new Date() }).where(eq(users.role, 'user'))
    await page.reload(); await expect(page.getByText('账号已停用，当前会话已退出。')).toBeVisible()
    expect((await context.cookies()).some((cookie) => cookie.name === 'panshi_session')).toBe(false)
    expect((await database.db.select().from(sessions).where(isNotNull(sessions.revokedAt))).length).toBe(1)
    await page.reload(); await expect(page.getByText('请先登录后查看个人中心。')).toBeVisible()
  } finally { await database.close() }
})

test('employed applicant completes the role-specific fields and submits', async ({ page }) => {
  const employedPhone = `${phone.slice(0, -1)}${phone.endsWith('9') ? '8' : '9'}`
  await page.goto('/register'); await page.getByLabel('手机号').fill(employedPhone); await page.getByRole('button', { name: '获取验证码' }).click(); await page.getByLabel('验证码').fill(code); await page.getByRole('button', { name: '下一步' }).click(); await page.getByLabel('设置密码').fill(password); await page.getByLabel('确认密码').fill(password); await page.getByRole('button', { name: '创建账号' }).click(); await expect(page.getByRole('status')).toContainText('注册成功')
  await page.goto('/login'); await page.getByLabel('手机号').fill(employedPhone); await page.getByLabel('密码').fill(password); await page.getByRole('button', { name: '登录' }).click(); await expect(page.getByRole('status')).toContainText('登录成功')
  await page.goto('/application'); await expect(page.getByRole('heading', { name: '在线报名' })).toBeVisible(); await page.getByLabel('姓名').fill('企业科研人员'); expect(await page.getByLabel('电子邮箱').getAttribute('required')).toBeNull(); await page.getByLabel('当前身份').selectOption({ label: '在职人员' })
  await page.getByLabel('工作单位').fill('测试科技有限公司'); await page.getByLabel('职务／岗位').fill('研发负责人'); await page.getByLabel('专业技术职称等级').selectOption({ label: '副高级' }); await page.getByLabel('具体职称').fill('高级工程师'); await completeQuestions(page)
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '正式提交' }).click(); await expect(page.getByText('报名已提交，当前内容为只读。')).toBeVisible()
})
