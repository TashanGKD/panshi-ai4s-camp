import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { AdminApiError, type AdminClient } from '../src/api/admin-client'

afterEach(cleanup)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const profile = (role: 'user' | 'admin' = 'admin') => ({
  apiVersion: 'v1' as const,
  data: { user: { id: 'a1', displayName: '管理员', phoneNormalized: '+8613800138000', role } },
})

const client = (overrides: Partial<AdminClient> = {}): AdminClient => ({
  getProfile: async () => profile(),
  login: async () => ({ apiVersion: 'v1', data: { user: { id: 'a1', displayName: '管理员', role: 'admin' } } }),
  logout: async () => undefined,
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

  it('renders forbidden for backend 403 and authenticated non-admin profiles', async () => {
    const forbidden = renderApp(client({ getProfile: async () => { throw new AdminApiError(403, '无权访问') } }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无权访问管理后台')
    forbidden.unmount()

    renderApp(client({ getProfile: async () => profile('user') }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无权访问管理后台')
  })

  it('renders the protected shell for an administrator and logs out through the backend', async () => {
    const logout = vi.fn(async () => undefined)
    renderApp(client({ logout }))

    expect(await screen.findByRole('heading', { name: '磐石管理后台' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(await screen.findByLabelText('手机号')).toBeInTheDocument()
  })
})
