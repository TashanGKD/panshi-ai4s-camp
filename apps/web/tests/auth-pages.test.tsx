import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'

const siteResponse = {
  apiVersion: 'v1',
  data: {
    contentVersion: 'test',
    basic: {
      title: '磐石 AI4S 实训营', dates: { start: '2026-08-23', end: '2026-08-27', label: '8月23日至27日' },
      venue: '中国科学院物理研究所', intro: [],
    },
    importantDates: { items: [] }, contacts: { items: [] },
    display: { series: '磐石科学智能实训营', footer: '磐石 AI4S 实训营' },
  },
}

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response

const pathOf = (input: RequestInfo | URL) => typeof input === 'string' ? new URL(input, 'http://localhost').pathname : input instanceof URL ? input.pathname : new URL(input.url).pathname
const renderRoute = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

const installFetch = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
  const path = pathOf(input)
  if (path === '/api/v1/public/site') return json(siteResponse)
  if (path === '/api/v1/auth/verification/send') return json(undefined, 204)
  if (path === '/api/v1/auth/register') return json({
    apiVersion: 'v1', data: { user: { id: 'u1', displayName: '实训营学员', role: 'user' } },
  }, 201)
  if (path === '/api/v1/auth/login') return json({
    apiVersion: 'v1', data: { user: { id: 'u1', displayName: '实训营学员', role: 'user' } },
  })
  if (path === '/api/v1/auth/password/reset') return json(undefined, 204)
  throw new Error(`Unexpected ${init?.method ?? 'GET'} ${path}`)
})

afterEach(() => vi.restoreAllMocks())

describe('student auth pages', () => {
  it('completes the accessible three-step registration flow', async () => {
    const fetchSpy = installFetch()
    renderRoute('/register')

    expect(await screen.findByRole('heading', { level: 2, name: '在线注册' })).toBeVisible()
    expect(screen.getByText('步骤 1 / 3')).toBeVisible()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    expect(await screen.findByText('步骤 2 / 3')).toBeVisible()
    expect(screen.getByRole('button', { name: /重新发送/u })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '246810' } })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    expect(screen.getByText('步骤 3 / 3')).toBeVisible()
    fireEvent.change(screen.getByLabelText('设置密码'), { target: { value: 'password-1' } })
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByRole('status')).toHaveTextContent('注册成功')
    expect(fetchSpy.mock.calls.map(([input]) => pathOf(input))).toEqual(expect.arrayContaining([
      '/api/v1/auth/verification/send', '/api/v1/auth/register',
    ]))
    const registrationCall = fetchSpy.mock.calls.find(([input]) => pathOf(input) === '/api/v1/auth/register')
    expect(JSON.parse(String(registrationCall?.[1]?.body))).toEqual({
      phone: '13800138000', code: '246810', password: 'password-1',
    })
  })

  it('validates registration fields on the client and prevents duplicate pending submissions', async () => {
    let resolveSend: ((response: Response) => void) | undefined
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = pathOf(input)
      if (path === '/api/v1/public/site') return json(siteResponse)
      if (path === '/api/v1/auth/verification/send') return new Promise<Response>((resolve) => { resolveSend = resolve })
      throw new Error(`Unexpected ${path}`)
    })
    renderRoute('/register')
    await screen.findByRole('heading', { name: '在线注册' })
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '12800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的中国大陆手机号')

    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByRole('button', { name: '正在发送' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '正在发送' }))
    expect(fetchSpy.mock.calls.filter(([input]) => pathOf(input) === '/api/v1/auth/verification/send')).toHaveLength(1)
    resolveSend?.(json(undefined, 204))
    expect(await screen.findByText('步骤 2 / 3')).toBeVisible()
  })

  it('logs a student in and hides registration and password recovery links after success', async () => {
    const fetchSpy = installFetch()
    renderRoute('/login')
    expect(await screen.findByRole('heading', { name: '学员登录' })).toBeVisible()
    expect(screen.getByRole('link', { name: '忘记密码' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('link', { name: '注册账号' })).toHaveAttribute('href', '/register')
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('status')).toHaveTextContent('登录成功')
    expect(screen.queryByRole('link', { name: '忘记密码' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '注册账号' })).not.toBeInTheDocument()
    expect(fetchSpy.mock.calls.some(([input]) => pathOf(input) === '/api/v1/auth/login')).toBe(true)
  })

  it('shows safe API errors and restores the login submit button', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = pathOf(input)
      if (path === '/api/v1/public/site') return json(siteResponse)
      if (path === '/api/v1/auth/login') return json({
        error: { code: 'INVALID_CREDENTIALS', message: '手机号或密码错误', requestId: 'r1' },
      }, 401)
      throw new Error(`Unexpected ${path}`)
    })
    renderRoute('/login')
    await screen.findByRole('heading', { name: '学员登录' })
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('手机号或密码错误')
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
  })

  it('sends a reset code and changes the password without exposing account existence', async () => {
    const fetchSpy = installFetch()
    renderRoute('/forgot-password')
    expect(await screen.findByRole('heading', { name: '忘记密码' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(await screen.findByText('如手机号可用于重置，验证码已发送。')).toBeVisible()
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '246810' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'password-2' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'password-2' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))
    expect(await screen.findByRole('status')).toHaveTextContent('密码已重置')
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input]) => pathOf(input) === '/api/v1/auth/password/reset')).toBe(true))
  })
})
