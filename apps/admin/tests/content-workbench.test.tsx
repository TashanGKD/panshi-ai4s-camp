import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REGISTRATION_FORM, type JsonObject } from '@panshi/contracts'
import type { AdminClient } from '../src/api/admin-client'
import { AdminApiError } from '../src/api/admin-client'
import { AdminApp } from '../src/app/AdminApp'
import { ContentPage } from '../src/pages/content/ContentPage'

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
  getRegistrationFormDraft: async () => ({ apiVersion: 'v1', data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
  saveRegistrationFormDraft: async (form) => ({ apiVersion: 'v1', data: { form, revision: 1, baseVersion: null, publishedVersionId: null } }),
  previewRegistrationForm: async () => ({ apiVersion: 'v1', data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
  publishRegistrationForm: async () => ({ apiVersion: 'v1', data: { formVersionId: '00000000-0000-4000-8000-000000000020', revision: 0, version: 1 } }),
  getRegistrationFormHistory: async () => ({ apiVersion: 'v1', data: { publishedVersion: null, versions: [] } }),
  listApplications: async () => ({ data: { items: [], total: 0, page: 1, pageSize: 20 } }),
  getApplication: async () => { throw new Error('unused') }, transitionApplication: async () => { throw new Error('unused') },
  bulkTransitionApplications: async () => ({ data: { results: [] } }), exportApplications: async () => new Blob(),
  listResources: async () => ({ data: { resources: [] } }), uploadResourceFile: async () => { throw new Error('unused') },
  createResource: async () => { throw new Error('unused') }, updateResource: async () => { throw new Error('unused') }, publishResource: async () => { throw new Error('unused') },
  ...overrides,
})

const renderAdmin = (api = client(), route = '/') => render(
  <MemoryRouter initialEntries={[route]}><AdminApp client={api} publicWebBaseUrl="https://camp.example" /></MemoryRouter>,
)

const clientWithDraft = (key: Parameters<AdminClient['getDraft']>[0], payload: JsonObject, saveDraft = vi.fn(client().saveDraft)) => ({
  api: client({
    getDraft: async (requestedKey) => ({ apiVersion: 'v1', data: { key: requestedKey, revision: 7, payload: requestedKey === key ? payload : drafts[requestedKey] as unknown as JsonObject, publishedVersion: 2 } }),
    saveDraft,
  }),
  saveDraft,
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

describe('content workbench', () => {
  it('provides the complete business navigation and the resource publishing workbench', async () => {
    renderAdmin()
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeVisible()
    for (const name of ['基本信息', '实训特色', '组织单位', '重要日期', '实训日程与师资', '住宿交通', '联系方式', '相关资料', '展示设置', '表单配置']) {
      expect(screen.getByRole('link', { name })).toBeVisible()
    }
    fireEvent.click(screen.getByRole('link', { name: '表单配置' }))
    expect(await screen.findByRole('heading', { name: '表单配置' })).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: '相关资料' }))
    expect(await screen.findByRole('heading', { name: '相关资料' })).toBeVisible()
    expect(screen.getByText('暂无资料。')).toBeVisible()
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

  it('blocks preview and publish while dirty, then publishes the saved revision', async () => {
    const saveDraft = vi.fn(async (key: 'basic', payload: JsonObject) => ({
      apiVersion: 'v1' as const,
      data: { key, revision: 2, payload, publishedVersion: 1 },
    }))
    const publish = vi.fn(client().publish)
    renderAdmin(client({ saveDraft: saveDraft as AdminClient['saveDraft'], publish }), '/content/basic')
    fireEvent.change(await screen.findByLabelText('实训营名称'), { target: { value: '尚未保存的新标题' } })
    expect(screen.getByRole('button', { name: '预览草稿' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发布当前草稿' })).toBeDisabled()
    expect(screen.getByText('请先保存草稿')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('basic', expect.objectContaining({ title: '尚未保存的新标题' }), 1))
    await waitFor(() => expect(screen.getByRole('button', { name: '发布当前草稿' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '发布当前草稿' }))
    await waitFor(() => expect(publish).toHaveBeenCalledWith('basic', 2))
  })

  it('ignores a stale module load that resolves after the current module', async () => {
    const oldDraft = deferred<Awaited<ReturnType<AdminClient['getDraft']>>>()
    const oldHistory = deferred<Awaited<ReturnType<AdminClient['getHistory']>>>()
    const api = client({
      getDraft: async (key) => key === 'basic' ? oldDraft.promise : client().getDraft(key),
      getHistory: async (key) => key === 'basic' ? oldHistory.promise : client().getHistory(key),
    })
    const view = render(<ContentPage moduleKey="basic" client={api} publicWebBaseUrl="https://camp.example" />)
    view.rerender(<ContentPage moduleKey="features" client={api} publicWebBaseUrl="https://camp.example" />)
    expect(await screen.findByDisplayValue('系统课程')).toBeVisible()
    await act(async () => {
      oldDraft.resolve({ apiVersion: 'v1', data: { key: 'basic', revision: 9, payload: drafts.basic as unknown as JsonObject, publishedVersion: 1 } })
      oldHistory.resolve({ apiVersion: 'v1', data: { key: 'basic', publishedVersion: 1, versions: [] } })
      await Promise.all([oldDraft.promise, oldHistory.promise])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByRole('heading', { name: '实训特色' })).toBeVisible()
    expect(screen.queryByLabelText('实训营名称')).not.toBeInTheDocument()
  })

  it('ignores a stale module failure after the next module has loaded', async () => {
    const oldDraft = deferred<Awaited<ReturnType<AdminClient['getDraft']>>>()
    const api = client({ getDraft: async (key) => key === 'basic' ? oldDraft.promise : client().getDraft(key) })
    const view = render(<ContentPage moduleKey="basic" client={api} publicWebBaseUrl="https://camp.example" />)
    view.rerender(<ContentPage moduleKey="contacts" client={api} publicWebBaseUrl="https://camp.example" />)
    expect(await screen.findByLabelText('联系人姓名')).toBeVisible()
    oldDraft.reject(new Error('旧模块失败'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('heading', { name: '联系方式' })).toBeVisible()
    expect(screen.queryByText('内容模块暂时无法加载')).not.toBeInTheDocument()
  })

  it('does not let a completed write from the previous module update the current module', async () => {
    const oldSave = deferred<Awaited<ReturnType<AdminClient['saveDraft']>>>()
    const api = client({ saveDraft: async (key, payload) => key === 'basic' ? oldSave.promise : client().saveDraft(key, payload, 1) })
    const view = render(<ContentPage moduleKey="basic" client={api} publicWebBaseUrl="https://camp.example" />)
    fireEvent.change(await screen.findByLabelText('实训营名称'), { target: { value: '旧模块编辑' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    view.rerender(<ContentPage moduleKey="features" client={api} publicWebBaseUrl="https://camp.example" />)
    expect(await screen.findByDisplayValue('系统课程')).toBeVisible()
    oldSave.resolve({ apiVersion: 'v1', data: { key: 'basic', revision: 2, payload: { ...drafts.basic, title: '旧模块编辑' }, publishedVersion: 1 } })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('heading', { name: '实训特色' })).toBeVisible()
    expect(screen.queryByText('草稿已保存。')).not.toBeInTheDocument()
  })

  it('uses one synchronous write lock across save, publish and rollback and releases it after failure', async () => {
    const save = deferred<Awaited<ReturnType<AdminClient['saveDraft']>>>()
    const saveDraft = vi.fn(() => save.promise)
    const publish = vi.fn(client().publish)
    const rollback = vi.fn(client().rollback)
    const api = client({
      saveDraft,
      publish,
      rollback,
      getHistory: async (key) => ({ apiVersion: 'v1', data: { key, publishedVersion: 2, versions: [
        { version: 2, payload: {}, createdBy: 'a', createdAt: '2026-08-14T02:00:00.000Z' },
        { version: 1, payload: {}, createdBy: 'a', createdAt: '2026-08-14T01:00:00.000Z' },
      ] } }),
    })
    render(<ContentPage moduleKey="basic" client={api} publicWebBaseUrl="https://camp.example" />)
    await screen.findByLabelText('实训营名称')
    const saveButton = screen.getByRole('button', { name: '保存草稿' })
    const rollbackButton = screen.getByRole('button', { name: '回退到版本 1' })
    act(() => {
      fireEvent.click(saveButton)
      fireEvent.click(rollbackButton)
      fireEvent.click(saveButton)
    })
    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(rollback).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '发布当前草稿' })).toBeDisabled()
    expect(rollbackButton).toBeDisabled()
    save.reject(new Error('保存失败'))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    await waitFor(() => expect(rollbackButton).toBeEnabled())
    fireEvent.click(rollbackButton)
    await waitFor(() => expect(rollback).toHaveBeenCalledTimes(1))
  })

  it('routes rollback failures through the parent error mapper and releases the shared lock', async () => {
    const rollback = vi.fn(async () => { throw new AdminApiError(409, '冲突', 'CONTENT_CONFLICT') })
    const api = client({
      rollback,
      getHistory: async (key) => ({ apiVersion: 'v1', data: { key, publishedVersion: 2, versions: [
        { version: 2, payload: {}, createdBy: 'a', createdAt: '2026-08-14T02:00:00.000Z' },
        { version: 1, payload: {}, createdBy: 'a', createdAt: '2026-08-14T01:00:00.000Z' },
      ] } }),
    })
    render(<ContentPage moduleKey="basic" client={api} publicWebBaseUrl="https://camp.example" />)
    const rollbackButton = await screen.findByRole('button', { name: '回退到版本 1' })
    fireEvent.click(rollbackButton)
    expect(await screen.findByRole('alert')).toHaveTextContent('其他管理员修改')
    await waitFor(() => expect(rollbackButton).toBeEnabled())
    expect(rollback).toHaveBeenCalledTimes(1)
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
    fireEvent.click(within(items[2]!).getByRole('button', { name: '删除“特色”' }))
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
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })

  it('marks rich text and select controls invalid while retaining error descriptions', async () => {
    const publish = vi.fn(async () => { throw new AdminApiError(422, '校验失败', 'CONTENT_VALIDATION_FAILED', { fields: [
      { path: 'items.0.description', code: 'INVALID', message: '特色说明无效' },
    ] }) })
    renderAdmin(client({ publish }), '/content/features')
    const richText = (await screen.findAllByRole('textbox', { name: '特色说明' }))[0]!
    fireEvent.click(screen.getByRole('button', { name: '发布当前草稿' }))
    const error = await screen.findByText('特色说明无效')
    expect(richText).toHaveAttribute('aria-invalid', 'true')
    expect(richText).toHaveAttribute('aria-describedby', error.id)

    cleanup()
    const contactPublish = vi.fn(async () => { throw new AdminApiError(422, '校验失败', 'CONTENT_VALIDATION_FAILED', { fields: [
      { path: 'items.0.methods.0.type', code: 'INVALID', message: '联系方式类型无效' },
    ] }) })
    renderAdmin(client({ publish: contactPublish }), '/content/contacts')
    const select = await screen.findByLabelText('联系人 1 的联系方式 1 类型')
    fireEvent.click(screen.getByRole('button', { name: '发布当前草稿' }))
    const selectError = await screen.findByText('联系方式类型无效')
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAttribute('aria-describedby', selectError.id)
  })

  it('round-trips multiple intro paragraphs while editing, adding, deleting and sorting independently', async () => {
    const source = { ...drafts.basic, intro: ['<p>第一段</p>', '<p>第二段</p>', '<p>第三段</p>'] }
    const { api, saveDraft } = clientWithDraft('basic', source)
    renderAdmin(api, '/content/basic')
    await screen.findByRole('textbox', { name: '简介段落 1' })
    fireEvent.click(screen.getByRole('button', { name: '下移“简介段落 1”' }))
    const second = screen.getByRole('textbox', { name: '简介段落 1' })
    second.innerHTML = '<p>第二段（修改）</p>'; fireEvent.input(second)
    fireEvent.click(screen.getByRole('button', { name: '删除“简介段落 2”' }))
    fireEvent.click(screen.getByRole('button', { name: '添加简介段落' }))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('basic', expect.objectContaining({
      intro: ['<p>第二段（修改）</p>', '<p>第三段</p>', '<p></p>'],
    }), 7))
  })

  it('preserves intro and feature editor DOM identity when items are reordered', async () => {
    const introApi = clientWithDraft('basic', { ...drafts.basic, intro: ['<p>第一段</p>', '<p>第二段</p>'] }).api
    renderAdmin(introApi, '/content/basic')
    const introBefore = (await screen.findAllByRole('textbox', { name: /简介段落/u })).find((node) => node.innerHTML.includes('第一段'))
    fireEvent.click(screen.getByRole('button', { name: '下移“简介段落 1”' }))
    const introAfter = screen.getAllByRole('textbox', { name: /简介段落/u }).find((node) => node.innerHTML.includes('第一段'))
    expect(introAfter).toBe(introBefore)

    cleanup()
    renderAdmin(client(), '/content/features')
    const featureBefore = await screen.findByDisplayValue('系统课程')
    fireEvent.click(screen.getByRole('button', { name: '下移“系统课程”' }))
    expect(screen.getByDisplayValue('系统课程')).toBe(featureBefore)
  })

  it('edits and sorts organization records before saving without a JSON escape hatch', async () => {
    const { api, saveDraft } = clientWithDraft('organizations', { items: [
      { role: '主办单位', name: '物理所' }, { role: '合作单位', name: '自动化所' },
    ] })
    renderAdmin(api, '/content/organizations')
    const names = await screen.findAllByLabelText('单位全称')
    fireEvent.change(names[1]!, { target: { value: '中国科学院自动化研究所' } })
    fireEvent.click(screen.getByRole('button', { name: '上移“中国科学院自动化研究所”' }))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('organizations', { items: [
      { role: '合作单位', name: '中国科学院自动化研究所' }, { role: '主办单位', name: '物理所' },
    ] }, 7))
  })

  it('maintains important-date labels, values, machine uses and order', async () => {
    const { api, saveDraft } = clientWithDraft('importantDates', { items: [
      { label: '报名开放', value: '2026-07-01', machineKey: 'registrationOpen' },
      { label: '说明会', value: '另行通知' },
    ] })
    renderAdmin(api, '/content/importantDates')
    const matters = await screen.findAllByLabelText('事项')
    fireEvent.change(matters[1]!, { target: { value: '线上说明会' } })
    fireEvent.click(screen.getByRole('button', { name: '上移“线上说明会”' }))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('importantDates', { items: [
      { label: '线上说明会', value: '另行通知' },
      { label: '报名开放', value: '2026-07-01', machineKey: 'registrationOpen' },
    ] }, 7))
  })

  it('round-trips multiple contact methods and edits one method without overwriting siblings', async () => {
    const { api, saveDraft } = clientWithDraft('contacts', { items: [
      { name: '会务组', responsibility: '报名咨询', methods: [
        { type: 'email', value: 'first@example.com' }, { type: 'phone', value: '010-12345678' },
      ], consultationNote: '工作日回复' },
      { name: '课程组', responsibility: '课程咨询', methods: [{ type: 'email', value: 'course@example.com' }] },
    ] })
    renderAdmin(api, '/content/contacts')
    const firstType = await screen.findByLabelText('联系人 1 的联系方式 1 类型')
    const firstValue = screen.getByLabelText('联系人 1 的联系方式 1 内容')
    fireEvent.change(firstType, { target: { value: 'phone' } })
    fireEvent.change(firstValue, { target: { value: '010-87654321' } })
    fireEvent.click(screen.getByRole('button', { name: '上移“联系方式 2”' }))
    fireEvent.click(screen.getAllByRole('button', { name: '添加联系方式' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '删除“联系方式 3”' }))
    fireEvent.click(screen.getByRole('button', { name: '下移“会务组”' }))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('contacts', { items: [
      { name: '课程组', responsibility: '课程咨询', methods: [{ type: 'email', value: 'course@example.com' }] },
      { name: '会务组', responsibility: '报名咨询', methods: [
        { type: 'phone', value: '010-12345678' }, { type: 'phone', value: '010-87654321' },
      ], consultationNote: '工作日回复' },
    ] }, 7))
  })

  it('preserves contact and method editor DOM identity when nested items are reordered', async () => {
    const { api } = clientWithDraft('contacts', { items: [
      { name: '会务组', responsibility: '报名咨询', methods: [
        { type: 'email', value: 'first@example.com' }, { type: 'phone', value: '010-12345678' },
      ] },
      { name: '课程组', responsibility: '课程咨询', methods: [{ type: 'email', value: 'course@example.com' }] },
    ] })
    renderAdmin(api, '/content/contacts')
    const methodBefore = await screen.findByDisplayValue('first@example.com')
    fireEvent.click(screen.getAllByRole('button', { name: '下移“联系方式 1”' })[0]!)
    expect(screen.getByDisplayValue('first@example.com')).toBe(methodBefore)
    const contactBefore = screen.getByDisplayValue('会务组')
    fireEvent.click(screen.getByRole('button', { name: '下移“会务组”' }))
    expect(screen.getByDisplayValue('会务组')).toBe(contactBefore)
  })

  it('round-trips speaker references, legacy instructors and multiple session details independently', async () => {
    const { api, saveDraft } = clientWithDraft('schedule', {
      speakers: [{ id: 'speaker-1', name: '张老师' }, { id: 'speaker-2', name: '李老师' }],
      days: [{ date: '2026-08-23', label: '第一天', theme: '科研智能体', sessions: [{
        title: '智能体基础', time: '上午课程', timeRange: { start: '09:00', end: '10:00' },
        details: ['概念一', '案例二'], speakerIds: ['speaker-1'], instructors: ['旧讲师'],
      }] }],
    })
    renderAdmin(api, '/content/schedule')
    const detail = await screen.findByLabelText('课程 1 的内容要点 1')
    fireEvent.change(detail, { target: { value: '概念一（修改）' } })
    fireEvent.click(screen.getByRole('button', { name: '下移“内容要点 1”' }))
    fireEvent.click(screen.getByRole('button', { name: '添加内容要点' }))
    fireEvent.click(screen.getByRole('button', { name: '删除“内容要点 3”' }))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('schedule', expect.objectContaining({
      days: [expect.objectContaining({ sessions: [expect.objectContaining({
        time: '上午课程', details: ['案例二', '概念一（修改）'], speakerIds: ['speaker-1'], instructors: ['旧讲师'],
      })] })],
    }), 7))
  })

  it('preserves schedule day, session and detail DOM identity through nested sorting', async () => {
    const { api } = clientWithDraft('schedule', {
      speakers: [],
      days: [
        { date: '2026-08-23', label: '第一天', theme: '主题一', sessions: [
          { title: '课程甲', timeRange: { start: '09:00', end: '10:00' }, details: ['要点甲', '要点乙'], speakerIds: [] },
          { title: '课程乙', timeRange: { start: '10:00', end: '11:00' }, details: [], speakerIds: [] },
        ] },
        { date: '2026-08-24', label: '第二天', theme: '主题二', sessions: [] },
      ],
    })
    renderAdmin(api, '/content/schedule')
    const detailBefore = await screen.findByDisplayValue('要点甲')
    fireEvent.click(screen.getByRole('button', { name: '下移“内容要点 1”' }))
    expect(screen.getByDisplayValue('要点甲')).toBe(detailBefore)
    const sessionBefore = screen.getByDisplayValue('课程甲')
    fireEvent.click(screen.getByRole('button', { name: '下移“课程甲”' }))
    expect(screen.getByDisplayValue('课程甲')).toBe(sessionBefore)
    const dayBefore = screen.getByDisplayValue('第一天')
    fireEvent.click(screen.getByRole('button', { name: '下移“第一天”' }))
    expect(screen.getByDisplayValue('第一天')).toBe(dayBefore)
  })

  it('edits and sorts the validated home section order in display settings', async () => {
    const { api, saveDraft } = clientWithDraft('display', {
      series: '磐石科学智能实训营', footer: '实训营', visibleNavigation: ['home'],
      homeSectionOrder: ['intro', 'target', 'features'],
    })
    renderAdmin(api, '/content/display')
    await screen.findByText('首页模块顺序')
    fireEvent.click(screen.getByRole('button', { name: '上移“面向对象”' }))
    fireEvent.click(screen.getByRole('button', { name: '删除“实训特色”' }))
    fireEvent.change(screen.getByLabelText('待添加首页模块'), { target: { value: 'organizations' } })
    fireEvent.click(screen.getByRole('button', { name: '添加首页模块' }))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('display', expect.objectContaining({
      homeSectionOrder: ['target', 'intro', 'organizations'],
    }), 7))
  })
})
