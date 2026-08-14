import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient } from '../src/api/admin-client'
import { AdminApiError } from '../src/api/admin-client'
import { AdminApp } from '../src/app/AdminApp'

afterEach(cleanup)

const drafts = {
  basic: { title: '旧标题', dates: { start: '2026-08-23', end: '2026-08-27', label: '8月23日至27日' }, venue: '物理所', intro: ['<p>旧简介</p>'] },
  features: { items: [{ title: '系统课程', description: '<p>课程说明</p>' }, { title: '真实问题', description: '<p>问题说明</p>' }] },
  organizations: { items: [{ role: '主办单位', name: '中国科学院物理研究所' }] },
  importantDates: { items: [{ label: '报名截止', value: '2026-08-15', machineKey: 'registrationDeadline' }] },
  schedule: { speakers: [{ id: 'speaker-1', name: '张老师' }], days: [{ date: '2026-08-23', label: '第一天', theme: '科研智能体', sessions: [] }] },
  contacts: { items: [{ name: '会务组', responsibility: '报名咨询', methods: [{ type: 'email', value: 'camp@example.com' }] }] },
  travel: { sections: [{ title: '交通路线', body: '<p>乘坐地铁抵达。</p>' }] },
  display: { series: '磐石科学智能实训营', footer: '实训营', showRegistrationCount: false, visibleNavigation: ['home', 'schedule'] },
} as const

const summary = {
  apiVersion: 'v1' as const,
  data: {
    applications: { total: 0, pendingReview: 0, byStatus: { draft: 0, submitted: 0, reviewing: 0, needs_supplement: 0, admitted: 0, waitlisted: 0, rejected: 0 } },
    upcomingDates: [], unpublishedDrafts: [], recentOperations: [],
  },
}

const client = (overrides: Partial<AdminClient> = {}): AdminClient => ({
  getProfile: async () => ({ apiVersion: 'v1', data: { user: { id: 'a1', displayName: '管理员', phoneNormalized: '+8613800138000', role: 'admin' } } }),
  login: async () => ({ apiVersion: 'v1', data: { user: { id: 'a1', displayName: '管理员', role: 'admin' } } }),
  logout: async () => undefined,
  getSummary: async () => summary,
  getDraft: async (key) => ({ apiVersion: 'v1', data: { key, revision: 1, payload: drafts[key], publishedVersion: 1 } }),
  saveDraft: async (key, payload) => ({ apiVersion: 'v1', data: { key, revision: 2, payload, publishedVersion: 1 } }),
  getPreview: async (key) => ({ apiVersion: 'v1', data: { key, revision: 1, payload: drafts[key] } }),
  publish: async (key) => ({ apiVersion: 'v1', data: { key, revision: 1, version: 2 } }),
  getHistory: async (key) => ({ apiVersion: 'v1', data: { key, publishedVersion: 1, versions: [] } }),
  rollback: async (key, version) => ({ apiVersion: 'v1', data: { key, revision: 1, version: 2, sourceVersion: version } }),
  ...overrides,
})

const renderAdmin = (api = client(), route = '/') => render(
  <MemoryRouter initialEntries={[route]}><AdminApp client={api} publicWebBaseUrl="https://camp.example" /></MemoryRouter>,
)

