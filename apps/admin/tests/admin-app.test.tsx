import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_REGISTRATION_FORM, ProfileResponseSchema, type AdminSystemHealthResponse } from '@panshi/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { AdminApiError, type AdminClient } from '../src/api/admin-client'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

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
  getSystemHealth: async () => health(),
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
  listAdministrators: async () => ({ data: { administrators: [] } }), createAdministrator: async () => { throw new Error('unused') }, disableAdministrator: async () => { throw new Error('unused') }, resetAdministratorPassword: async () => { throw new Error('unused') }, listAuditLogs: async () => ({ data: { items: [], total: 0, page: 1, pageSize: 20 } }), getAuditLog: async () => { throw new Error('unused') },
  updateSelf: async () => { throw new Error('unused') }, changeOwnPassword: async () => { throw new Error('unused') }, listStudents: async () => ({ data: { students: [] } }), setStudentStatus: async () => { throw new Error('unused') }, forceStudentPasswordReset: async () => { throw new Error('unused') },
  lookupCheckIn: async () => { throw new Error('unused') }, confirmCheckIn: async () => { throw new Error('unused') }, revokeCheckIn: async () => { throw new Error('unused') },
  ...overrides,
})

const health = (): AdminSystemHealthResponse => ({ apiVersion: 'v1', data: { status: 'healthy', checkedAt: '2026-08-15T02:03:04.000Z', version: 'test', database: { connected: true }, uploads: { writable: true, freeBytes: 1_048_576 }, backup: { available: true, lastSuccessfulAt: '2026-08-15T01:02:03.000Z' } } })

const renderApp = (api: AdminClient, initialEntry = '/') => render(<MemoryRouter initialEntries={[initialEntry]}><App client={api} /></MemoryRouter>)

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

  it('returns to login immediately after resetting the current administrator password', async () => {
    const current = { id: 'a1', displayName: '管理员', phone: '+8613800138000', disabledAt: null, createdAt: '2026-08-15T00:00:00.000Z', isCurrent: true }
    const logout = vi.fn(async () => undefined)
    const resetAdministratorPassword = vi.fn(async () => ({ data: { administrator: current } }))
    renderApp(client({
      logout,
      listAdministrators: async () => ({ data: { administrators: [current] } }),
      resetAdministratorPassword,
    }), '/administrators')

    await screen.findByText('管理员（当前账号）')
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Replacement!2026' } })
    fireEvent.change(screen.getByLabelText('再次输入当前密码'), { target: { value: 'Current!2026' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))

    await waitFor(() => expect(resetAdministratorPassword).toHaveBeenCalledOnce())
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(await screen.findByLabelText('手机号')).toBeInTheDocument()
    expect(screen.queryByText('管理员密码已重置')).not.toBeInTheDocument()
  })

  it('mounts the Task 9 dashboard after authentication', async () => {
    const getDraft = vi.fn(client().getDraft)
    const getHistory = vi.fn(client().getHistory)
    renderApp(client({ getDraft, getHistory }))
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument()
    expect(getDraft).not.toHaveBeenCalled()
    expect(getHistory).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '基本信息' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '系统状态' })).toBeInTheDocument()
  })

  it('reaches the system status page from the protected router', async () => {
    const getSystemHealth = vi.fn(async () => health())
    renderApp(client({ getSystemHealth }), '/system-status')
    expect(await screen.findByRole('heading', { name: '系统状态' })).toBeInTheDocument()
    expect(await screen.findByText('运行正常')).toBeInTheDocument()
    expect(getSystemHealth).toHaveBeenCalledOnce()
  })

  it('requires confirmation and current password for a verification-based student reset', async () => {
    const forceStudentPasswordReset = vi.fn(async () => ({ data: { student: { id: 's1', displayName: '测试学员', phone: '+8613900139000', disabledAt: null, createdAt: '2026-08-15T00:00:00.000Z' }, resetMethod: 'verification_code' as const } }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderApp(client({
      listStudents: async () => ({ data: { students: [{ id: 's1', displayName: '测试学员', phone: '+8613900139000', disabledAt: null, createdAt: '2026-08-15T00:00:00.000Z' }] } }),
      forceStudentPasswordReset,
    }), '/students')

    await screen.findByText('测试学员')
    fireEvent.change(screen.getByLabelText('当前管理员密码'), { target: { value: 'CurrentAdmin!2026' } })
    fireEvent.click(screen.getByRole('button', { name: '要求验证码重置' }))

    await waitFor(() => expect(forceStudentPasswordReset).toHaveBeenCalledWith('s1', { currentPassword: 'CurrentAdmin!2026' }))
    expect(await screen.findByRole('status')).toHaveTextContent('学员须通过现有验证码流程重置密码')
  })

  it('changes the current administrator password and returns to login', async () => {
    const changeOwnPassword = vi.fn(async () => ({ data: { sessionsRevoked: true as const } }))
    const logout = vi.fn(async () => undefined)
    renderApp(client({ changeOwnPassword, logout }), '/account')

    await screen.findByRole('heading', { name: '我的账号' })
    fireEvent.change(screen.getAllByLabelText('当前密码')[1]!, { target: { value: 'CurrentAdmin!2026' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'ChangedAdmin!2026' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码并退出全部设备' }))

    await waitFor(() => expect(changeOwnPassword).toHaveBeenCalledWith({ currentPassword: 'CurrentAdmin!2026', newPassword: 'ChangedAdmin!2026' }))
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(await screen.findByLabelText('手机号')).toBeInTheDocument()
  })

  it('shows the stable duplicate-name conflict during self rename', async () => {
    const updateSelf = vi.fn(async () => { throw new AdminApiError(409, '管理员名称已存在', 'ADMIN_NAME_CONFLICT') })
    renderApp(client({ updateSelf }), '/account')

    await screen.findByRole('heading', { name: '我的账号' })
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'duplicate admin' } })
    fireEvent.change(screen.getAllByLabelText('当前密码')[0]!, { target: { value: 'CurrentAdmin!2026' } })
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))

    expect(await screen.findByRole('status')).toHaveTextContent('管理员名称已存在')
    expect(updateSelf).toHaveBeenCalledWith({ displayName: 'duplicate admin', currentPassword: 'CurrentAdmin!2026' })
  })
})
