import { z } from 'zod'

export const ContentModuleKeySchema = z.enum([
  'basic',
  'features',
  'organizations',
  'importantDates',
  'schedule',
  'contacts',
  'travel',
  'display',
])

const NonEmptyTextSchema = z.string().trim().min(1)
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)

export const BasicContentSchema = z.object({
  title: NonEmptyTextSchema,
  dates: z.object({
    start: IsoDateSchema,
    end: IsoDateSchema,
    label: NonEmptyTextSchema,
  }).strict(),
  venue: NonEmptyTextSchema,
  tagline: NonEmptyTextSchema.optional(),
  intro: z.array(NonEmptyTextSchema),
  target: NonEmptyTextSchema.optional(),
}).strict()

export const FeaturesContentSchema = z.object({
  items: z.array(z.object({
    title: NonEmptyTextSchema,
    description: NonEmptyTextSchema,
  }).strict()),
}).strict()

export const OrganizationsContentSchema = z.object({
  items: z.array(z.object({
    role: NonEmptyTextSchema,
    name: NonEmptyTextSchema,
  }).strict()),
}).strict()

export const ImportantDatesContentSchema = z.object({
  items: z.array(z.object({
    label: NonEmptyTextSchema,
    value: NonEmptyTextSchema,
  }).strict()),
}).strict()

export const ScheduleContentSchema = z.object({
  days: z.array(z.object({
    date: IsoDateSchema,
    label: NonEmptyTextSchema,
    theme: NonEmptyTextSchema,
    sessions: z.array(z.object({
      title: NonEmptyTextSchema,
      time: NonEmptyTextSchema.optional(),
      details: z.array(NonEmptyTextSchema).optional(),
      instructors: z.array(NonEmptyTextSchema).optional(),
    }).strict()),
  }).strict()),
}).strict()

export const ContactsContentSchema = z.object({
  items: z.array(z.object({
    label: NonEmptyTextSchema,
    value: NonEmptyTextSchema,
    href: z.string().url().optional(),
  }).strict()),
}).strict()

export const TravelContentSchema = z.object({
  sections: z.array(z.object({
    title: NonEmptyTextSchema,
    body: NonEmptyTextSchema,
  }).strict()),
}).strict()

export const DisplayContentSchema = z.object({
  series: NonEmptyTextSchema,
  footer: NonEmptyTextSchema,
}).strict()

export const PublicContentPayloadSchemas = {
  basic: BasicContentSchema,
  features: FeaturesContentSchema,
  organizations: OrganizationsContentSchema,
  importantDates: ImportantDatesContentSchema,
  schedule: ScheduleContentSchema,
  contacts: ContactsContentSchema,
  travel: TravelContentSchema,
  display: DisplayContentSchema,
} as const satisfies Record<ContentModuleKey, z.ZodType>

export const ResourceAccessSchema = z.enum(['public', 'authenticated', 'admitted'])

export const PublicSiteResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    contentVersion: NonEmptyTextSchema,
    basic: BasicContentSchema,
    importantDates: ImportantDatesContentSchema,
    contacts: ContactsContentSchema,
    display: DisplayContentSchema,
  }).strict(),
}).strict()

export const PublicScheduleResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    contentVersion: NonEmptyTextSchema,
    schedule: ScheduleContentSchema,
  }).strict(),
}).strict()

export const PublicContentModuleResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    contentVersion: NonEmptyTextSchema,
    key: ContentModuleKeySchema,
    payload: z.unknown(),
  }).strict(),
}).strict()

export type ContentModuleKey = z.infer<typeof ContentModuleKeySchema>
export type BasicContent = z.infer<typeof BasicContentSchema>
export type FeaturesContent = z.infer<typeof FeaturesContentSchema>
export type OrganizationsContent = z.infer<typeof OrganizationsContentSchema>
export type ImportantDatesContent = z.infer<typeof ImportantDatesContentSchema>
export type ScheduleContent = z.infer<typeof ScheduleContentSchema>
export type ContactsContent = z.infer<typeof ContactsContentSchema>
export type TravelContent = z.infer<typeof TravelContentSchema>
export type DisplayContent = z.infer<typeof DisplayContentSchema>
export type ResourceAccess = z.infer<typeof ResourceAccessSchema>
export type PublicSiteResponse = z.infer<typeof PublicSiteResponseSchema>
export type PublicScheduleResponse = z.infer<typeof PublicScheduleResponseSchema>
