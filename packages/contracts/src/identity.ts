import { z } from 'zod'

export const UserRoleSchema = z.enum(['user', 'admin'])

export const AuthenticatedUserSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1),
  role: UserRoleSchema,
})

export const ProfileUserSchema = AuthenticatedUserSchema.extend({
  phoneNormalized: z.string().regex(/^\+86\d{11}$/u),
})

export const AdminLoginRequestSchema = z.object({
  phone: z.string().trim().min(1),
  password: z.string().min(1),
})

export const LoginResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    user: AuthenticatedUserSchema,
  }),
})

export const ProfileResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    user: ProfileUserSchema,
  }),
})

export type UserRole = z.infer<typeof UserRoleSchema>
export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>
export type LoginResponse = z.infer<typeof LoginResponseSchema>
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>

export const serializeLoginResponse = (input: unknown): LoginResponse => LoginResponseSchema.parse(input)
export const serializeProfileResponse = (input: unknown): ProfileResponse => ProfileResponseSchema.parse(input)
