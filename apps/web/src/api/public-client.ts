import { AdminContentPreviewResponseSchema, ApiErrorSchema, type AdminContentPreviewResponse, type ContentModuleKey } from '@panshi/contracts'
import { CampClientError } from '@panshi/camp-client'
import { createBrowserCampClient, resolveApiBaseUrl, type PublicClientRuntime, type ResolvedApiBaseUrl } from './browser-client'

export { resolveApiBaseUrl }
export type { PublicClientRuntime, ResolvedApiBaseUrl }

export class PublicContentNotFoundError extends Error {
  constructor() { super('Published content was not found'); this.name = 'PublicContentNotFoundError' }
}
export class PreviewAccessError extends Error {
  constructor(readonly status: 401 | 403) { super('Draft preview access denied'); this.name = 'PreviewAccessError' }
}

const mapPublicError = (error: unknown): never => {
  if (error instanceof CampClientError && (error.status === 404 || error.code === 'CONTENT_NOT_FOUND')) throw new PublicContentNotFoundError()
  throw error
}
const filenameFrom = (headers: Headers) => {
  const disposition = headers.get('Content-Disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1]
  return encoded ? decodeURIComponent(encoded) : '资料文件'
}

export const createPublicClient = (apiBaseUrl?: string, runtime: PublicClientRuntime = { production: false }) => {
  const { client, resolved } = createBrowserCampClient(apiBaseUrl, runtime)
  const getDraftPreview = async (key: ContentModuleKey): Promise<AdminContentPreviewResponse> => {
    const response = await fetch(`${resolved.prefix}/api/v1/admin/content/${key}/preview`, { credentials: resolved.credentials, headers: { Accept: 'application/json' } })
    if (response.status === 401 || response.status === 403) throw new PreviewAccessError(response.status)
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => undefined))
      throw new Error(parsed.success ? parsed.data.error.message : 'Draft preview request failed')
    }
    return AdminContentPreviewResponseSchema.parse(await response.json())
  }
  return {
    getPublicSite: () => client.public.getSite().catch(mapPublicError),
    getPublicSchedule: () => client.public.getSchedule().catch(mapPublicError),
    getPublicTravel: () => client.public.getTravel().catch(mapPublicError),
    getResources: () => client.public.listResources(),
    getApplicationCount: async (signal?: AbortSignal) => (await client.public.getApplicationCount(signal)).data,
    getDraftPreview,
    downloadResource: async (downloadUrl: string) => {
      const match = downloadUrl.match(/^\/api\/v1\/resources\/([0-9a-f-]+)\/download$/u)
      if (!match) throw new Error('Invalid resource download URL')
      const result = await client.public.downloadResource(match[1]!)
      return { blob: await new Response(result.stream, { headers: result.headers }).blob(), filename: filenameFrom(result.headers) }
    },
  }
}

const publicClient = createPublicClient(import.meta.env.VITE_API_BASE_URL, { production: import.meta.env.PROD, pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin })
export const getPublicSite = publicClient.getPublicSite
export const getPublicSchedule = publicClient.getPublicSchedule
export const getPublicTravel = publicClient.getPublicTravel
export const getDraftPreview = publicClient.getDraftPreview
export const getResources = publicClient.getResources
export const getApplicationCount = publicClient.getApplicationCount
export const downloadResource = publicClient.downloadResource