describe('content workbench', () => {
  it('provides the complete business navigation and a truthful resource placeholder', async () => {
    renderAdmin()
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeVisible()
    for (const name of ['基本信息', '实训特色', '组织单位', '重要日期', '实训日程与师资', '住宿交通', '联系方式', '相关资料', '展示设置']) {
      expect(screen.getByRole('link', { name })).toBeVisible()
    }
    fireEvent.click(screen.getByRole('link', { name: '相关资料' }))
    expect(await screen.findByText('资料管理将在 Task 15 建设')).toBeVisible()
  })

  it('renders real zero-value summary states instead of invented metrics', async () => {
    renderAdmin()
    expect(await screen.findByText('报名总量')).toBeVisible()
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getByText('暂无临近重要日期')).toBeVisible()
    expect(screen.getByText('暂无未发布草稿')).toBeVisible()
    expect(screen.getByText('暂无最近操作')).toBeVisible()
  })

  it('uses a structured basic-information form and saves the loaded revision', async () => {
    const saveDraft = vi.fn(client().saveDraft)
    renderAdmin(client({ saveDraft }), '/content/basic')
    const title = await screen.findByLabelText('实训营名称')
    fireEvent.change(title, { target: { value: '新标题' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('basic', expect.objectContaining({ title: '新标题' }), 1))
    expect(screen.queryByLabelText(/内容 JSON/u)).not.toBeInTheDocument()
  })

  it('supports accessible collection ordering, adding and deletion', async () => {
    renderAdmin(client(), '/content/features')
    expect(await screen.findByDisplayValue('系统课程')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '下移“系统课程”' }))
    let items = screen.getAllByTestId('feature-item')
    expect(within(items[0]!).getByDisplayValue('真实问题')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '添加特色' }))
    items = screen.getAllByTestId('feature-item')
    expect(items).toHaveLength(3)
    fireEvent.click(within(items[2]!).getByRole('button', { name: '删除特色' }))
    expect(screen.getAllByTestId('feature-item')).toHaveLength(2)
  })

  it('sanitizes rich text before saving', async () => {
    const saveDraft = vi.fn(client().saveDraft)
    renderAdmin(client({ saveDraft }), '/content/travel')
    const editor = await screen.findByRole('textbox', { name: '交通路线内容' })
    editor.innerHTML = '<p onclick="steal()">路线</p><script>alert(1)</script><a href="javascript:alert(2)">危险</a><iframe src="https://evil.example"></iframe>'
    fireEvent.input(editor)
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalled())
    const payload = saveDraft.mock.calls[0]?.[1]
    expect(JSON.stringify(payload)).toContain('<p>路线</p>')
    expect(JSON.stringify(payload)).not.toMatch(/script|iframe|onclick|javascript:/iu)
  })

  it('sanitizes untouched rich text loaded from an existing draft before saving', async () => {
    const saveDraft = vi.fn(client().saveDraft)
    const getDraft = vi.fn(async (key: Parameters<AdminClient['getDraft']>[0]) => ({
      apiVersion: 'v1' as const,
      data: { key, revision: 1, publishedVersion: null, payload: { sections: [{ title: '交通路线', body: '<p onmouseover="bad()">路线</p><iframe src="https://evil.example"></iframe>' }] } },
    }))
    renderAdmin(client({ getDraft, saveDraft }), '/content/travel')
    await screen.findByRole('textbox', { name: '交通路线内容' })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalled())
    expect(JSON.stringify(saveDraft.mock.calls[0]?.[1])).not.toMatch(/onmouseover|iframe/iu)
  })

  it('shows an explicit revision conflict and prevents duplicate saves', async () => {
    let reject!: (error: unknown) => void
    const saveDraft = vi.fn(() => new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise }))
    renderAdmin(client({ saveDraft }), '/content/basic')
    await screen.findByLabelText('实训营名称')
    const button = screen.getByRole('button', { name: '保存草稿' })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(saveDraft).toHaveBeenCalledTimes(1)
    reject(new AdminApiError(409, '内容已被其他管理员修改', 'CONTENT_CONFLICT'))
    expect(await screen.findByRole('alert')).toHaveTextContent('其他管理员修改')
  })

  it('associates 422 validation errors with the matching field', async () => {
    const publish = vi.fn(async () => { throw new AdminApiError(422, '校验失败', 'CONTENT_VALIDATION_FAILED', { fields: [
      { path: 'dates.start', code: 'INVALID_DATE', message: '开始日期无效' },
    ] }) })
    renderAdmin(client({ publish }), '/content/basic')
    const field = await screen.findByLabelText('开始日期')
    fireEvent.click(screen.getByRole('button', { name: '发布当前草稿' }))
    const error = await screen.findByText('开始日期无效')
    expect(field).toHaveAttribute('aria-describedby', error.id)
  })
})
