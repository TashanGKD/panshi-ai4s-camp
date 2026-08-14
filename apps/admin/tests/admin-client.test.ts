import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient, createConfiguredAdminClient, resolveApiBaseUrl } from '../src/api/admin-client'

describe('administrator API client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('honors a validated VITE_API_BASE_URL and includes credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      apiVersion: 'v1',
      data: { user: { id: 'a1', displayName: '管理员', phoneNormalized: '+8613800138000', role: 'admin' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createAdminClient('https://api.example/base/', { production: true })
    await client.getProfile()

    expect(resolveApiBaseUrl('https://api.example/base/', { production: true })).toBe('https://api.example/base')
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/base/api/v1/me/profile', expect.objectContaining({
      credentials: 'include',
    }))
  })

  it.each(['javascript:alert(1)', 'https://user:secret@example.com', '/relative'])('rejects unsafe API base %s', (value) => {
    expect(() => resolveApiBaseUrl(value, { production: false })).toThrow('Invalid VITE_API_BASE_URL')
  })

  it.each([
    'http://api.example',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('rejects plain HTTP API base in production: %s', (value) => {
    expect(() => resolveApiBaseUrl(value, { production: true })).toThrow('Invalid VITE_API_BASE_URL')
  })

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000/base',
    'http://[::1]:3000',
  ])('allows loopback HTTP API base in development: %s', (value) => {
    expect(resolveApiBaseUrl(value, { production: false })).toBe(value)
  })

  it.each([
    'http://api.example',
    'http://192.168.1.20:3000',
    'http://127.0.0.2:3000',
    'http://localhost.example:3000',
  ])('rejects non-loopback HTTP API base in development: %s', (value) => {
    expect(() => resolveApiBaseUrl(value, { production: false })).toThrow('Invalid VITE_API_BASE_URL')
  })

  it('uses the supplied production flag when constructing the configured module client', () => {
    expect(() => createConfiguredAdminClient({
      VITE_API_BASE_URL: 'http://localhost:3000',
      PROD: true,
    })).toThrow('Invalid VITE_API_BASE_URL')
    expect(() => createConfiguredAdminClient({ VITE_API_BASE_URL: '', PROD: true })).not.toThrow()
  })

  it.each([401, 403, 503])('preserves backend HTTP status %i without storing auth state', async (status) => {
    const fetchMock = vi.fn(async () => new Response('{}', { status }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createAdminClient(undefined, { production: true })

    await expect(client.getProfile()).rejects.toMatchObject({ status })
    expect(window.localStorage).toHaveLength(0)
    expect(window.sessionStorage).toHaveLength(0)
  })
})
