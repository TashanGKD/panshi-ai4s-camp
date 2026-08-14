import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient, resolveApiBaseUrl } from '../src/api/admin-client'

describe('administrator API client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('honors a validated VITE_API_BASE_URL and includes credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      apiVersion: 'v1',
      data: { user: { id: 'a1', displayName: '管理员', phoneNormalized: '+8613800138000', role: 'admin' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createAdminClient('https://api.example/base/')
    await client.getProfile()

    expect(resolveApiBaseUrl('https://api.example/base/')).toBe('https://api.example/base')
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/base/api/v1/me/profile', expect.objectContaining({
      credentials: 'include',
    }))
  })

  it.each(['javascript:alert(1)', 'https://user:secret@example.com', '/relative'])('rejects unsafe API base %s', (value) => {
    expect(() => resolveApiBaseUrl(value)).toThrow('Invalid VITE_API_BASE_URL')
  })

  it.each([401, 403, 503])('preserves backend HTTP status %i without storing auth state', async (status) => {
    const fetchMock = vi.fn(async () => new Response('{}', { status }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createAdminClient()

    await expect(client.getProfile()).rejects.toMatchObject({ status })
    expect(window.localStorage).toHaveLength(0)
    expect(window.sessionStorage).toHaveLength(0)
  })
})
