import { z } from 'zod'
import { ApplicationStatusSchema } from './registration.js'
import { ContentModuleKeySchema } from './content.js'

const CountSchema = z.number().int().nonnegative()
const statusCounts = Object.fromEntries(ApplicationStatusSchema.options.map((status) => [status, CountSchema])) as {
  [K in (typeof ApplicationStatusSchema.options)[number]]: typeof CountSchema
}

export const AdminSummaryResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    applications: z.object({
      total: CountSchema,
      pendingReview: CountSchema,
      byStatus: z.object(statusCounts).strict(),
    }).strict(),
    upcomingDates: z.array(z.object({
      machineKey: z.enum(['registrationOpen', 'registrationDeadline', 'campStart', 'campEnd']),
      label: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    }).strict()),
    unpublishedDrafts: z.array(z.object({
      key: ContentModuleKeySchema,
      revision: CountSchema,
    }).strict()),
    recentOperations: z.array(z.object({
      id: z.string().min(1),
      action: z.string().min(1),
      actorDisplayName: z.string().min(1).nullable(),
      createdAt: z.string().datetime({ offset: true }),
    }).strict()),
  }).strict(),
}).strict()

export type AdminSummaryResponse = z.infer<typeof AdminSummaryResponseSchema>
