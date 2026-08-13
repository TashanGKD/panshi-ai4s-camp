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

export const ResourceAccessSchema = z.enum(['public', 'authenticated', 'admitted'])

export const PublicSiteResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    contentVersion: z.string().min(1),
    modules: z.array(ContentModuleKeySchema),
  }),
})

export type ContentModuleKey = z.infer<typeof ContentModuleKeySchema>
export type ResourceAccess = z.infer<typeof ResourceAccessSchema>
export type PublicSiteResponse = z.infer<typeof PublicSiteResponseSchema>
