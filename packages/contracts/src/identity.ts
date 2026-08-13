import { z } from 'zod'

export const UserRoleSchema = z.enum(['user', 'admin'])

export const LoginResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    user: z.object({
      id: z.string().min(1),
      role: UserRoleSchema,
    }),
  }),
})

export type UserRole = z.infer<typeof UserRoleSchema>
export type LoginResponse = z.infer<typeof LoginResponseSchema>
