import { ApiErrorSchema, type LearnerCapabilityId } from '@panshi/contracts'
import type { ZodType } from 'zod'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const TOKEN_PATTERN = /^[a-f0-9]{64}$/u

export type CredentialProvider = { getToken(): Promise<string | null> }

export type TransportOptions = {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  credentialProvider?: CredentialProvider
  credentials?: RequestCredentials
}

export type JsonRequestOptions<T> = {
  schema: ZodType<T>
  method?: string
  body?: BodyInit | null
  headers?: HeadersInit
  signal?: AbortSignal
}

export type DownloadResult = {
  stream: ReadableStream<Uint8Array>
  headers: Headers
  status: number
}

export class CampClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly details?: unknown,
    readonly retryAfter?: string,
  ) {
    super(message)
    this.name = 'CampClientError'
  }
}

const invalidBaseUrl = () => new Error('Invalid camp API base URL')

export const resolveCliBaseUrl = (value?: string): string => {
  const candidate = value?.trim() || 'http://127.0.0.1:3001'
  let url: URL
  try { url = new URL(candidate) } catch { throw invalidBaseUrl() }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
    || (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname))
  ) throw invalidBaseUrl()
  const path = url.pathname.replace(/\/+$/u, '')
  return `${url.origin}${path}`
}

const parseError = async (response: Response) => {
  const parsed = ApiErrorSchema.safeParse(await response.clone().json().catch(() => undefined))
  const requestId = parsed.success ? parsed.data.error.requestId : response.headers.get('X-Request-Id') ?? undefined
  return new CampClientError(
    parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
    parsed.success ? parsed.data.error.message : `Request failed with status ${response.status}`,
    response.status,
    requestId,
    parsed.success ? parsed.data.error.details : undefined,
    response.headers.get('Retry-After') ?? undefined,
  )
}

export const createTransport = (options: TransportOptions) => {
  const baseUrl = resolveCliBaseUrl(options.baseUrl)
  const fetchImpl = options.fetch ?? globalThis.fetch
  const request = async (capabilityId: LearnerCapabilityId | null, path: string, init: RequestInit = {}) => {
    let token: string | null = null
    try {
      token = await options.credentialProvider?.getToken() ?? null
      if (token !== null && !TOKEN_PATTERN.test(token)) throw new CampClientError('UNAUTHORIZED', 'Stored credential is invalid', 401)
      const headers = new Headers(init.headers)
      if (!headers.has('Accept')) headers.set('Accept', 'application/json')
      if (capabilityId) headers.set('X-Capability-Id', capabilityId)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      return await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        credentials: token ? 'omit' : options.credentials ?? 'include',
      })
    } catch (error) {
      if (error instanceof CampClientError) throw error
      throw new CampClientError('SERVICE_UNAVAILABLE', 'Network request failed', 0)
    } finally {
      token = null
    }
  }

  const json = async <T>(capabilityId: LearnerCapabilityId, path: string, options: JsonRequestOptions<T>): Promise<T> => {
    const response = await request(capabilityId, path, {
      method: options.method ?? 'GET', body: options.body, headers: options.headers, signal: options.signal,
    })
    if (!response.ok) throw await parseError(response)
    const value = response.status === 204 ? {} : await response.json()
    const parsed = options.schema.safeParse(value)
    if (!parsed.success) throw new CampClientError('INVALID_RESPONSE', 'Server response did not match its contract', response.status, response.headers.get('X-Request-Id') ?? undefined)
    return parsed.data
  }

  const controlJson = async <T>(path: string, options: JsonRequestOptions<T>): Promise<T> => {
    const response = await request(null, path, {
      method: options.method ?? 'GET', body: options.body, headers: options.headers, signal: options.signal,
    })
    if (!response.ok) throw await parseError(response)
    const value = response.status === 204 ? {} : await response.json()
    const parsed = options.schema.safeParse(value)
    if (!parsed.success) throw new CampClientError('INVALID_RESPONSE', 'Server response did not match its contract', response.status, response.headers.get('X-Request-Id') ?? undefined)
    return parsed.data
  }

  const download = async (
    capabilityId: LearnerCapabilityId,
    path: string,
    options: { signal?: AbortSignal, onHeaders?: (headers: Headers, status: number) => void } = {},
  ): Promise<DownloadResult> => {
    const response = await request(capabilityId, path, { method: 'GET', signal: options.signal, headers: { Accept: 'application/octet-stream' } })
    if (!response.ok) throw await parseError(response)
    if (!response.body) throw new CampClientError('INVALID_RESPONSE', 'Download response had no body', response.status, response.headers.get('X-Request-Id') ?? undefined)
    options.onHeaders?.(response.headers, response.status)
    return { stream: response.body, headers: response.headers, status: response.status }
  }

  return { baseUrl, json, controlJson, download }
}

export type CampTransport = ReturnType<typeof createTransport>
