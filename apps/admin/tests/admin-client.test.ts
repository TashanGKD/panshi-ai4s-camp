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

  it('uses typed administrator content endpoints and exact revision request bodies', async () => {
    const responses = [
      { apiVersion: 'v1', data: { key: 'basic', revision: 1, payload: { title: '草稿' }, publishedVersion: null } },
      { apiVersion: 'v1', data: { key: 'basic', revision: 2, payload: { title: '新草稿' }, publishedVersion: null } },
      { apiVersion: 'v1', data: { key: 'basic', revision: 2, version: 1 } },
      { apiVersion: 'v1', data: { key: 'basic', publishedVersion: 1, versions: [] } },
      { apiVersion: 'v1', data: { key: 'basic', revision: 2, version: 2, sourceVersion: 1 } },
    ]
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return new Response(JSON.stringify(responses.shift()), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createAdminClient(undefined, { production: true })

    await client.getDraft('basic')
    await client.saveDraft('basic', { title: '新草稿' }, 1)
    await client.publish('basic', 2)
    await client.getHistory('basic')
    await client.rollback('basic', 1)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/admin/content/basic/draft',
      '/api/v1/admin/content/basic/draft',
      '/api/v1/admin/content/basic/publish',
      '/api/v1/admin/content/basic/versions',
      '/api/v1/admin/content/basic/rollback',
    ])
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ payload: { title: '新草稿' }, expectedRevision: 1 }) })
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ expectedRevision: 2 }) })
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ version: 1 }) })
  })

  it('loads the protected database-backed dashboard summary endpoint', async () => {
    const response = { apiVersion: 'v1', data: { applications: { total: 0, pendingReview: 0, byStatus: { draft: 0, submitted: 0, reviewing: 0, needs_supplement: 0, admitted: 0, waitlisted: 0, rejected: 0 } }, upcomingDates: [], unpublishedDrafts: [], recentOperations: [] } }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createAdminClient(undefined, { production: true })
    await expect(client.getSummary()).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/summary', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it('preserves stable conflict and field validation details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'CONTENT_VALIDATION_FAILED', message: '内容未通过发布校验', requestId: 'r1',
        details: { fields: [{ path: 'items.0.href', code: 'INVALID_FIELD', message: '字段格式不正确' }] },
      },
    }), { status: 422, headers: { 'Content-Type': 'application/json' } })))
    const client = createAdminClient(undefined, { production: true })
    await expect(client.publish('contacts', 1)).rejects.toMatchObject({
      status: 422,
      code: 'CONTENT_VALIDATION_FAILED',
      details: { fields: [{ path: 'items.0.href' }] },
    })
  })
})
