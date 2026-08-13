import { LoginResponseSchema, ProfileResponseSchema, type AdminLoginRequest, type LoginResponse, type ProfileResponse } from '@panshi/contracts'

export class AdminApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'AdminApiError' }
}

export const resolveApiBaseUrl = (value?: string): string => {
  const candidate = value?.trim() ?? ''
  if (candidate === '') return ''
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error('Invalid VITE_API_BASE_URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid VITE_API_BASE_URL')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`
}

export type AdminClient = {
  getProfile: () => Promise<ProfileResponse>
  login: (input: AdminLoginRequest) => Promise<LoginResponse>
  logout: () => Promise<void>
}

export const createAdminClient = (apiBaseUrl?: string): AdminClient => {
  const prefix = resolveApiBaseUrl(apiBaseUrl)
  const send = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetch(`${prefix}${path}`, {
      ...init,
      credentials: prefix === '' ? 'same-origin' : 'include',
      headers: { Accept: 'application/json', ...init?.headers },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new AdminApiError(response.status, body.error?.message ?? '请求失败')
    }
    return response
  }
  return {
    getProfile: async () => ProfileResponseSchema.parse(await (await send('/api/v1/me/profile')).json()),
    login: async (input) => LoginResponseSchema.parse(await (await send('/api/v1/auth/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })).json()),
    logout: async () => { await send('/api/v1/auth/admin/logout', { method: 'POST' }) },
  }
}

export const adminClient = createAdminClient(import.meta.env.VITE_API_BASE_URL)
