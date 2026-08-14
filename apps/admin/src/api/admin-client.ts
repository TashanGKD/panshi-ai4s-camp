import { LoginResponseSchema, ProfileResponseSchema, type AdminLoginRequest, type LoginResponse, type ProfileResponse } from '@panshi/contracts'

export class AdminApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'AdminApiError' }
}

type AdminClientRuntime = { production: boolean }

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export const resolveApiBaseUrl = (value: string | undefined, runtime: AdminClientRuntime): string => {
  const candidate = value?.trim() ?? ''
  if (candidate === '') return ''
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error('Invalid VITE_API_BASE_URL') }
  const unsafeHttp = url.protocol === 'http:' && (runtime.production || !loopbackHosts.has(url.hostname))
  if (!['http:', 'https:'].includes(url.protocol) || unsafeHttp || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid VITE_API_BASE_URL')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`
}

export type AdminClient = {
  getProfile: () => Promise<ProfileResponse>
  login: (input: AdminLoginRequest) => Promise<LoginResponse>
  logout: () => Promise<void>
}

export const createAdminClient = (apiBaseUrl: string | undefined, runtime: AdminClientRuntime): AdminClient => {
  const prefix = resolveApiBaseUrl(apiBaseUrl, runtime)
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

export const createConfiguredAdminClient = (env: { VITE_API_BASE_URL?: string, PROD: boolean }) => (
  createAdminClient(env.VITE_API_BASE_URL, { production: env.PROD })
)

export const adminClient = createConfiguredAdminClient(import.meta.env)
