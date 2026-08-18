import { act, render, screen, within } from '@testing-library/react'
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
      eventDetails: ['举办时间：2026年9月4日至9月8日。', '举办地点：主会场设在中国科学院物理研究所，本方案所列课程、研讨与交流等日程均在主会场开展；中国科学院大学雁栖湖校区另设分会场，另行开展研讨与交流活动。'],
      registrationAndAccommodation: ['本次实训营不收取注册费，食宿自理。'],
      signature: { organization: '磐石·科学智能实训营会务组', date: '2026年8月18日' },
    },
    importantDates: { items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }] },
    contacts: { items: [] },
    features: { items: [{ title: '系统认知', description: '建立系统化知识框架。' }] },
    organizations: { items: [{ role: '主办单位', name: '中国科学院物理研究所' }] },
    guests: [{
      id: 'zeng-dajun', name: '曾大军', title: '研究员、博士生导师', affiliation: '中国科学院自动化研究所副所长',
      bio: '研究方向包括情报与安全信息学、传染病信息学与应急管理、经济与社会计算。',
      image: { src: '/images/guests/zeng-dajun.jpg', alt: '曾大军研究员' },
      profileUrl: 'https://www.ia.cas.cn/rcdw/yjy/202404/t20240425_7131769.html',
    }],
    scheduleOverview: [
      { date: '2026-09-03', label: '9.3（周四）', theme: '学员报到' },
      { date: '2026-09-04', label: '9.4（周五）', theme: '专题一 科研智能体' },
    ],
    homeSectionOrder: ['intro', 'features', 'eventDetails', 'scheduleOverview', 'guests', 'organizations', 'registrationAndAccommodation'],
    display: { series: '磐石科学智能实训营', footer: '接口活动标题', homeSectionOrder: ['intro', 'features', 'eventDetails', 'scheduleOverview', 'guests', 'organizations', 'registrationAndAccommodation'] },
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
            time: '全天',
            timeRange: { start: '00:00', end: '23:59' },
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
  travel,
}: {
  site?: unknown
  schedule?: unknown
  travelStatus?: number
  travel?: unknown
} = {}) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
  const path = requestPath(input)
  if (path.endsWith('/api/v1/public/site')) return jsonResponse(site)
  if (path.endsWith('/api/v1/public/schedule')) return jsonResponse(schedule)
  if (path.endsWith('/api/v1/public/content/travel')) return travel
    ? jsonResponse({ apiVersion: 'v1', data: { key: 'travel', contentVersion: 'travel:1', payload: travel } })
    : jsonResponse({ error: {} }, travelStatus)
  if (path.endsWith('/api/v1/resources')) return jsonResponse({ apiVersion: 'v1', data: { resources: [] } })
  if (path.endsWith('/api/v1/public/statistics/applications')) return jsonResponse({ apiVersion: 'v1', data: { visible: false } })
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

  it('renders the seven numbered homepage sections, invited guest profile and right-aligned signature in the configured order', async () => {
    installFetch()

    renderRoute('/')

    await screen.findByRole('heading', { level: 1, name: '接口活动标题' })
    const headings = within(screen.getByRole('main')).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['一、实训营简介', '二、实训营特色', '三、举办时间、地点与规模', '四、日程安排', '五、特邀嘉宾', '六、组织单位', '七、注册与食宿'])
    expect(screen.getByRole('img', { name: '曾大军研究员' })).toHaveAttribute('src', '/images/guests/zeng-dajun.jpg')
    expect(screen.getByRole('heading', { level: 3, name: '曾大军' })).toBeVisible()
    expect(screen.getByText('研究员、博士生导师')).toBeVisible()
    expect(screen.getByRole('main')).toHaveTextContent('中国科学院自动化研究所副所长')
    expect(screen.getByRole('main')).toHaveTextContent('举办时间：2026年9月4日至9月8日。')
    expect(screen.getByRole('main')).toHaveTextContent('举办地点：主会场设在中国科学院物理研究所，本方案所列课程、研讨与交流等日程均在主会场开展；中国科学院大学雁栖湖校区另设分会场，另行开展研讨与交流活动。')
    expect(screen.getByRole('main')).toHaveTextContent('本次实训营不收取注册费，食宿自理。')
    expect([...document.querySelectorAll('.schedule-overview__marker')].map((marker) => marker.textContent)).toEqual(['00', '01'])
    const signature = screen.getByText('磐石·科学智能实训营会务组').closest('.event-signature')
    expect(signature).toHaveTextContent('2026年8月18日')
  })

  it('loads schedule from its separate public endpoint', async () => {
    const fetchSpy = installFetch()

    renderRoute('/schedule')

    await screen.findByRole('cell', { name: '智能体构建实践' })
    expect(screen.getByRole('heading', { level: 2, name: '实训日程' })).toBeVisible()
    expect(screen.getByRole('main')).toHaveTextContent('科研智能体')
    expect(screen.getByRole('main')).toHaveTextContent('参访交流与结营')
    expect(screen.getByRole('columnheader', { name: '日期 / 专题' })).toBeVisible()
    expect(screen.queryByRole('columnheader', { name: '内容要点与学员成果' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.getByRole('columnheader', { name: '组织单位/授课师资' })).toBeVisible()
    expect(screen.getByRole('cell', { name: '智能体构建实践' })).toBeVisible()
    expect(screen.getByText('全天')).toBeVisible()
    expect(screen.queryByText('00:00–23:59')).not.toBeInTheDocument()
    expect(screen.queryByText('核验工具调用结果')).not.toBeInTheDocument()
    expect(screen.getByText('李老师')).toBeVisible()
    expect(fetchSpy.mock.calls.map(([input]) => requestPath(input))).toEqual(expect.arrayContaining([
      '/api/v1/public/site',
      '/api/v1/public/schedule',
    ]))
  })

  it.each([
    ['/contact', '联系信息尚未发布'],
    ['/travel', '交通与住宿信息尚未发布'],
  ])('renders a truthful empty state on %s', async (path, message) => {
    installFetch()

    renderRoute(path)

    expect(await screen.findByText(message)).toBeVisible()
    expect(screen.queryByText(/138\d{8}|@|报名截止.*2026/u)).not.toBeInTheDocument()
  })

  it('renders the published travel guide and venue map', async () => {
    installFetch({ travel: { sections: [{
      title: '实训营地址',
      body: '<p><strong>实训营地点：</strong>中国科学院物理研究所</p><p><strong>地址：</strong>北京市海淀区中关村南三街8号。</p>',
      image: { src: '/images/iop-zhongguancun-location-map.png', alt: '物理所区位示意图', caption: '区位示意图' },
    }] } })

    renderRoute('/travel')

    const addressHeading = await screen.findByRole('heading', { level: 3, name: '实训营地址' })
    const addressSection = addressHeading.closest('article')
    expect(addressSection).not.toBeNull()
    expect(within(addressSection!).getByText('中国科学院物理研究所')).toBeVisible()
    expect(within(addressSection!).getByText('北京市海淀区中关村南三街8号。')).toBeVisible()
    expect(within(addressSection!).getByRole('img', { name: '物理所区位示意图' })).toHaveAttribute('src', '/images/iop-zhongguancun-location-map.png')
    expect(within(addressSection!).getByText('区位示意图')).toBeVisible()
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

    const contactName = (await screen.findAllByText('测试联系人')).find((element) => element.closest('main'))
    expect(contactName).toBeVisible()
    const pageContent = within(contactName!.closest('main')!)
    expect(pageContent.getByText('课程咨询')).toBeVisible()
    expect(pageContent.getByRole('link', { name: '+8613800138000' })).toHaveAttribute('href', 'tel:+8613800138000')
    expect(pageContent.getByRole('link', { name: 'test@example.com' })).toHaveAttribute('href', 'mailto:test@example.com')
    expect(pageContent.getByText('工作日回复')).toBeVisible()
  })

  it('does not render ResourcesPage until the shared site request succeeds', async () => {
    let resolveSite: ((response: Response) => void) | undefined
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => requestPath(input).endsWith('/api/v1/public/site')
      ? new Promise((resolve) => { resolveSite = resolve })
      : Promise.resolve(jsonResponse({ apiVersion: 'v1', data: { resources: [] } })))

    renderRoute('/resources')

    expect(screen.getByRole('status')).toHaveTextContent('正在加载活动信息')
    expect(screen.queryByRole('heading', { level: 2, name: '相关资料' })).not.toBeInTheDocument()
    await act(async () => resolveSite?.(jsonResponse(siteResponse)))
    expect(await screen.findByText('暂无当前账号可访问的资料。登录后或录取后可能开放更多资料。')).toBeVisible()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['network', () => Promise.reject(new Error('network unavailable'))],
    ['schema', () => Promise.resolve(jsonResponse({ apiVersion: 'v1', data: {} }))],
  ])('keeps a %s site failure at the top-level Resources route boundary', async (_kind, failingResponse) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(failingResponse)

    renderRoute('/resources')

    expect(await screen.findByRole('alert')).toHaveTextContent('活动信息暂时无法加载')
    expect(screen.queryByText('暂无当前账号可访问的资料。登录后或录取后可能开放更多资料。')).not.toBeInTheDocument()
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
