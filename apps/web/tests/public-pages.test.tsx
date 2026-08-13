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
        { date: '2026-08-23', label: '第一天', theme: '科研智能体', sessions: [] },
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

    expect(await screen.findByRole('heading', { level: 2, name: '实训日程' })).toBeVisible()
    await screen.findByText('科研智能体')
    expect(screen.getByRole('main')).toHaveTextContent('科研智能体')
    expect(screen.getByRole('main')).toHaveTextContent('参访交流与结营')
    expect(fetchSpy.mock.calls.map(([input]) => requestPath(input))).toEqual(expect.arrayContaining([
      '/api/v1/public/site',
      '/api/v1/public/schedule',
    ]))
  })

  it.each([
    ['/contact', '联系信息尚未发布'],
    ['/travel', '住宿与交通信息尚未发布'],
    ['/resources', '相关资料尚未发布'],
  ])('renders a truthful empty state on %s', async (path, message) => {
    installFetch()

    renderRoute(path)

    expect(await screen.findByText(message)).toBeVisible()
    expect(screen.queryByText(/138\d{8}|@|报名截止.*2026/u)).not.toBeInTheDocument()
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
