import { afterEach, describe, expect, it, vi } from 'vitest'

const siteResponse = {
  apiVersion: 'v1',
  data: {
    contentVersion: 'site:1',
    basic: {
      title: '活动标题',
      dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
      venue: '中国科学院物理研究所',
      intro: [],
    },
    importantDates: { items: [] },
    contacts: { items: [] },
    display: { series: '磐石科学智能实训营', footer: '活动标题' },
  },
}

const jsonResponse = (body: unknown) => ({
  json: async () => body,
  ok: true,
  status: 200,
}) as Response

type PublicClientModule = {
  createPublicClient: (value?: string) => { getPublicSite: () => Promise<unknown> }
  resolveApiBaseUrl: (value?: string) => { prefix: string, credentials: RequestCredentials }
}

const loadClientModule = async () => import('../src/api/public-client') as unknown as PublicClientModule

afterEach(() => {
  vi.restoreAllMocks()
})

describe('public API base URL', () => {
  it.each([undefined, '', '   '])('uses same-origin paths when VITE_API_BASE_URL is %s', async (value) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(siteResponse))
    const { createPublicClient, resolveApiBaseUrl } = await loadClientModule()

    expect(resolveApiBaseUrl(value)).toEqual({ prefix: '', credentials: 'same-origin' })
    await createPublicClient(value).getPublicSite()

    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/public/site', expect.objectContaining({
      credentials: 'same-origin',
    }))
  })

  it('normalizes a configured HTTP(S) base and includes credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(siteResponse))
    const { createPublicClient, resolveApiBaseUrl } = await loadClientModule()

    expect(resolveApiBaseUrl(' https://api.example.test/camp/// ')).toEqual({
      prefix: 'https://api.example.test/camp',
      credentials: 'include',
    })
    await createPublicClient('https://api.example.test/camp///').getPublicSite()

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.test/camp/api/v1/public/site',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it.each([
    '/api',
    '//api.example.test',
    'javascript:alert(1)',
    'https://user:secret@api.example.test',
    'https://api.example.test?debug=true',
    'https://api.example.test#fragment',
  ])('rejects unsafe or invalid VITE_API_BASE_URL value %s', async (value) => {
    const { resolveApiBaseUrl } = await loadClientModule()
    expect(() => resolveApiBaseUrl(value)).toThrow(/VITE_API_BASE_URL/u)
  })

  it('accepts and strips additive v1 response envelope fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...siteResponse,
      futureTopLevel: 'ignored',
      data: { ...siteResponse.data, futureData: { ignored: true } },
    }))
    const { createPublicClient } = await loadClientModule()

    await expect(createPublicClient().getPublicSite()).resolves.toEqual(siteResponse)
  })

  it.each([
    { ...siteResponse, apiVersion: 'v2' },
    { ...siteResponse, data: { ...siteResponse.data, display: undefined } },
  ])('still rejects missing or wrong required response fields', async (response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(response))
    const { createPublicClient } = await loadClientModule()

    await expect(createPublicClient().getPublicSite()).rejects.toBeTruthy()
  })
})
