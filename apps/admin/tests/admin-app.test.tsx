import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_REGISTRATION_FORM, ProfileResponseSchema } from '@panshi/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { AdminApiError, type AdminClient } from '../src/api/admin-client'

afterEach(cleanup)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const profile = () => ({
  apiVersion: 'v1' as const,
  data: { user: { id: 'a1', displayName: '管理员', phoneNormalized: '+8613800138000', role: 'admin' as const } },
})

const client = (overrides: Partial<AdminClient> = {}): AdminClient => ({
  getProfile: async () => profile(),
  login: async () => ({ apiVersion: 'v1', data: { user: { id: 'a1', displayName: '管理员', role: 'admin' } } }),
  logout: async () => undefined,
  getSummary: async () => ({ apiVersion: 'v1', data: { applications: { total: 0, pendingReview: 0, byStatus: { draft: 0, submitted: 0, reviewing: 0, needs_supplement: 0, admitted: 0, waitlisted: 0, rejected: 0 } }, upcomingDates: [], unpublishedDrafts: [], recentOperations: [] } }),
  getDraft: async () => ({ apiVersion: 'v1', data: { key: 'basic', revision: 1, payload: { title: '草稿标题' }, publishedVersion: null } }),
  saveDraft: async (_key, payload) => ({ apiVersion: 'v1', data: { key: 'basic', revision: 2, payload, publishedVersion: null } }),
  getPreview: async () => ({ apiVersion: 'v1', data: { key: 'basic', revision: 1, payload: { title: '草稿标题' } } }),
  publish: async () => ({ apiVersion: 'v1', data: { key: 'basic', revision: 1, version: 1 } }),
  getHistory: async () => ({ apiVersion: 'v1', data: { key: 'basic', publishedVersion: null, versions: [] } }),
  rollback: async (_key, version) => ({ apiVersion: 'v1', data: { key: 'basic', revision: 1, version: 2, sourceVersion: version } }),
  getRegistrationFormDraft: async () => ({ apiVersion: 'v1', data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
  saveRegistrationFormDraft: async (form) => ({ apiVersion: 'v1', data: { form, revision: 1, baseVersion: null, publishedVersionId: null } }),
  previewRegistrationForm: async () => ({ apiVersion: 'v1', data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
  publishRegistrationForm: async () => ({ apiVersion: 'v1', data: { formVersionId: '00000000-0000-4000-8000-000000000020', revision: 0, version: 1 } }),
  getRegistrationFormHistory: async () => ({ apiVersion: 'v1', data: { publishedVersion: null, versions: [] } }),
  listApplications: async () => ({ data: { items: [], total: 0, page: 1, pageSize: 20 } }),
  getApplication: async () => { throw new Error('unused') }, transitionApplication: async () => { throw new Error('unused') },
  bulkTransitionApplications: async () => ({ data: { results: [] } }), exportApplications: async () => new Blob(),
  listResources: async () => ({ data: { resources: [] } }), previewResource: async () => { throw new Error('unused') }, uploadResourceFile: async () => { throw new Error('unused') },
  createResource: async () => { throw new Error('unused') }, updateResource: async () => { throw new Error('unused') }, publishResource: async () => { throw new Error('unused') },
  ...overrides,
})

const renderApp = (api: AdminClient) => render(<MemoryRouter initialEntries={['/']}><App client={api} /></MemoryRouter>)

describe('administrator route guard', () => {
  it('renders an explicit loading state while profile bootstrap is pending', () => {
    const pending = deferred<ReturnType<typeof profile>>()
    renderApp(client({ getProfile: () => pending.promise }))
    expect(screen.getByRole('status')).toHaveTextContent('正在验证管理员身份')
  })

  it('routes backend 401 to an accessible login form and shows login errors', async () => {
    const login = vi.fn(async () => { throw new AdminApiError(401, '手机号或密码错误') })
    renderApp(client({
      getProfile: async () => { throw new AdminApiError(401, '未登录') },
      login,
    }))

    const phone = await screen.findByLabelText('手机号')
    const password = screen.getByLabelText('密码')
    fireEvent.change(phone, { target: { value: '13800138000' } })
    fireEvent.change(password, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('手机号或密码错误')
    expect(login).toHaveBeenCalledWith({ phone: '13800138000', password: 'wrong' })
  })

  it('routes backend 403 for an authenticated non-admin to the login page', async () => {
    renderApp(client({ getProfile: async () => { throw new AdminApiError(403, '无权访问') } }))

    expect(await screen.findByLabelText('手机号')).toBeInTheDocument()
    expect(screen.queryByText('无权访问管理后台')).not.toBeInTheDocument()
  })

  it.each([
    ['server failure', new AdminApiError(503, '服务暂不可用')],
    ['network failure', new TypeError('Failed to fetch')],
    ['response-schema failure', ProfileResponseSchema.safeParse({ apiVersion: 'v1', data: {} }).error],
  ])('renders a distinct load error for %s', async (_label, error) => {
    renderApp(client({ getProfile: async () => { throw error } }))

    expect(await screen.findByRole('alert')).toHaveTextContent('管理后台加载失败，请稍后重试')
    expect(screen.queryByLabelText('手机号')).not.toBeInTheDocument()
  })

  it('renders the protected shell for an administrator and logs out through the backend', async () => {
    const logout = vi.fn(async () => undefined)
    renderApp(client({ logout }))

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(await screen.findByLabelText('手机号')).toBeInTheDocument()
  })

  it('mounts the Task 9 dashboard after authentication', async () => {
    const getDraft = vi.fn(client().getDraft)
    const getHistory = vi.fn(client().getHistory)
    renderApp(client({ getDraft, getHistory }))
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument()
    expect(getDraft).not.toHaveBeenCalled()
    expect(getHistory).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '基本信息' })).toBeInTheDocument()
  })
})
