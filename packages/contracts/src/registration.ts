import { z } from 'zod'

export const ApplicationStatusSchema = z.enum([
  'draft',
  'submitted',
  'reviewing',
  'needs_supplement',
  'admitted',
  'waitlisted',
  'rejected',
])

export const RegistrationSnapshotSchema = z.object({
  formVersion: z.string().min(1),
  submittedAt: z.iso.datetime(),
  answers: z.record(z.string().min(1), z.unknown()),
}).readonly()

export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>
export type RegistrationSnapshot = z.infer<typeof RegistrationSnapshotSchema>
