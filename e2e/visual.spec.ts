import { expect, test } from '@playwright/test'
import { PNG } from 'pngjs'

function expectPixelIdentical(actualBuffer: Buffer, expectedBuffer: Buffer, region: string) {
  const actual = PNG.sync.read(actualBuffer)
  const expected = PNG.sync.read(expectedBuffer)
  expect({ width: actual.width, height: actual.height }, `${region} dimensions`).toEqual({ width: expected.width, height: expected.height })
  let differentChannels = 0
  for (let index = 0; index < actual.data.length; index += 1) {
    if (actual.data[index] !== expected.data[index]) differentChannels += 1
  }
  expect(differentChannels, `${region} must have zero differing RGBA channels`).toBe(0)
}

const legacyReference = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--color-primary:#5B9BD5;--color-gray-light:#E9ECEF;--color-gray-dark:#495057;--color-dark:#0E2E4F;--gradient-primary:linear-gradient(135deg,#5B9BD5 0%,#9FD4C4 100%)}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Roboto','Oxygen','Ubuntu','Cantarell','Fira Sans','Droid Sans','Helvetica Neue',sans-serif}.container{max-width:1200px;width:100%;margin:0 auto;padding:0 24px;box-sizing:border-box}
.conf-banner{padding:116px 0 40px;color:#fff;background:linear-gradient(135deg,#0E2E4F 0%,#24507C 55%,#3E76AC 100%)}
.conf-banner-series{font-size:13.5px;color:rgba(255,255,255,.75);margin:0 0 8px}.conf-banner-name{font-size:30px;font-weight:800;line-height:1.4;margin:0 0 10px}.conf-banner-tagline{font-size:14.5px;color:rgba(255,255,255,.85);line-height:1.8;margin:0 0 18px;max-width:720px}.conf-banner-meta{display:flex;flex-wrap:wrap;gap:10px 22px;font-size:13.5px;align-items:center}
.conf-nav{position:sticky;top:72px;z-index:5;background:#fff;border-bottom:1px solid var(--color-gray-light);box-shadow:0 2px 8px rgba(14,46,79,.04)}.conf-nav-inner{display:flex;gap:4px;overflow-x:auto}.conf-nav a{padding:13px 16px;font-size:14px;font-weight:600;color:var(--color-gray-dark);text-decoration:none;border-bottom:2px solid transparent;white-space:nowrap}
.conf-sec{padding-top:44px}.conf-sec h2{font-size:21px;font-weight:800;color:var(--color-dark);margin:0 0 16px;padding-left:12px;position:relative}.conf-sec h2::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:4px;border-radius:2px;background:var(--gradient-primary)}
@media(max-width:640px){.conf-banner-name{font-size:23px}}
</style></head><body><section class="conf-banner"><div class="container"><p class="conf-banner-series">磐石科学智能实训营</p><h1 class="conf-banner-name">磐石·科学智能（AI for Science）实训营</h1><p class="conf-banner-tagline">面向科研实践的五日科学智能集中实训</p><div class="conf-banner-meta"><span>2026-08-23 至 2026-08-27</span><span>中国科学院物理研究所</span></div></div></section><nav class="conf-nav"><div class="container conf-nav-inner"><a>首页</a><a>实训日程</a><a>在线注册</a><a>住宿交通</a><a>联系我们</a><a>相关资料</a><a>个人中心</a></div></nav><main class="container"><section class="conf-sec"><h2>实训营简介</h2></section></main></body></html>`

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}html{scroll-behavior:auto!important}' })
  await page.evaluate(() => document.fonts.ready)
})

test('public home shell visual baseline', async ({ page }) => {
  await expect(page).toHaveScreenshot('public-home.png', { fullPage: true })
})

test('source-derived and migrated common regions are pixel-identical', async ({ page }, testInfo) => {
  const regions = [
    ['banner', '[data-testid="source-banner"]', '.migrated-reference .event-banner'],
    ['navigation', '[data-testid="source-navigation"]', '[data-testid="migrated-navigation"] .event-navigation'],
    ['section-heading', '[data-testid="source-section-heading"]', '[data-testid="migrated-section-heading"] .content-section__title'],
    ['compact-card', '[data-testid="source-compact-card"]', '[data-testid="migrated-compact-card"] .info-card'],
  ] as const
  const sourceImages = new Map<string, Buffer>()
  await page.goto('http://127.0.0.1:4174/?mode=source')
  await page.evaluate(() => document.fonts.ready)
  const viewportWidth = (await page.viewportSize())!.width
  const sourceWidths = await page.evaluate(() => ({
    banner: document.querySelector('.source-banner')!.getBoundingClientRect().width,
    bannerContainer: document.querySelector('.source-banner .source-container')!.getBoundingClientRect().width,
    navigation: document.querySelector('.source-nav')!.getBoundingClientRect().width,
  }))
  const containerWidth = Math.min(viewportWidth, 1200)
  expect(sourceWidths).toEqual({ banner: viewportWidth, bannerContainer: containerWidth, navigation: viewportWidth })
  for (const [region, sourceSelector] of regions) {
    sourceImages.set(region, await page.locator(sourceSelector).screenshot({ animations: 'disabled', path: testInfo.outputPath(`${region}-source.png`) }))
  }
  await page.goto('http://127.0.0.1:4174/?mode=migrated')
  await page.evaluate(() => document.fonts.ready)
  const migratedWidths = await page.evaluate(() => ({
    banner: document.querySelector('.event-banner')!.getBoundingClientRect().width,
    bannerContainer: document.querySelector('.event-banner .event-container')!.getBoundingClientRect().width,
    navigation: document.querySelector('.event-navigation')!.getBoundingClientRect().width,
  }))
  expect(migratedWidths).toEqual({ banner: viewportWidth, bannerContainer: containerWidth, navigation: viewportWidth })
  for (const [region, , migratedSelector] of regions) {
    const source = sourceImages.get(region)!
    const migrated = await page.locator(migratedSelector).screenshot({ animations: 'disabled', path: testInfo.outputPath(`${region}-migrated.png`) })
    await testInfo.attach(`${region}-source`, { body: source, contentType: 'image/png' })
    await testInfo.attach(`${region}-migrated`, { body: migrated, contentType: 'image/png' })
    expectPixelIdentical(migrated, source, region)
  }
})

test('source stylesheet cannot alter migrated production styles', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/?mode=migrated')
  const result = await page.evaluate(() => {
    const read = () => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
      return {
        bodyFont: style('body').fontFamily,
        bodyLineHeight: style('body').lineHeight,
        banner: [style('.event-banner').padding, style('.event-banner').backgroundImage, style('.event-banner').color],
        container: [style('.event-banner .event-container').paddingLeft, style('.event-banner .event-container').paddingTop],
        title: [style('.event-banner__title').fontSize, style('.event-banner__title').lineHeight],
        navigation: [style('.event-navigation').top, style('.event-navigation').backgroundColor, style('.event-navigation').boxShadow],
        heading: [style('.content-section__title').fontSize, style('.content-section__title').paddingLeft],
        card: [style('.info-card').padding, style('.info-card').border, style('.info-card').borderRadius],
      }
    }
    const before = read()
    const sourceStyle = [...document.querySelectorAll<HTMLStyleElement>('style[data-vite-dev-id]')]
      .find((element) => element.dataset.viteDevId?.endsWith('/e2e/harness/source-reference.css'))
    if (!sourceStyle?.sheet) throw new Error('source-reference.css style sheet not found')
    sourceStyle.sheet.disabled = true
    const withoutSource = read()
    return { before, withoutSource }
  })
  expect(result.before.bodyLineHeight).toBe('25.6px')
  expect(result.before).toEqual(result.withoutSource)
})

test('source reference selectors are scoped and wrappers only set width', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/?mode=migrated')
  const audit = await page.evaluate(() => {
    const sourceStyle = [...document.querySelectorAll<HTMLStyleElement>('style[data-vite-dev-id]')]
      .find((element) => element.dataset.viteDevId?.endsWith('/e2e/harness/source-reference.css'))
    if (!sourceStyle?.sheet) throw new Error('source-reference.css style sheet not found')
    const selectors: string[] = []
    const wrapperProperties: Record<string, string[]> = {}
    const collect = (rules: CSSRuleList) => {
      for (const rule of [...rules]) {
        if ('selectorText' in rule && 'style' in rule) {
          const styleRule = rule as CSSStyleRule
          selectors.push(styleRule.selectorText)
          if (styleRule.selectorText === '.comparison-grid' || styleRule.selectorText === '.comparison-column') {
            wrapperProperties[styleRule.selectorText] = [...styleRule.style]
          }
        }
        if ('cssRules' in rule) collect((rule as CSSMediaRule).cssRules)
      }
    }
    collect(sourceStyle.sheet.cssRules)
    return { selectors, wrapperProperties }
  })
  const wrapperSelectors = new Set(['.comparison-grid', '.comparison-column'])
  for (const selectorList of audit.selectors) {
    if (wrapperSelectors.has(selectorList)) continue
    expect(selectorList.split(',').every((selector) => selector.trim().startsWith('.source-reference'))).toBe(true)
    expect(selectorList).not.toContain('migrated')
  }
  expect(audit.wrapperProperties).toEqual({ '.comparison-grid': ['width'], '.comparison-column': ['width'] })
})

test('source-aligned common values are exact', async ({ page }) => {
  const desktop = (await page.viewportSize())!.width > 640
  const styles = await page.evaluate(() => {
    const style = (selector: string, pseudo?: string) => getComputedStyle(document.querySelector(selector)!, pseudo)
    return {
      bannerBackground: style('.event-banner').backgroundImage,
      bannerPaddingTop: style('.event-banner').paddingTop,
      bannerPaddingBottom: style('.event-banner').paddingBottom,
      containerMaxWidth: style('.event-container').maxWidth,
      containerPaddingLeft: style('.event-container').paddingLeft,
      titleFontSize: style('.event-banner__title').fontSize,
      titleLineHeight: style('.event-banner__title').lineHeight,
      navPosition: style('.event-navigation').position,
      navTop: style('.event-navigation').top,
      navBackground: style('.event-navigation').backgroundColor,
      sectionFontSize: style('.content-section__title').fontSize,
      markerWidth: style('.content-section__title', '::before').width,
      markerRadius: style('.content-section__title', '::before').borderRadius,
      cardBorder: style('.info-card--compact').border,
      cardRadius: style('.info-card--compact').borderRadius,
      cardShadow: style('.public-sidebar .info-card').boxShadow,
      navLinkPadding: style('.event-navigation__link').padding,
      sectionPaddingTop: style('.content-section').paddingTop,
      paragraphLineHeight: style('.content-section__body > p').lineHeight,
      sidebarDisplay: style('.public-sidebar').display,
      layoutDisplay: style('.public-layout').display,
    }
  })
  expect(styles.bannerBackground).toBe('linear-gradient(135deg, rgb(14, 46, 79) 0%, rgb(36, 80, 124) 55%, rgb(62, 118, 172) 100%)')
  expect(styles.bannerPaddingTop).toBe('44px')
  expect(styles.bannerPaddingBottom).toBe('40px')
  expect(styles.containerMaxWidth).toBe('1200px')
  expect(styles.containerPaddingLeft).toBe('24px')
  expect(styles.titleFontSize).toBe(desktop ? '30px' : '23px')
  expect(styles.titleLineHeight).toBe(desktop ? '42px' : '32.2px')
  expect(styles.navPosition).toBe('sticky')
  expect(styles.navTop).toBe('0px')
  expect(styles.navBackground).toBe('rgb(255, 255, 255)')
  expect(styles.sectionFontSize).toBe('21px')
  expect(styles.markerWidth).toBe('4px')
  expect(styles.markerRadius).toBe('2px')
  expect(styles.cardBorder).toBe('1px solid rgb(233, 236, 239)')
  expect(styles.cardRadius).toBe('20px')
  expect(styles.cardShadow).toBe('rgba(15, 46, 79, 0.08) 0px 2px 8px 0px')
  expect(styles.navLinkPadding).toBe('13px 16px')
  expect(styles.sectionPaddingTop).toBe('44px')
  expect(styles.paragraphLineHeight).toBe('28.5px')
  expect(styles.sidebarDisplay).toBe('grid')
  expect(styles.layoutDisplay).toBe(desktop ? 'grid' : 'flex')
})

test('navigation is keyboard visible and mobile sidebar follows content', async ({ page }) => {
  const skipLink = page.getByRole('link', { name: '跳至主要内容' })
  const hiddenSkipStyles = await skipLink.evaluate((link) => {
    const style = getComputedStyle(link)
    return { width: style.width, height: style.height, clipPath: style.clipPath }
  })
  expect(hiddenSkipStyles).toEqual({ width: '1px', height: '1px', clipPath: 'inset(50%)' })

  await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()
  const focusedSkipStyles = await skipLink.evaluate((link) => {
    const style = getComputedStyle(link)
    return { width: style.width, height: style.height, clipPath: style.clipPath }
  })
  expect(Number.parseFloat(focusedSkipStyles.width)).toBeGreaterThan(1)
  expect(Number.parseFloat(focusedSkipStyles.height)).toBeGreaterThan(1)
  expect(focusedSkipStyles.clipPath).toBe('none')
  await page.keyboard.press('Enter')
  const main = page.getByRole('main')
  await expect(main).toBeFocused()
  await expect(page).toHaveURL(/#main-content$/)

  await page.keyboard.press('Shift+Tab')
  const lastNavLink = page.getByRole('link', { name: '个人中心' })
  await expect(lastNavLink).toBeFocused()
  expect(await lastNavLink.evaluate((link) => getComputedStyle(link).outlineStyle)).toBe('solid')

  const firstLink = page.getByRole('link', { name: '首页' })
  await expect(firstLink).toHaveAttribute('aria-current', 'page')

  const ordering = await page.evaluate(() => {
    const main = document.querySelector('main')!
    const aside = document.querySelector('aside')!
    const nav = document.querySelector('.event-navigation')!
    return {
      asideAfterMain: Boolean(main.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING),
      asideTop: aside.getBoundingClientRect().top,
      mainBottom: main.getBoundingClientRect().bottom,
      asideLeft: aside.getBoundingClientRect().left,
      mainRight: main.getBoundingClientRect().right,
      navScrollable: nav.scrollWidth > nav.clientWidth,
      pageHasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  expect(ordering.asideAfterMain).toBe(true)
  expect(ordering.pageHasHorizontalOverflow).toBe(false)
  if ((await page.viewportSize())!.width <= 640) {
    expect(ordering.asideTop).toBeGreaterThanOrEqual(ordering.mainBottom)
    expect(ordering.navScrollable).toBe(true)
  } else {
    expect(ordering.asideLeft).toBeGreaterThanOrEqual(ordering.mainRight)
    expect(ordering.navScrollable).toBe(false)
  }
})

test('legacy common-region reference capture', async ({ page }) => {
  await page.setContent(legacyReference)
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('body')).toHaveScreenshot('legacy-common.png')
})

test('legacy reference CSS contract is active', async ({ page }) => {
  await page.setContent(legacyReference)
  const desktop = (await page.viewportSize())!.width > 640
  const styles = await page.evaluate(() => {
    const style = (selector: string, pseudo?: string) => getComputedStyle(document.querySelector(selector)!, pseudo)
    return {
      bannerGradient: style('.conf-banner').backgroundImage,
      titleFontSize: style('.conf-banner-name').fontSize,
      titleLineHeight: style('.conf-banner-name').lineHeight,
      navBackground: style('.conf-nav').backgroundColor,
      navShadow: style('.conf-nav').boxShadow,
      headingFontSize: style('.conf-sec h2').fontSize,
      markerWidth: style('.conf-sec h2', '::before').width,
      markerRadius: style('.conf-sec h2', '::before').borderRadius,
    }
  })
  expect(styles.bannerGradient).toBe('linear-gradient(135deg, rgb(14, 46, 79) 0%, rgb(36, 80, 124) 55%, rgb(62, 118, 172) 100%)')
  expect(styles.titleFontSize).toBe(desktop ? '30px' : '23px')
  expect(styles.titleLineHeight).toBe(desktop ? '42px' : '32.2px')
  expect(styles.navBackground).toBe('rgb(255, 255, 255)')
  expect(styles.navShadow).toBe('rgba(14, 46, 79, 0.04) 0px 2px 8px 0px')
  expect(styles.headingFontSize).toBe('21px')
  expect(styles.markerWidth).toBe('4px')
  expect(styles.markerRadius).toBe('2px')
})
