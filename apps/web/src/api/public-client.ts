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

const getJson = async (path: string): Promise<unknown> => {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 404) throw new PublicContentNotFoundError()
  if (!response.ok) throw new Error('Public content request failed')
  return response.json()
}

export const getPublicSite = async (): Promise<PublicSiteResponse> => (
  PublicSiteResponseSchema.parse(await getJson('/api/v1/public/site'))
)

export const getPublicSchedule = async (): Promise<PublicScheduleResponse> => (
  PublicScheduleResponseSchema.parse(await getJson('/api/v1/public/schedule'))
)

export const getPublicTravel = async (): Promise<TravelContent> => {
  const response = PublicContentModuleResponseSchema.parse(
    await getJson('/api/v1/public/content/travel'),
  )
  if (response.data.key !== 'travel') throw new Error('Unexpected public content module')
  return TravelContentSchema.parse(response.data.payload)
}
