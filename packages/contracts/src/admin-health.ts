import { z } from 'zod'

export const AdminSystemHealthResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    status: z.enum(['healthy', 'degraded']),
    checkedAt: z.iso.datetime(),
    version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u).or(z.literal('unknown')),
    database: z.object({ connected: z.boolean() }).strict(),
    uploads: z.object({ writable: z.boolean(), freeBytes: z.number().int().nonnegative().nullable() }).strict(),
    backup: z.object({ available: z.boolean(), lastSuccessfulAt: z.iso.datetime().nullable() }).strict(),
  }).strict(),
}).strict()

export type AdminSystemHealthResponse = z.infer<typeof AdminSystemHealthResponseSchema>
