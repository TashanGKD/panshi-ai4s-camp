import { z } from 'zod'

const mainlandChinaMobileInputPattern = /^(?:\+86)?1[3-9]\d{9}$/u
const mainlandChinaMobileNormalizedPattern = /^\+861[3-9]\d{9}$/u
const utf8Encoder = new TextEncoder()

export const MainlandChinaMobileSchema = z.string()
  .regex(mainlandChinaMobileInputPattern)
  .transform((phone) => phone.startsWith('+86') ? phone : `+86${phone}`)

export const MainlandChinaMobileNormalizedSchema = z.string().regex(mainlandChinaMobileNormalizedPattern)

export const PasswordSchema = z.string().superRefine((password, context) => {
  const byteLength = utf8Encoder.encode(password).byteLength
  if (byteLength < 8 || byteLength > 72) {
    context.addIssue({ code: 'custom', message: 'Password must be 8 to 72 UTF-8 bytes' })
  }
})

export const normalizeMainlandChinaMobile = (input: string): string => {
  const result = MainlandChinaMobileSchema.safeParse(input)
  if (!result.success) throw new Error('Invalid mainland China mobile number')
  return result.data
}

export const validatePassword = (input: string): string => {
  const result = PasswordSchema.safeParse(input)
  if (!result.success) throw new Error('Password must be 8 to 72 UTF-8 bytes')
  return result.data
}

export const UserRoleSchema = z.enum(['user', 'admin'])

export const AuthenticatedUserSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1),
  role: UserRoleSchema,
})

export const ProfileUserSchema = AuthenticatedUserSchema.extend({
  phoneNormalized: MainlandChinaMobileNormalizedSchema,
})

export const AdminLoginRequestSchema = z.object({
  phone: MainlandChinaMobileSchema,
  password: PasswordSchema,
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
