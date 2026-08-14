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
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= (daysInMonth[month - 1] ?? 0)
}, 'must be a real Gregorian date')

const ContactHrefSchema = z.string().trim().superRefine((value, context) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    context.addIssue({ code: 'custom', message: 'must be a valid contact URL' })
    return
  }

  if (url.protocol === 'https:') {
    if (url.username !== '' || url.password !== '') {
      context.addIssue({ code: 'custom', message: 'must not contain credentials' })
    }
    return
  }

  if (url.protocol === 'mailto:') {
    if (url.search !== '' || url.hash !== '' || !z.string().email().safeParse(url.pathname).success) {
      context.addIssue({ code: 'custom', message: 'must contain a valid email address' })
    }
    return
  }

  if (url.protocol === 'tel:') {
    const digits = url.pathname.replace(/\D/gu, '')
    if (url.search !== '' || url.hash !== '' || !/^\+?[0-9][0-9(). -]*$/u.test(url.pathname) || digits.length < 3) {
      context.addIssue({ code: 'custom', message: 'must contain a valid telephone number' })
    }
    return
  }

  context.addIssue({ code: 'custom', message: 'protocol must be https, mailto, or tel' })
})

export const BasicContentSchema = z.object({
  title: NonEmptyTextSchema,
  dates: z.object({
    start: IsoDateSchema,
    end: IsoDateSchema,
    label: NonEmptyTextSchema,
  }).strict().refine(({ start, end }) => start <= end, 'start date must not be after end date'),
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
    machineKey: z.enum(['registrationOpen', 'registrationDeadline', 'campStart', 'campEnd']).optional(),
  }).strict()),
}).strict()

export const ScheduleContentSchema = z.object({
  speakers: z.array(z.object({
    id: NonEmptyTextSchema,
    name: NonEmptyTextSchema,
  }).strict()).optional(),
  days: z.array(z.object({
    date: IsoDateSchema,
    label: NonEmptyTextSchema,
    theme: NonEmptyTextSchema,
    sessions: z.array(z.object({
      title: NonEmptyTextSchema,
      time: NonEmptyTextSchema.optional(),
      timeRange: z.object({
        start: z.string().regex(/^\d{2}:\d{2}$/u),
        end: z.string().regex(/^\d{2}:\d{2}$/u),
      }).strict().optional(),
      details: z.array(NonEmptyTextSchema).optional(),
      instructors: z.array(NonEmptyTextSchema).optional(),
      speakerIds: z.array(NonEmptyTextSchema).optional(),
    }).strict()),
  }).strict()),
}).strict()

const LegacyContactItemSchema = z.object({
  label: NonEmptyTextSchema,
  value: NonEmptyTextSchema,
  href: ContactHrefSchema.optional(),
}).strict()

const PhoneValueSchema = NonEmptyTextSchema.superRefine((value, context) => {
  const digits = value.replace(/\D/gu, '')
  if (!/^\+?[0-9][0-9(). -]*$/u.test(value) || digits.length < 3) {
    context.addIssue({ code: 'custom', message: 'must contain a valid telephone number' })
  }
})

const StructuredContactItemSchema = z.object({
  name: NonEmptyTextSchema,
  responsibility: NonEmptyTextSchema,
  methods: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('phone'), value: PhoneValueSchema }).strict(),
    z.object({ type: z.literal('email'), value: z.string().trim().email() }).strict(),
  ])).min(1),
  consultationNote: NonEmptyTextSchema.optional(),
}).strict()

export const ContactsContentSchema = z.object({
  items: z.array(z.union([LegacyContactItemSchema, StructuredContactItemSchema])),
}).strict()

export const TravelContentSchema = z.object({
  sections: z.array(z.object({
    title: NonEmptyTextSchema,
    body: NonEmptyTextSchema,
  }).strict()),
}).strict()

export const HomeSectionIdSchema = z.enum(['intro', 'target', 'features', 'organizations'])

export const DisplayContentSchema = z.object({
  series: NonEmptyTextSchema,
  footer: NonEmptyTextSchema,
  showRegistrationCount: z.boolean().optional(),
  visibleNavigation: z.array(NonEmptyTextSchema).optional(),
  homeSectionOrder: z.array(HomeSectionIdSchema).refine(
    (items) => new Set(items).size === items.length,
    'home section IDs must not repeat',
  ).optional(),
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
  }).strip(),
}).strip()

export const PublicScheduleResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    contentVersion: NonEmptyTextSchema,
    schedule: ScheduleContentSchema,
  }).strip(),
}).strip()

export const PublicContentModuleResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    contentVersion: NonEmptyTextSchema,
    key: ContentModuleKeySchema,
    payload: z.unknown(),
  }).strip(),
}).strip()

export type ContentModuleKey = z.infer<typeof ContentModuleKeySchema>
export type BasicContent = z.infer<typeof BasicContentSchema>
export type FeaturesContent = z.infer<typeof FeaturesContentSchema>
export type OrganizationsContent = z.infer<typeof OrganizationsContentSchema>
export type ImportantDatesContent = z.infer<typeof ImportantDatesContentSchema>
export type ScheduleContent = z.infer<typeof ScheduleContentSchema>
export type ContactsContent = z.infer<typeof ContactsContentSchema>
export type TravelContent = z.infer<typeof TravelContentSchema>
export type DisplayContent = z.infer<typeof DisplayContentSchema>
export type HomeSectionId = z.infer<typeof HomeSectionIdSchema>
export type ResourceAccess = z.infer<typeof ResourceAccessSchema>
export type PublicSiteResponse = z.infer<typeof PublicSiteResponseSchema>
export type PublicScheduleResponse = z.infer<typeof PublicScheduleResponseSchema>
