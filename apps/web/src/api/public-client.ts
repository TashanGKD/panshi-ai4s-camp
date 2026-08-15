import {
  PublicContentModuleResponseSchema,
  PublicScheduleResponseSchema,
  PublicSiteResponseSchema,
  AdminContentPreviewResponseSchema,
  TravelContentSchema,
  type PublicScheduleResponse,
  type PublicSiteResponse,
  type TravelContent,
  type AdminContentPreviewResponse,
  type ContentModuleKey,
  ResourceListResponseSchema,
  ApplicationCountResponseSchema,
  type ResourceListResponse,
  type ApplicationCountResponse,
} from '@panshi/contracts'

export class PublicContentNotFoundError extends Error {
  constructor() {
    super('Published content was not found')
    this.name = 'PublicContentNotFoundError'
  }
}

export class PreviewAccessError extends Error {
  constructor(readonly status: 401 | 403) {
    super('Draft preview access denied')
    this.name = 'PreviewAccessError'
  }
}

export type ResolvedApiBaseUrl = {
  credentials: RequestCredentials
  prefix: string
}

type PublicClientRuntime = { production: boolean }
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

const invalidApiBaseUrl = () => new Error(
  'Invalid VITE_API_BASE_URL: expected an absolute HTTP(S) URL without credentials, query, or fragment',
)

export const resolveApiBaseUrl = (value?: string, runtime: PublicClientRuntime = { production: false }): ResolvedApiBaseUrl => {
  const candidate = value?.trim() ?? ''
  if (candidate === '') return { prefix: '', credentials: 'same-origin' }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw invalidApiBaseUrl()
  }

  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || (url.protocol === 'http:' && (runtime.production || !loopbackHosts.has(url.hostname)))
  ) {
    throw invalidApiBaseUrl()
  }

  const normalizedPath = url.pathname.replace(/\/+$/u, '')
  return {
    prefix: `${url.origin}${normalizedPath}`,
    credentials: 'include',
  }
}

export const createPublicClient = (apiBaseUrl?: string, runtime: PublicClientRuntime = { production: false }) => {
  const { credentials, prefix } = resolveApiBaseUrl(apiBaseUrl, runtime)

  const getJson = async (path: string): Promise<unknown> => {
    const response = await fetch(`${prefix}${path}`, {
      credentials,
      headers: { Accept: 'application/json' },
    })
    if (response.status === 404) throw new PublicContentNotFoundError()
    if (!response.ok) throw new Error('Public content request failed')
    return response.json()
  }

  const getDraftPreview = async (key: ContentModuleKey): Promise<AdminContentPreviewResponse> => {
    const response = await fetch(`${prefix}/api/v1/admin/content/${key}/preview`, {
      credentials,
      headers: { Accept: 'application/json' },
    })
    if (response.status === 401 || response.status === 403) throw new PreviewAccessError(response.status)
    if (!response.ok) throw new Error('Draft preview request failed')
    return AdminContentPreviewResponseSchema.parse(await response.json())
  }

  const getPublicSite = async (): Promise<PublicSiteResponse> => (
    PublicSiteResponseSchema.parse(await getJson('/api/v1/public/site'))
  )

  const getPublicSchedule = async (): Promise<PublicScheduleResponse> => (
    PublicScheduleResponseSchema.parse(await getJson('/api/v1/public/schedule'))
  )

  const getPublicTravel = async (): Promise<TravelContent> => {
    const response = PublicContentModuleResponseSchema.parse(
      await getJson('/api/v1/public/content/travel'),
    )
    if (response.data.key !== 'travel') throw new Error('Unexpected public content module')
    return TravelContentSchema.parse(response.data.payload)
  }

  const getResources = async (): Promise<ResourceListResponse> => ResourceListResponseSchema.parse(await getJson('/api/v1/resources'))
  const getApplicationCount = async (signal?: AbortSignal): Promise<ApplicationCountResponse['data']> => {
    const response = await fetch(`${prefix}/api/v1/public/statistics/applications`, { credentials, headers: { Accept: 'application/json' }, signal })
    if (!response.ok) throw new Error('Application count request failed')
    return ApplicationCountResponseSchema.parse(await response.json()).data
  }
  const downloadResource = async (downloadUrl: string): Promise<{ blob: Blob, filename: string }> => {
    if (!/^\/api\/v1\/resources\/[0-9a-f-]+\/download$/u.test(downloadUrl)) throw new Error('Invalid resource download URL')
    const response = await fetch(`${prefix}${downloadUrl}`, { credentials, headers: { Accept: 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document' } })
    if (!response.ok) throw new Error(response.status === 404 ? 'RESOURCE_NOT_AVAILABLE' : 'RESOURCE_DOWNLOAD_FAILED')
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1]
    return { blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : '资料文件' }
  }

  return { downloadResource, getApplicationCount, getDraftPreview, getPublicSchedule, getPublicSite, getPublicTravel, getResources }
}

const publicClient = createPublicClient(import.meta.env.VITE_API_BASE_URL, { production: import.meta.env.PROD })

export const getPublicSite = publicClient.getPublicSite
export const getPublicSchedule = publicClient.getPublicSchedule
export const getPublicTravel = publicClient.getPublicTravel
export const getDraftPreview = publicClient.getDraftPreview
export const getResources = publicClient.getResources
export const getApplicationCount = publicClient.getApplicationCount
export const downloadResource = publicClient.downloadResource
