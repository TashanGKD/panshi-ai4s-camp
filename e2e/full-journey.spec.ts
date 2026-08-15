import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runLaunchFixture } from '../apps/api/src/cli/launch-e2e-fixture'

const apiBase = 'http://127.0.0.1:3030'
const webBase = 'http://127.0.0.1:4200'
const adminOrigin = 'http://127.0.0.1:4201'
const adminBase = `${adminOrigin}/admin/`
const studentPhone = '+8613800000019'
const studentPassword = 'Launch-E2E-Student-19!'
const adminPhone = '+8613999999999'
const adminPassword = process.env.E2E_ADMIN_PASSWORD!
const verificationCode = process.env.E2E_VERIFICATION_CODE!
const evidenceDirectory = resolve('test-results/launch/evidence/launch-visual')
const pdf = Buffer.from('JVBERi0xLjcKJcOiw6PDj8OTCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iagoyIDAgb2JqCjw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbXSAvQ291bnQgMCA+PgplbmRvYmoKeHJlZgowIDMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSAzIC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxMjAKJSVFT0YK', 'base64')

test.beforeEach(async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  await runLaunchFixture('reset')
})

const expectPrivate = (response: APIResponse) => {
  expect(response.headers()['cache-control']).toBe('private, no-store')
  expect(response.headers().etag).toBeUndefined()
}

