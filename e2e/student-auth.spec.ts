import { expect, test } from '@playwright/test'

const verificationCode = process.env.E2E_VERIFICATION_CODE
const registerPhone = process.env.E2E_REGISTER_PHONE
const registerPassword = process.env.E2E_REGISTER_PASSWORD
const resetPhone = process.env.E2E_RESET_PHONE
const resetPassword = process.env.E2E_RESET_PASSWORD
const resetNewPassword = process.env.E2E_RESET_NEW_PASSWORD

if (!verificationCode || !registerPhone || !registerPassword || !resetPhone || !resetPassword || !resetNewPassword) {
  throw new Error('Student auth E2E credentials must be supplied through the test environment')
}

test('student can register, log in, reset a password, and log in with the new password', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('手机号').fill(registerPhone)
  await page.getByRole('button', { name: '获取验证码' }).click()
  await page.getByLabel('验证码').fill(verificationCode)
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByLabel('设置密码').fill(registerPassword)
  await page.getByLabel('确认密码').fill(registerPassword)
  await page.getByRole('button', { name: '创建账号' }).click()
  await expect(page.getByRole('status')).toContainText('注册成功')

  await page.goto('/login')
  await page.getByLabel('手机号').fill(registerPhone)
  await page.getByLabel('密码').fill(registerPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('status')).toContainText('登录成功')

  await page.goto('/forgot-password')
  await page.getByLabel('手机号').fill(resetPhone)
  await page.getByRole('button', { name: '获取验证码' }).click()
  await page.getByLabel('验证码').fill(verificationCode)
  await page.getByLabel('新密码', { exact: true }).fill(resetNewPassword)
  await page.getByLabel('确认新密码').fill(resetNewPassword)
  await page.getByRole('button', { name: '重置密码' }).click()
  await expect(page.getByRole('status')).toContainText('密码已重置')

  await page.goto('/login')
  await page.getByLabel('手机号').fill(resetPhone)
  await page.getByLabel('密码').fill(resetPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toContainText('手机号或密码错误')
  await page.getByLabel('密码').fill(resetNewPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('status')).toContainText('登录成功')
})
