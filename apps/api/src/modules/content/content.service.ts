import {
  PublicContentModuleResponseSchema,
  PublicScheduleResponseSchema,
  PublicSiteResponseSchema,
  type ContentModuleKey,
} from '@panshi/contracts'
import type { PublicContentRepository, PublishedContentRecord } from './content.repository.js'
import { parsePublishedContent } from './content.schemas.js'

const siteKeys = ['basic', 'importantDates', 'contacts', 'display'] as const

export class ContentNotFoundError extends Error {
  constructor(readonly key: ContentModuleKey) {
    super(`Published content is unavailable for ${key}`)
    this.name = 'ContentNotFoundError'
  }
}

const requireRecord = (
  records: readonly PublishedContentRecord[],
  key: ContentModuleKey,
) => {
  const record = records.find((candidate) => candidate.key === key)
  if (!record) throw new ContentNotFoundError(key)
  return record
}

const versionLabel = (record: PublishedContentRecord) => `${record.key}:${record.version}`

export const createContentService = (repository: PublicContentRepository) => ({
  getPublicSite: async () => {
    const records = await repository.findPublishedByKeys(siteKeys)
    const basic = requireRecord(records, 'basic')
    const importantDates = requireRecord(records, 'importantDates')
    const contacts = requireRecord(records, 'contacts')
    const display = requireRecord(records, 'display')

    return PublicSiteResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        contentVersion: [basic, importantDates, contacts, display].map(versionLabel).join(','),
        basic: parsePublishedContent('basic', basic.payload),
        importantDates: parsePublishedContent('importantDates', importantDates.payload),
        contacts: parsePublishedContent('contacts', contacts.payload),
        display: parsePublishedContent('display', display.payload),
      },
    })
  },

  getPublicSchedule: async () => {
    const record = requireRecord(await repository.findPublishedByKeys(['schedule']), 'schedule')
    return PublicScheduleResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        contentVersion: versionLabel(record),
        schedule: parsePublishedContent('schedule', record.payload),
      },
    })
  },

  getPublicModule: async (key: ContentModuleKey) => {
    if (key === 'schedule') throw new ContentNotFoundError(key)
    const record = requireRecord(await repository.findPublishedByKeys([key]), key)
    const response = PublicContentModuleResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        contentVersion: versionLabel(record),
        key,
        payload: parsePublishedContent(key, record.payload),
      },
    })
    return response
  },
})

export type ContentService = ReturnType<typeof createContentService>
