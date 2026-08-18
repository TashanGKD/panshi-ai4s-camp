import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CampClientError, createTransport, resolveCliBaseUrl } from './http.js'

const Envelope = z.object({ apiVersion: z.literal('v1'), data: z.object({ value: z.string() }) })

describe('shared camp transport', () => {
  it('defaults only to the loopback API', () => {
    expect(resolveCliBaseUrl()).toBe('http://127.0.0.1:3001')
  })

  it.each([
    'https://user:secret@example.org',
    'https://example.org?token=secret',
    'https://example.org/#fragment',
    'http://example.org',
    'file:///tmp/socket',
  ])('rejects unsafe base URL %s', (value) => {
    expect(() => resolveCliBaseUrl(value)).toThrow('Invalid camp API base URL')
  })

  it('allows local HTTP and production HTTPS', () => {
    expect(resolveCliBaseUrl('http://localhost:3001/')).toBe('http://localhost:3001')
    expect(resolveCliBaseUrl('https://camp.example.org/api/')).toBe('https://camp.example.org/api')
  })

  it('parses responses with the declared contract and sends bearer credentials', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      return new Response(JSON.stringify({ apiVersion: 'v1', data: { value: 'ok' } }), {
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' },
      })
    })
    const transport = createTransport({
      baseUrl: 'http://127.0.0.1:3001', fetch: fetchMock as typeof fetch,
      credentialProvider: { getToken: async () => 'a'.repeat(64) },
    })
    await expect(transport.json('public.site.show', '/api/test', { schema: Envelope })).resolves.toEqual({ apiVersion: 'v1', data: { value: 'ok' } })
  })

  it('never leaks a bearer token through network errors', async () => {
    const token = 'b'.repeat(64)
    const transport = createTransport({
      baseUrl: 'http://127.0.0.1:3001',
      credentialProvider: { getToken: async () => token },
      fetch: vi.fn(async () => { throw new Error(`socket failed ${token}`) }) as typeof fetch,
    })
    await expect(transport.json('auth.status', '/api/v1/me/profile', { schema: Envelope }))
      .rejects.toSatisfy((error: unknown) => error instanceof Error && !error.message.includes(token))
  })

  it('preserves stable API error details, request ID, and Retry-After', async () => {
    const transport = createTransport({
      baseUrl: 'http://127.0.0.1:3001',
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: '稍后重试', requestId: 'req-rate', details: { scope: 'login' } } }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30', 'X-Request-Id': 'req-rate' },
      })) as typeof fetch,
    })
    const error = await transport.json('auth.login', '/api/v1/auth/cli/login', { schema: Envelope }).catch((caught) => caught)
    expect(error).toBeInstanceOf(CampClientError)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, requestId: 'req-rate', retryAfter: '30', details: { scope: 'login' } })
  })

  it('returns a download stream without reading it into a buffer', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close() } })
    const response = new Response(body, { headers: { 'Content-Type': 'application/pdf' } })
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer')
    const blob = vi.spyOn(response, 'blob')
    const transport = createTransport({ baseUrl: 'http://127.0.0.1:3001', fetch: vi.fn(async () => response) as typeof fetch })
    const result = await transport.download('resource.download', '/api/v1/resources/id/download')
    expect(result.stream).toBeInstanceOf(ReadableStream)
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(blob).not.toHaveBeenCalled()
  })
})
