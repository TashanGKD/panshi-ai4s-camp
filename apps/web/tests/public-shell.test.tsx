import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { PublicShell } from '../src/app/PublicShell'

const siteResponse = {
  apiVersion: 'v1',
  data: {
    contentVersion: 'fixture-free-shell',
    basic: {
      title: '磐石·科学智能（AI for Science）实训营',
      dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
      venue: '中国科学院物理研究所',
      tagline: '面向科研实践的五日科学智能集中实训',
      intro: ['接口活动简介'],
      target: '青年科研人员与学生',
    },
    importantDates: { items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }] },
    contacts: { items: [{ label: '报名咨询', value: 'camp@example.org' }] },
    display: { series: '磐石科学智能实训营', footer: '磐石·科学智能（AI for Science）实训营', registrationCta: { label: '立即报名', to: '/application' } },
    features: { items: [] }, organizations: { items: [] }, scheduleOverview: [],
    homeSectionOrder: ['intro', 'target', 'scale', 'features', 'scheduleOverview', 'organizations', 'registrationCta', 'registrationCount'],
    visibleNavigation: ['home', 'schedule', 'register', 'travel', 'contacts', 'resources', 'account'],
    registrationCta: { label: '立即报名', to: '/application' },
  },
}

const renderRoute = (path = '/') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => ({
    json: async () => String(input).includes('/api/v1/resources')
      ? { apiVersion: 'v1', data: { resources: [] } }
      : String(input).includes('/api/v1/public/statistics/applications') ? { apiVersion: 'v1', data: { visible: false } } : siteResponse,
    ok: true,
    status: 200,
  } as Response))
})

describe('public event shell', () => {
  it('renders the event banner, navigation, and shared sidebar', async () => {
    renderRoute()
    expect(await screen.findByRole('heading', { level: 1, name: /磐石.*科学智能/u })).toBeVisible()
    expect(screen.getByLabelText('活动信息')).toHaveTextContent('2026-08-23 至 2026-08-27')
    expect(screen.getByRole('navigation')).toHaveTextContent('实训日程')
    const sidebar = screen.getByRole('complementary')
    expect(sidebar).toHaveTextContent('重要日期')
    expect(sidebar).toHaveTextContent('报名咨询camp@example.org')
    expect(within(sidebar).getByRole('link', { name: '相关资料' })).toHaveAttribute('href', '/resources')
    expect(within(sidebar).getByRole('link', { name: '立即报名' })).toHaveAttribute('href', '/application')
  })

  it.each(['/register', '/login', '/forgot-password', '/account'])('uses the shared aside on auth and account route %s', async (path) => {
    renderRoute(path)
    expect(await screen.findByRole('complementary')).toHaveTextContent('报名咨询')
  })

  it('avoids registration and resources self-links inside the aside', async () => {
    const registration = render(<MemoryRouter initialEntries={['/application']}><PublicShell site={siteResponse.data as never}><p>报名表</p></PublicShell></MemoryRouter>)
    const registrationAside = screen.getByRole('complementary')
    expect(within(registrationAside).queryByRole('link', { name: '立即报名' })).not.toBeInTheDocument()
    registration.unmount()
    renderRoute('/resources')
    const resourcesAside = await screen.findByRole('complementary')
    expect(within(resourcesAside).queryByRole('link', { name: '相关资料' })).not.toBeInTheDocument()
  })

  it('provides the exact seven event routes and marks home current', async () => {
    renderRoute()
    const links = within(await screen.findByRole('navigation')).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['首页', '实训日程', '在线注册', '住宿交通', '联系我们', '相关资料', '个人中心'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/schedule', '/application', '/travel', '/contact', '/resources', '/account'])
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links.slice(1).every((link) => !link.hasAttribute('aria-current'))).toBe(true)
  })

  it('uses one h1 and semantic content, sidebar, and footer regions', async () => {
    const { container } = renderRoute()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('main')).toBeVisible()
    expect(screen.getByRole('contentinfo')).toBeVisible()
    expect(container.querySelector('main')?.nextElementSibling?.tagName).toBe('ASIDE')
  })

  it('offers a first-focus skip link that moves focus to home main content', async () => {
    const { container } = renderRoute()
    await screen.findByText('接口活动简介')
    const main = screen.getByRole('main')
    const skipLink = screen.getByRole('link', { name: '跳至主要内容' })
    expect(container.querySelector('a')).toBe(skipLink)
    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(main).toHaveAttribute('id', 'main-content')
    fireEvent.click(skipLink)
    expect(main).toHaveFocus()
  })

  it('offers the same skip target on secondary routes', async () => {
    const { container } = renderRoute('/resources')
    await screen.findByText('暂无当前账号可访问的资料。登录后或录取后可能开放更多资料。')
    const main = screen.getByRole('main')
    const skipLink = screen.getByRole('link', { name: '跳至主要内容' })
    expect(container.querySelector('a')).toBe(skipLink)
    fireEvent.click(skipLink)
    expect(main).toHaveFocus()
  })

  it('does not render the legacy or online-course shell', async () => {
    const { container } = renderRoute()
    await screen.findByRole('main')
    const pageText = container.textContent ?? ''
    expect(pageText).not.toContain('返回会议')
    expect(pageText).not.toContain('在线课程')
    expect(pageText).not.toContain('他山学科交叉')
    expect(container.querySelector('.header, .footer, .conf-banner-back')).not.toBeInTheDocument()
  })

  it('renders supplied API content without a local home fixture source', async () => {
    renderRoute()
    await screen.findByText('接口活动简介')
    expect(screen.getByRole('main')).toHaveTextContent('接口活动简介')
    expect(screen.queryByText(/稳定展示用 fixture/u)).not.toBeInTheDocument()
  })
})
