import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { Client } from 'pg'

const databaseUrl = process.env.TEST_DATABASE_URL!
const adminPhone = process.env.E2E_ADMIN_PHONE!
const adminPassword = process.env.E2E_ADMIN_PASSWORD!
const seedEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PUBLISHING_E2E: '1',
  E2E_ADMIN_PHONE: adminPhone,
  E2E_ADMIN_PASSWORD: adminPassword,
}

const runFixture = (operation: 'seed' | 'cleanup') => execFileSync('npm', [
  'run', 'e2e:publishing-fixture', '-w', '@panshi/api', '--', operation,
], { cwd: process.cwd(), env: seedEnvironment, stdio: 'pipe' })

test.beforeAll(() => runFixture('seed'))
test.afterAll(() => runFixture('cleanup'))

test('authenticated draft save -> preview -> publish -> rollback/audit and unauthorized preview', async ({ browser, page }) => {
  const anonymous = await browser.newPage()
  await anonymous.goto('http://127.0.0.1:4173/preview/basic')
  await expect(anonymous.getByRole('alert')).toContainText('请先登录管理后台')
  await expect(anonymous.getByText('E2E 草稿标题')).toHaveCount(0)
  await anonymous.close()

  await page.goto('/')
  await page.getByLabel('手机号').fill(adminPhone)
  await page.getByLabel('密码').fill(adminPassword)
  await page.getByRole('button', { name: '登录' }).click()
  const editor = page.getByLabel('内容 JSON')
  await expect(editor).toBeVisible()
  const payload = JSON.parse(await editor.inputValue())
  payload.title = 'E2E 草稿标题'
  payload.intro = ['E2E 草稿正文']
  await editor.fill(JSON.stringify(payload, null, 2))
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('草稿修订 1')).toBeVisible()

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '预览草稿' }).click()
  const preview = await popupPromise
  await expect(preview).toHaveURL('http://127.0.0.1:4173/preview/basic')
  await expect(preview.getByRole('heading', { level: 1, name: 'E2E 草稿标题' })).toBeVisible()
  expect(preview.url()).not.toMatch(/[?&](token|previewToken)=/u)
  await preview.close()

  await page.getByRole('button', { name: '发布当前草稿' }).click()
  await expect(page.getByText('版本 2（当前）')).toBeVisible()
  await page.getByRole('button', { name: '回退到版本 1' }).click()
  await expect(page.getByText('版本 3（当前）')).toBeVisible()

  const publicPage = await browser.newPage()
  await publicPage.goto('http://127.0.0.1:4173/')
  await expect(publicPage.getByRole('heading', { level: 1, name: 'E2E 初始标题' })).toBeVisible()
  await publicPage.close()

  const database = new Client({ connectionString: databaseUrl })
  await database.connect()
  try {
    const result = await database.query<{ action: string, metadata: unknown }>(`
      select action, metadata from audit_logs
      where entity_id = 'basic' and action in ('content.draft_saved', 'content.published', 'content.rolled_back')
      order by created_at
    `)
    expect(result.rows.map(({ action }) => action)).toEqual([
      'content.draft_saved', 'content.published', 'content.rolled_back',
    ])
    expect(JSON.stringify(result.rows)).not.toMatch(/E2E 草稿标题|E2E 草稿正文/u)
  } finally {
    await database.end()
  }
})
