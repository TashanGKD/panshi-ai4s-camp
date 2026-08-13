import {
  PublicContentModuleResponseSchema,
  PublicScheduleResponseSchema,
  PublicSiteResponseSchema,
  TravelContentSchema,
  type PublicScheduleResponse,
  type PublicSiteResponse,
  type TravelContent,
} from '@panshi/contracts'

export class PublicContentNotFoundError extends Error {
  constructor() {
    super('Published content was not found')
    this.name = 'PublicContentNotFoundError'
  }
}

export type ResolvedApiBaseUrl = {
  credentials: RequestCredentials
  prefix: string
}

const invalidApiBaseUrl = () => new Error(
  'Invalid VITE_API_BASE_URL: expected an absolute HTTP(S) URL without credentials, query, or fragment',
)

export const resolveApiBaseUrl = (value?: string): ResolvedApiBaseUrl => {
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
  ) {
    throw invalidApiBaseUrl()
  }

  const normalizedPath = url.pathname.replace(/\/+$/u, '')
  return {
    prefix: `${url.origin}${normalizedPath}`,
    credentials: 'include',
  }
}

export const createPublicClient = (apiBaseUrl?: string) => {
  const { credentials, prefix } = resolveApiBaseUrl(apiBaseUrl)

  const getJson = async (path: string): Promise<unknown> => {
    const response = await fetch(`${prefix}${path}`, {
      credentials,
      headers: { Accept: 'application/json' },
    })
    if (response.status === 404) throw new PublicContentNotFoundError()
    if (!response.ok) throw new Error('Public content request failed')
    return response.json()
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

  return { getPublicSchedule, getPublicSite, getPublicTravel }
}

const publicClient = createPublicClient(import.meta.env.VITE_API_BASE_URL)

export const getPublicSite = publicClient.getPublicSite
export const getPublicSchedule = publicClient.getPublicSchedule
export const getPublicTravel = publicClient.getPublicTravel
