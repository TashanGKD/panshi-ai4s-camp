import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'

const siteResponse = {
  apiVersion: 'v1',
  data: {
    contentVersion: 'basic:1,importantDates:1,contacts:1,display:1',
    basic: {
      title: '接口活动标题',
      dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
      venue: '中国科学院物理研究所',
      intro: ['接口活动简介'],
      target: '青年科研人员与学生',
    },
    importantDates: { items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }] },
    contacts: { items: [] },
    display: { series: '磐石科学智能实训营', footer: '接口活动标题' },
  },
}

const scheduleResponse = {
  apiVersion: 'v1',
  data: {
    contentVersion: 'schedule:1',
    schedule: {
      days: [
        {
          date: '2026-08-23',
          label: '第一天',
          theme: '科研智能体',
          sessions: [{
            title: '智能体构建实践',
            time: '09:00–10:30',
            details: ['从科研问题定义任务', '核验工具调用结果'],
            instructors: ['张老师', '李老师'],
          }],
        },
        { date: '2026-08-27', label: '第五天', theme: '参访交流与结营', sessions: [] },
      ],
    },
  },
}

const jsonResponse = (body: unknown, status = 200) => ({
  json: async () => body,
  ok: status >= 200 && status < 300,
  status,
}) as Response

const requestPath = (input: RequestInfo | URL) => typeof input === 'string'
  ? input
  : input instanceof URL ? input.pathname : new URL(input.url).pathname

const installFetch = ({
  site = siteResponse,
  schedule = scheduleResponse,
  travelStatus = 404,
}: {
  site?: unknown
  schedule?: unknown
  travelStatus?: number
} = {}) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
  const path = requestPath(input)
  if (path.endsWith('/api/v1/public/site')) return jsonResponse(site)
  if (path.endsWith('/api/v1/public/schedule')) return jsonResponse(schedule)
  if (path.endsWith('/api/v1/public/content/travel')) return jsonResponse({ error: {} }, travelStatus)
  throw new Error(`Unexpected request: ${path}`)
})

const renderRoute = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

describe('API-driven public pages', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders home dates and contacts from the shared public site response', async () => {
    const fetchSpy = installFetch()

    renderRoute('/')

    expect(screen.getByRole('status')).toHaveTextContent('正在加载活动信息')
    expect(await screen.findByRole('heading', { level: 1, name: '接口活动标题' })).toBeVisible()
    expect(screen.getByRole('main')).toHaveTextContent('接口活动简介')
    expect(screen.getByRole('complementary')).toHaveTextContent('2026-08-23 至 2026-08-27')
    expect(screen.getByRole('complementary')).not.toHaveTextContent('报名截止')
    expect(screen.getByRole('complementary')).not.toHaveTextContent('联系方式待公布')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('loads schedule from its separate public endpoint', async () => {
    const fetchSpy = installFetch()

    renderRoute('/schedule')

    await screen.findByRole('heading', { level: 4, name: '智能体构建实践' })
    expect(screen.getByRole('heading', { level: 2, name: '实训日程' })).toBeVisible()
    expect(screen.getByRole('main')).toHaveTextContent('科研智能体')
    expect(screen.getByRole('main')).toHaveTextContent('参访交流与结营')
    expect(screen.getByRole('heading', { level: 4, name: '智能体构建实践' })).toBeVisible()
    expect(screen.getByText('09:00–10:30')).toBeVisible()
    expect(screen.getByRole('heading', { level: 5, name: '课程详情' })).toBeVisible()
    expect(screen.getByText('核验工具调用结果')).toBeVisible()
    expect(screen.getByRole('heading', { level: 5, name: '授课教师' })).toBeVisible()
    expect(screen.getByText('李老师')).toBeVisible()
    expect(fetchSpy.mock.calls.map(([input]) => requestPath(input))).toEqual(expect.arrayContaining([
      '/api/v1/public/site',
      '/api/v1/public/schedule',
    ]))
  })

  it.each([
    ['/contact', '联系信息尚未发布'],
    ['/travel', '住宿与交通信息尚未发布'],
  ])('renders a truthful empty state on %s', async (path, message) => {
    installFetch()

    renderRoute(path)

    expect(await screen.findByText(message)).toBeVisible()
    expect(screen.queryByText(/138\d{8}|@|报名截止.*2026/u)).not.toBeInTheDocument()
  })

  it('renders structured contact names, responsibilities, methods, and consultation notes', async () => {
    installFetch({ site: {
      ...siteResponse,
      data: {
        ...siteResponse.data,
        contacts: { items: [{
          name: '测试联系人', responsibility: '课程咨询',
          methods: [{ type: 'phone', value: '+8613800138000' }, { type: 'email', value: 'test@example.com' }],
          consultationNote: '工作日回复',
        }] },
      },
    } })

    renderRoute('/contact')

    expect(await screen.findByText('测试联系人')).toBeVisible()
    expect(screen.getByText('课程咨询')).toBeVisible()
    expect(screen.getByRole('link', { name: '+8613800138000' })).toHaveAttribute('href', 'tel:+8613800138000')
    expect(screen.getByRole('link', { name: 'test@example.com' })).toHaveAttribute('href', 'mailto:test@example.com')
    expect(screen.getByText('工作日回复')).toBeVisible()
  })

  it('does not render ResourcesPage until the shared site request succeeds', async () => {
    let resolveSite: ((response: Response) => void) | undefined
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
      resolveSite = resolve
    }))

    renderRoute('/resources')

    expect(screen.getByRole('status')).toHaveTextContent('正在加载活动信息')
    expect(screen.queryByRole('heading', { level: 2, name: '相关资料' })).not.toBeInTheDocument()
    await act(async () => resolveSite?.(jsonResponse(siteResponse)))
    expect(await screen.findByText('相关资料尚未发布')).toBeVisible()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['network', () => Promise.reject(new Error('network unavailable'))],
    ['schema', () => Promise.resolve(jsonResponse({ apiVersion: 'v1', data: {} }))],
  ])('keeps a %s site failure at the top-level Resources route boundary', async (_kind, failingResponse) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(failingResponse)

    renderRoute('/resources')

    expect(await screen.findByRole('alert')).toHaveTextContent('活动信息暂时无法加载')
    expect(screen.queryByText('相关资料尚未发布')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('renders a controlled error state when public content cannot be loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500))

    renderRoute('/')

    expect(await screen.findByRole('alert')).toHaveTextContent('活动信息暂时无法加载')
    expect(screen.queryByText('接口活动标题')).not.toBeInTheDocument()
  })

  it('keeps the loading state until the public site request settles', async () => {
    let resolveRequest: ((response: Response) => void) | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))

    renderRoute('/contact')
    expect(screen.getByRole('status')).toHaveTextContent('正在加载活动信息')

    await act(async () => resolveRequest?.(jsonResponse(siteResponse)))
    expect(await screen.findByText('联系信息尚未发布')).toBeVisible()
  })
})
