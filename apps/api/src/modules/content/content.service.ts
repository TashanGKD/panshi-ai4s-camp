import {
  PublicContentModuleResponseSchema,
  PublicScheduleResponseSchema,
  PublicSiteResponseSchema,
  type ContentModuleKey,
  type DisplayContent,
  type ScheduleContent,
} from '@panshi/contracts'
import type { PublicContentRepository, PublishedContentRecord } from './content.repository.js'
import { parsePublishedContent } from './content.schemas.js'
import { sanitizeContentPayload } from './content-sanitizer.js'

const siteKeys = ['basic', 'features', 'organizations', 'importantDates', 'schedule', 'contacts', 'display'] as const

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
const optionalRecord = (records: readonly PublishedContentRecord[], key: ContentModuleKey) => records.find((record) => record.key === key)

export const createContentService = (repository: PublicContentRepository) => ({
  getPublicSite: async () => {
    const records = await repository.findPublishedByKeys(siteKeys)
    const basic = requireRecord(records, 'basic')
    const importantDates = requireRecord(records, 'importantDates')
    const contacts = requireRecord(records, 'contacts')
    const display = requireRecord(records, 'display')
    const features = optionalRecord(records, 'features')
    const organizations = optionalRecord(records, 'organizations')
    const schedule = optionalRecord(records, 'schedule')
    const parsedDisplay = parsePublishedContent('display', display.payload) as DisplayContent
    const parsedSchedule = schedule ? parsePublishedContent('schedule', schedule.payload) as ScheduleContent : undefined
    const defaultNavigation = ['home', 'schedule', 'register', 'travel', 'contacts', 'resources', 'account'] as const
    const fixedNavigation = defaultNavigation.filter((key) => parsedDisplay.visibleNavigation?.includes(key) ?? true)
    const defaultOrder = ['intro', 'target', 'scale', 'features', 'scheduleOverview', 'guests', 'organizations', 'registrationCta', 'registrationCount'] as const

    return PublicSiteResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        contentVersion: [basic, features, organizations, importantDates, schedule, contacts, display].filter((record): record is PublishedContentRecord => Boolean(record)).map(versionLabel).join(','),
        basic: parsePublishedContent('basic', sanitizeContentPayload('basic', basic.payload)),
        importantDates: parsePublishedContent('importantDates', importantDates.payload),
        contacts: parsePublishedContent('contacts', contacts.payload),
        display: parsedDisplay,
        features: features ? parsePublishedContent('features', features.payload) : { items: [] },
        organizations: organizations ? parsePublishedContent('organizations', organizations.payload) : { items: [] },
        guests: parsedSchedule?.speakers?.flatMap((speaker) => speaker.profile ? [speaker.profile] : []) ?? [],
        homeSectionOrder: parsedDisplay.homeSectionOrder ?? defaultOrder,
        visibleNavigation: fixedNavigation,
        scheduleOverview: parsedSchedule?.days.slice(0, 6).map(({ date, label, theme }) => ({ date, label, theme })) ?? [],
        registrationCta: parsedDisplay.registrationCta ?? { label: '在线注册', to: '/application' },
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
        payload: parsePublishedContent(key, sanitizeContentPayload(key, record.payload)),
      },
    })
    return response
  },
})

export type ContentService = ReturnType<typeof createContentService>
