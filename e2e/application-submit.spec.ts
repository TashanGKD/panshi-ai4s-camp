import { expect, test } from '@playwright/test'

const phone = process.env.E2E_REGISTER_PHONE!
const password = process.env.E2E_REGISTER_PASSWORD!
const code = process.env.E2E_VERIFICATION_CODE!
const pdf = Buffer.from('JVBERi0xLjcKJcOiw6PDj8OTCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iagoyIDAgb2JqCjw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbXSAvQ291bnQgMCA+PgplbmRvYmoKeHJlZgowIDMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSAzIC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxMjAKJSVFT0YK', 'base64')

test('student restores a draft, uploads an attachment, submits, and sees a locked account view', async ({ page }) => {
  await page.goto('/register'); await page.getByLabel('手机号').fill(phone); await page.getByRole('button', { name: '获取验证码' }).click(); await page.getByLabel('验证码').fill(code); await page.getByRole('button', { name: '下一步' }).click(); await page.getByLabel('设置密码').fill(password); await page.getByLabel('确认密码').fill(password); await page.getByRole('button', { name: '创建账号' }).click(); await expect(page.getByRole('status')).toContainText('注册成功')
  await page.goto('/login'); await page.getByLabel('手机号').fill(phone); await page.getByLabel('密码').fill(password); await page.getByRole('button', { name: '登录' }).click(); await expect(page.getByRole('status')).toContainText('登录成功')
  await page.goto('/application'); await expect(page.getByRole('heading', { name: '在线报名' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '正式提交' }).click(); await expect(page.getByRole('alert')).toContainText('请完成')
  await page.getByLabel('姓名').fill('张三'); await page.getByLabel('电子邮箱').fill('z@example.com'); await page.getByLabel('所在单位').fill('中国科学院物理研究所'); await page.getByLabel('院系/部门').fill('研究生部'); await page.getByLabel('身份类型').fill('研究生'); await page.getByLabel('学历阶段').fill('博士'); await page.getByLabel('专业及研究方向').fill('凝聚态物理'); await page.getByLabel(/拟解决的科研问题/u).fill('使用人工智能研究材料物性')
  await page.getByLabel(/个人简历/u).setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: pdf })
  await expect(page.getByText('resume.pdf')).toBeVisible(); await expect(page.getByRole('status')).toContainText('草稿已保存')
  await page.reload(); await expect(page.getByLabel(/拟解决的科研问题/u)).toHaveValue('使用人工智能研究材料物性'); await expect(page.getByText('resume.pdf')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '正式提交' }).click(); await expect(page.getByText('报名已提交，当前内容为只读。')).toBeVisible(); await expect(page.getByLabel(/拟解决的科研问题/u)).toBeDisabled()
  await page.goto('/account'); await expect(page.getByRole('heading', { name: '个人中心' })).toBeVisible(); await expect(page.getByRole('definition').filter({ hasText: '已提交' })).toBeVisible(); await expect(page.getByRole('link', { name: '查看报名信息' })).toBeVisible()
})
