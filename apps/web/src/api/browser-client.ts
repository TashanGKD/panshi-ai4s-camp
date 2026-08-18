import { createCampClient } from '@panshi/camp-client'

export type ResolvedApiBaseUrl = { credentials: RequestCredentials, prefix: string }
export type PublicClientRuntime = { production: boolean, pageOrigin?: string }
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const invalidApiBaseUrl = () => new Error('Invalid VITE_API_BASE_URL: expected an absolute HTTP(S) URL without credentials, query, or fragment')

export const resolveApiBaseUrl = (value?: string, runtime: PublicClientRuntime = { production: false }): ResolvedApiBaseUrl => {
  const candidate = value?.trim() ?? ''
  if (candidate === '') return { prefix: '', credentials: 'same-origin' }
  let url: URL
  try { url = new URL(candidate) } catch { throw invalidApiBaseUrl() }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol === 'http:' && (runtime.production || !loopbackHosts.has(url.hostname)))) throw invalidApiBaseUrl()
  if (!runtime.production && runtime.pageOrigin) {
    try {
      const pageUrl = new URL(runtime.pageOrigin)
      if (loopbackHosts.has(url.hostname) && loopbackHosts.has(pageUrl.hostname)) url.hostname = pageUrl.hostname
    } catch { /* Browser runtime owns pageOrigin. */ }
  }
  return { prefix: `${url.origin}${url.pathname.replace(/\/+$/u, '')}`, credentials: 'include' }
}

export const createBrowserCampClient = (apiBaseUrl?: string, runtime: PublicClientRuntime = { production: false }) => {
  const resolved = resolveApiBaseUrl(apiBaseUrl, runtime)
  const browserFetch: typeof fetch = (input, init) => {
    if (resolved.prefix !== '') return globalThis.fetch(input, init)
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    return globalThis.fetch(`${url.pathname}${url.search}`, init)
  }
  return { client: createCampClient({ baseUrl: resolved.prefix || 'http://localhost', fetch: browserFetch, credentials: resolved.credentials }), resolved }
}