const loginAdmin = async (page: Page) => {
  await page.goto(adminBase)
  await page.getByLabel('手机号').fill(adminPhone)
  await page.getByLabel('密码').fill(adminPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible()
}

const registerAndLoginStudent = async (page: Page) => {
  await page.goto(`${webBase}/register`)
  await page.getByLabel('手机号').fill(studentPhone)
  await page.getByRole('button', { name: '获取验证码' }).click()
  await page.getByLabel('验证码').fill(verificationCode)
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByLabel('设置密码').fill(studentPassword)
  await page.getByLabel('确认密码').fill(studentPassword)
  await page.getByRole('button', { name: '创建账号' }).click()
  await expect(page.getByRole('status')).toContainText('注册成功')
  await page.goto(`${webBase}/login`)
  await page.getByLabel('手机号').fill(studentPhone)
  await page.getByLabel('密码').fill(studentPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('status')).toContainText('登录成功')
}

test.describe.serial('launch journey and visual acceptance', () => {
  test('real API journey persists publish, supplement, admission, bytes and public count', async ({ browser }) => {
    test.setTimeout(180_000)
    const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const admin = await adminContext.newPage()
    await loginAdmin(admin)

    const displayDraftResponse = await adminContext.request.get(`${apiBase}/api/v1/admin/content/display/draft`)
    expectPrivate(displayDraftResponse)
    const displayDraft = (await displayDraftResponse.json()).data
    const displaySaved = await adminContext.request.put(`${apiBase}/api/v1/admin/content/display/draft`, { headers: { Origin: adminOrigin }, data: { expectedRevision: displayDraft.revision, payload: { series: '磐石 E2E 实训营', footer: 'Task 19 全量验收', showRegistrationCount: true } } })
    expect(displaySaved.ok()).toBe(true)
    const displaySavedBody = await displaySaved.json()
    const displayPublished = await adminContext.request.post(`${apiBase}/api/v1/admin/content/display/publish`, { headers: { Origin: adminOrigin }, data: { expectedRevision: displaySavedBody.data.revision } })
    expect(displayPublished.ok()).toBe(true)
    await admin.getByRole('link', { name: '展示设置' }).click()
    await expect(admin.getByText(/已发布版本 2/u)).toBeVisible()

    const countBefore = await adminContext.request.get(`${apiBase}/api/v1/public/statistics/applications`)
    expect((await countBefore.json()).data).toEqual(expect.objectContaining({ visible: true, submittedCount: 0 }))
    const publicCount = await adminContext.newPage()
    await publicCount.goto(webBase)
    await expect(publicCount.getByLabel('报名人数').locator('strong')).toHaveText('0')
    await publicCount.close()

    const studentContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
    const student = await studentContext.newPage()
    await registerAndLoginStudent(student)
    await student.goto(`${webBase}/application`)
    await student.getByLabel('姓名').fill('任务十九学员')
    await student.getByLabel('电子邮箱').fill('task19@example.test')
    await student.getByLabel('所在单位').fill('中国科学院物理研究所')
    await student.getByLabel('院系/部门').fill('研究生部')
    await student.getByLabel('身份类型').fill('研究生')
    await student.getByLabel('学历阶段').fill('博士')
    await student.getByLabel('专业及研究方向').fill('AI for Science')
    await student.getByLabel(/拟解决的科研问题/u).fill('初版：用机器学习研究材料物性')
    await student.getByLabel(/个人简历/u).setInputFiles({ name: 'task19-resume.pdf', mimeType: 'application/pdf', buffer: pdf })
    await expect(student.getByText('task19-resume.pdf')).toBeVisible()
    await expect(student.getByText('草稿已保存', { exact: true })).toBeVisible()
    await student.reload()
    await expect(student.getByLabel(/拟解决的科研问题/u)).toHaveValue('初版：用机器学习研究材料物性')
    student.once('dialog', (dialog) => dialog.accept())
    await student.getByRole('button', { name: '正式提交' }).click()
    await expect(student.getByText('报名已提交，当前内容为只读。')).toBeVisible()

    await admin.getByRole('link', { name: '报名审核' }).click()
    await admin.getByRole('row').filter({ hasText: '任务十九学员' }).getByRole('link', { name: '查看审核' }).click()
    const applicationId = admin.url().split('/').at(-1)!
    await admin.getByLabel('目标状态').selectOption('reviewing')
    await admin.getByRole('button', { name: '确认更新状态' }).click()
    await expect(admin.locator('dl')).toContainText('reviewing')
    await admin.getByLabel('目标状态').selectOption('needs_supplement')
    await admin.getByLabel('面向学员的说明').fill('请补充研究计划，并替换附件')
    await admin.getByText('拟解决的科研问题').locator('input').check()
    await admin.getByText('个人简历／补充材料').locator('input').check()
    await admin.getByLabel('内部备注').fill('TASK19_INTERNAL_NOTE_DO_NOT_LEAK')
    await admin.getByRole('button', { name: '确认更新状态' }).click()
    await expect(admin.locator('dl')).toContainText('needs_supplement')

    await student.reload()
    await expect(student.getByText('请补充研究计划，并替换附件')).toBeVisible()
    await student.getByLabel(/拟解决的科研问题/u).fill('补充版：加入可复现实验与误差分析')
    await student.getByRole('button', { name: '删除并替换' }).click()
    await student.getByLabel(/个人简历/u).setInputFiles({ name: 'task19-supplement.pdf', mimeType: 'application/pdf', buffer: pdf })
    await expect(student.getByText('草稿已保存', { exact: true })).toBeVisible()
    student.once('dialog', (dialog) => dialog.accept())
    await student.getByRole('button', { name: '正式提交' }).click()
    await expect(student.getByText('报名已提交，当前内容为只读。')).toBeVisible()

    await admin.getByRole('link', { name: '报名审核' }).click()
    await Promise.all([
      admin.waitForResponse((response) => response.url() === `${apiBase}/api/v1/admin/applications/${applicationId}` && response.status() === 200),
      admin.getByRole('row').filter({ hasText: '任务十九学员' }).getByRole('link', { name: '查看审核' }).click(),
    ])
    await admin.getByLabel('目标状态').selectOption('admitted')
    await expect(admin.getByLabel('目标状态')).toHaveValue('admitted')
    await admin.getByLabel('内部备注').fill('补充材料已核验，准予录取')
    await admin.getByRole('button', { name: '确认更新状态' }).click()
    await expect(admin.locator('dl')).toContainText('admitted')

    await admin.getByRole('link', { name: '相关资料' }).click()
    await admin.getByLabel('标识').fill('task19-admitted-guide')
    await admin.getByLabel('标题').fill('Task 19 录取资料')
    await admin.getByLabel('访问范围').selectOption('admitted')
    await admin.getByLabel(/资料文件/u).setInputFiles({ name: 'task19-admitted.pdf', mimeType: 'application/pdf', buffer: pdf })
    await expect(admin.getByRole('status')).toContainText('文件已上传')
    await admin.getByRole('button', { name: '保存资料草稿' }).click()
    await expect(admin.getByRole('status')).toContainText('资料草稿已保存')
    await admin.getByRole('button', { name: '发布', exact: true }).click()
    await expect(admin.getByRole('status')).toContainText('资料已发布')

    await student.goto(`${webBase}/resources`)
    await expect(student.getByText('Task 19 录取资料', { exact: true })).toBeVisible()
    const [download] = await Promise.all([
      student.waitForEvent('download'),
      student.getByRole('listitem').filter({ hasText: 'Task 19 录取资料' }).getByRole('link', { name: '下载' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('task19-admitted.pdf')
    const downloadStream = await download.createReadStream()
    const downloadedChunks: Buffer[] = []
    for await (const chunk of downloadStream) downloadedChunks.push(Buffer.from(chunk))
    expect(Buffer.concat(downloadedChunks)).toEqual(pdf)

    const countAfter = await studentContext.request.get(`${apiBase}/api/v1/public/statistics/applications`)
    expect((await countAfter.json()).data).toEqual(expect.objectContaining({ visible: true, submittedCount: 1 }))
    await student.goto(webBase)
    await expect(student.getByLabel('报名人数').locator('strong')).toHaveText('1')

    const persistedResponse = await adminContext.request.get(`${apiBase}/api/v1/admin/applications/${applicationId}`)
    expectPrivate(persistedResponse)
    const persisted = (await persistedResponse.json()).data
    expect(persisted.application.status).toBe('admitted')
    expect(Object.values(persisted.application.answers)).toContain('补充版：加入可复现实验与误差分析')
    expect(persisted.attachments).toEqual([expect.objectContaining({ originalName: 'task19-supplement.pdf' })])

    await studentContext.close()
    await adminContext.close()
  })

  test('required public and admin pages are usable at all launch viewports', async ({ browser }) => {
    test.setTimeout(180_000)
    const viewports = [{ name: '1440x900', width: 1440, height: 900 }, { name: '1280x800', width: 1280, height: 800 }, { name: '390x844', width: 390, height: 844 }]
    const publicPages = [['home', '/'], ['schedule', '/schedule'], ['register', '/application'], ['transport', '/travel'], ['contact', '/contact'], ['resources', '/resources'], ['login', '/login'], ['profile', '/account']] as const
    const adminPages = [['dashboard', '', '工作台'], ['content', 'content/basic', '基本信息'], ['applications', 'applications', '报名审核'], ['resources', 'content/resources', '相关资料'], ['users', 'administrators', '管理员账号'], ['audit', 'audit-logs', '操作日志'], ['system', 'system-status', '系统状态']] as const
    await seedVisualAcceptanceData(browser)
    await mkdir(evidenceDirectory, { recursive: true })
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.width < 500 })
      const page = await context.newPage()
      await page.goto(`${webBase}/login`)
      await page.getByLabel('手机号').fill(studentPhone)
      await page.getByLabel('密码').fill(studentPassword)
      await page.getByRole('button', { name: '登录' }).click()
      for (const [name, path] of publicPages) await captureUsablePage(page, `${webBase}${path}`, `public-${name}-${viewport.name}`)
      await captureUsablePage(page, adminBase, `admin-login-${viewport.name}`, '磐石管理后台')
      await page.getByLabel('手机号').fill(adminPhone)
      await page.getByLabel('密码').fill(adminPassword)
      await page.getByRole('button', { name: '登录' }).click()
      await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible()
      for (const [name, path, heading] of adminPages) await captureUsablePage(page, `${adminBase}${path}`, `admin-${name}-${viewport.name}`, heading)
      await context.close()
    }
    const screenshots = [...publicPages.map(([name]) => `public-${name}`), 'admin-login', ...adminPages.map(([name]) => `admin-${name}`)]
      .flatMap((name) => viewports.map((viewport) => `${name}-${viewport.name}.png`)).sort()
    await writeFile(resolve(evidenceDirectory, 'current-run.json'), JSON.stringify({
      runToken: process.env.E2E_RUN_TOKEN,
      startedAt: process.env.E2E_RUN_STARTED_AT,
      completedAt: new Date().toISOString(),
      screenshots,
    }, null, 2))
  })
})

async function seedVisualAcceptanceData(browser: Browser) {
  const studentContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
  const student = await studentContext.newPage()
  await registerAndLoginStudent(student)
  await student.goto(`${webBase}/application`)
  await student.getByLabel('姓名').fill('视觉验收长列学员')
  await student.getByLabel('电子邮箱').fill('visual-wide-columns@example.test')
  await student.getByLabel('所在单位').fill('中国科学院超长名称人工智能与交叉科学联合研究中心')
  await student.getByLabel('院系/部门').fill('复杂系统与科学智能联合实验室')
  await student.getByLabel('身份类型').fill('青年科研人员')
  await student.getByLabel('学历阶段').fill('博士后研究阶段')
  await student.getByLabel('专业及研究方向').fill('AI for Science 与多尺度材料模拟')
  await student.getByLabel(/拟解决的科研问题/u).fill('构建可复现的跨尺度科学机器学习工作流，并系统评估误差传播。')
  await student.getByLabel(/个人简历/u).setInputFiles({ name: 'visual-wide-application.pdf', mimeType: 'application/pdf', buffer: pdf })
  await expect(student.getByText('草稿已保存', { exact: true })).toBeVisible()
  student.once('dialog', (dialog) => dialog.accept())
  await student.getByRole('button', { name: '正式提交' }).click()
  await expect(student.getByText('报名已提交，当前内容为只读。')).toBeVisible()
  await studentContext.close()

  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const admin = await adminContext.newPage()
  await loginAdmin(admin)
  const upload = await adminContext.request.post(`${apiBase}/api/v1/files`, { headers: { Origin: adminOrigin }, multipart: { purpose: 'resource', visibility: 'admitted', file: { name: 'visual-resource.pdf', mimeType: 'application/pdf', buffer: pdf } } })
  expect(upload.status()).toBe(201)
  const fileId = (await upload.json()).data.file.id
  const draft = await adminContext.request.post(`${apiBase}/api/v1/admin/resources`, { headers: { Origin: adminOrigin }, data: { key: 'visual-populated-resource', title: '视觉验收科学计算资料与长标题示例', description: '用于确认资料页面和审计页面在真实数据下可用。', fileId, accessScope: 'admitted', sortOrder: 19, expectedRevision: 0 } })
  expect(draft.status()).toBe(201)
  const resource = (await draft.json()).data.resource
  const published = await adminContext.request.post(`${apiBase}/api/v1/admin/resources/${resource.id}/publish`, { headers: { Origin: adminOrigin }, data: { expectedRevision: resource.revision } })
  expect(published.status()).toBe(200)
  await adminContext.close()
}

async function captureUsablePage(page: Page, url: string, name: string, expectedHeading?: string) {
  await page.goto(url)
  if (expectedHeading) await expect(page.getByRole('heading', { name: expectedHeading, exact: true })).toBeVisible()
  else await expect(page.locator('h1,h2').first()).toBeVisible()
  if (name.startsWith('public-')) {
    await expect(page.locator('.event-banner')).toBeVisible()
    await expect(page.locator('.event-navigation')).toBeVisible()
    const shellTokens = await page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
      return {
        banner: style('.event-banner').backgroundImage,
        title: [style('.event-banner__title').fontWeight, style('.event-banner__title').lineHeight],
        nav: [style('.event-navigation').position, style('.event-navigation').backgroundColor, style('.event-navigation').boxShadow],
        cards: [...document.querySelectorAll<HTMLElement>('.info-card')].map((card) => {
          const computed = getComputedStyle(card)
          return [computed.border, computed.borderRadius]
        }),
      }
    })
    expect(shellTokens.banner).toBe('linear-gradient(135deg, rgb(14, 46, 79) 0%, rgb(36, 80, 124) 55%, rgb(62, 118, 172) 100%)')
    expect(shellTokens.title).toEqual(['800', page.viewportSize()!.width <= 640 ? '32.2px' : '42px'])
    expect(shellTokens.nav).toEqual(['sticky', 'rgb(255, 255, 255)', 'rgba(14, 46, 79, 0.04) 0px 2px 8px 0px'])
    expect(shellTokens.cards.every(([border, radius]) => border === '1px solid rgb(233, 236, 239)' && radius === '20px')).toBe(true)
  }
  if (name.startsWith('public-home-')) await expect(page.locator('.info-card').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const audit = await page.evaluate(() => {
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    const critical = [...document.querySelectorAll<HTMLElement>('a,button,input,select,textarea,h1,h2')].filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && style.clipPath !== 'inset(50%)' && rect.width > 0 && rect.height > 0
    })
    const scrollers = [...document.querySelectorAll<HTMLElement>('.table-scroll')].map((container) => {
      const rect = container.getBoundingClientRect()
      const lastCell = container.querySelector<HTMLElement>('tbody tr:first-child td:last-child')
        ?? container.querySelector<HTMLElement>('thead tr:last-child th:last-child')
      const before = container.scrollLeft
      container.scrollLeft = container.scrollWidth
      lastCell?.scrollIntoView({ block: 'center', inline: 'nearest' })
      const lastRect = lastCell?.getBoundingClientRect()
      const lastAction = lastCell?.querySelector<HTMLElement>('a,button,input,select,textarea')
      const actionRect = lastAction?.getBoundingClientRect()
      const currentRect = container.getBoundingClientRect()
      const x = lastRect ? Math.max(lastRect.left, currentRect.left) + Math.min(lastRect.width, currentRect.right - Math.max(lastRect.left, currentRect.left)) / 2 : -1
      const y = lastRect ? lastRect.top + lastRect.height / 2 : -1
      const hit = lastCell ? document.elementFromPoint(x, y) : null
      const actionHit = actionRect ? document.elementFromPoint(actionRect.left + actionRect.width / 2, actionRect.top + actionRect.height / 2) : null
      const result = {
        withinViewport: rect.left >= -1 && rect.right <= viewport.width + 1,
        overflow: getComputedStyle(container).overflowX,
        scrollable: container.scrollWidth > container.clientWidth,
        reachedFarEdge: container.scrollLeft > before,
        lastCellVisible: Boolean(lastRect && lastRect.right <= currentRect.right + 1 && lastRect.left < currentRect.right && hit && (lastCell!.contains(hit) || hit.contains(lastCell!))),
        lastActionHit: Boolean(lastAction && actionRect && actionRect.left >= currentRect.left && actionRect.right <= currentRect.right + 1 && actionHit && (lastAction.contains(actionHit) || actionHit.contains(lastAction))),
        actionGeometry: actionRect ? { left: actionRect.left, right: actionRect.right, top: actionRect.top, bottom: actionRect.bottom, containerLeft: currentRect.left, containerRight: currentRect.right, hit: actionHit?.tagName ?? null } : null,
      }
      container.scrollLeft = before
      return result
    })
    return {
      overflow: document.documentElement.scrollWidth - viewport.width,
      clipped: critical.filter((element) => {
        const rect = element.getBoundingClientRect()
        const insideScroller = [...generateAncestors(element)].some((ancestor) => {
          const overflowX = getComputedStyle(ancestor).overflowX
          return ['auto', 'scroll'].includes(overflowX) && ancestor.scrollWidth > ancestor.clientWidth
        })
        return !insideScroller && (rect.left < -1 || rect.right > viewport.width + 1)
      }).map((element) => element.textContent?.trim() || element.getAttribute('aria-label') || element.tagName),
      tinyActions: critical.filter((element) => {
        if (!['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) return false
        const rect = element.getBoundingClientRect()
        const compactInput = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
        return rect.width < (compactInput ? 20 : 24) || rect.height < (compactInput ? 20 : 16)
      }).map((element) => {
        const rect = element.getBoundingClientRect()
        return `${element.textContent?.trim() || element.getAttribute('aria-label') || element.tagName}:${rect.width}x${rect.height}`
      }),
      scrollers,
    }
    function* generateAncestors(element: HTMLElement) {
      let current = element.parentElement
      while (current) { yield current; current = current.parentElement }
    }
  })
  expect(audit.overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(1)
  expect(audit.clipped, `${name} clipped critical elements`).toEqual([])
  expect(audit.tinyActions, `${name} unusable actions`).toEqual([])
  if (['admin-applications-390x844', 'admin-audit-390x844'].includes(name)) {
    expect(audit.scrollers.length, `${name} populated table scroller exists`).toBeGreaterThan(0)
    for (const scroller of audit.scrollers) {
      expect(scroller.scrollable, `${name} populated table is horizontally scrollable`).toBe(true)
      expect(scroller.lastActionHit, `${name} far-edge action hit-test ${JSON.stringify(scroller.actionGeometry)}`).toBe(true)
    }
  }
  for (const scroller of audit.scrollers) {
    expect(scroller.withinViewport, `${name} table scroller inside viewport`).toBe(true)
    expect(scroller.overflow, `${name} table overflow contract`).toBe('auto')
    if (scroller.scrollable) {
      expect(scroller.reachedFarEdge, `${name} table reaches far edge`).toBe(true)
      expect(scroller.lastCellVisible, `${name} far-edge cell hit-test`).toBe(true)
    }
  }
  const actions = page.locator('a:visible,button:visible,input:visible,select:visible,textarea:visible')
  for (let index = 0; index < Math.min(await actions.count(), 80); index += 1) {
    const action = actions.nth(index)
    if (await action.evaluate((element) => getComputedStyle(element).clipPath === 'inset(50%)')) continue
    await action.scrollIntoViewIfNeeded()
    const box = await action.boundingBox()
    if (!box) continue
    const compactInput = await action.evaluate((element) => element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type))
    expect(box.width, `${name} action ${index} width`).toBeGreaterThanOrEqual(compactInput ? 20 : 24)
    expect(box.height, `${name} action ${index} height`).toBeGreaterThanOrEqual(compactInput ? 20 : 16)
    const hit = await action.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(target && (element.contains(target) || target.contains(element)))
    })
    expect(hit, `${name} action ${index} center hit-test`).toBe(true)
  }
  await page.evaluate(() => {
    for (const scroller of document.querySelectorAll<HTMLElement>('.table-scroll')) scroller.scrollLeft = 0
    scrollTo(0, 0)
  })
  await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`), fullPage: false, animations: 'disabled' })
}
