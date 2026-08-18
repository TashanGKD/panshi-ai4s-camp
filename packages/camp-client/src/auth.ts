import {
  CliLoginResponseSchema, JsonObjectSchema, LoginResponseSchema, ProfileResponseSchema, RegistrationResponseSchema,
  type PasswordResetRequest, type SendVerificationCodeRequest, type StudentLoginRequest, type StudentRegistrationRequest,
} from '@panshi/contracts'
import type { CampTransport } from './http.js'
import { confirmationHeaders, type ConfirmedOperation } from './confirmations.js'

const jsonBody = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

export const createAuthApi = (transport: CampTransport) => ({
  sendVerificationCode: (body: SendVerificationCodeRequest, confirmation: ConfirmedOperation) => transport.json('auth.verification.send', '/api/v1/auth/verification/send', { schema: JsonObjectSchema, method: 'POST', ...jsonBody(body), headers: { ...jsonBody(body).headers, ...confirmationHeaders(confirmation) } }),
  register: (body: StudentRegistrationRequest, confirmation: ConfirmedOperation) => transport.json('auth.register', '/api/v1/auth/register', { schema: RegistrationResponseSchema, method: 'POST', ...jsonBody(body), headers: { ...jsonBody(body).headers, ...confirmationHeaders(confirmation) } }),
  loginWeb: (body: StudentLoginRequest, confirmation: ConfirmedOperation) => transport.json('auth.login', '/api/v1/auth/login', { schema: LoginResponseSchema, method: 'POST', ...jsonBody(body), headers: { ...jsonBody(body).headers, ...confirmationHeaders(confirmation) } }),
  loginCli: (body: StudentLoginRequest, confirmation: ConfirmedOperation) => transport.json('auth.login', '/api/v1/auth/cli/login', { schema: CliLoginResponseSchema, method: 'POST', ...jsonBody(body), headers: { ...jsonBody(body).headers, ...confirmationHeaders(confirmation) } }),
  status: () => transport.json('auth.status', '/api/v1/me/profile', { schema: ProfileResponseSchema }),
  resetPassword: (body: PasswordResetRequest, confirmation: ConfirmedOperation) => transport.json('auth.password_reset', '/api/v1/auth/password/reset', { schema: JsonObjectSchema, method: 'POST', ...jsonBody(body), headers: { ...jsonBody(body).headers, ...confirmationHeaders(confirmation) } }),
  changePassword: (body: { currentPassword: string, newPassword: string }, confirmation: ConfirmedOperation) => transport.json('account.password_change', '/api/v1/me/account/password', { schema: JsonObjectSchema, method: 'POST', ...jsonBody(body), headers: { ...jsonBody(body).headers, ...confirmationHeaders(confirmation) } }),
  logoutWeb: (confirmation: ConfirmedOperation) => transport.json('auth.logout', '/api/v1/auth/logout', { schema: JsonObjectSchema, method: 'POST', ...jsonBody({}), headers: { ...jsonBody({}).headers, ...confirmationHeaders(confirmation) } }),
  logoutCli: (confirmation: ConfirmedOperation) => transport.json('auth.logout', '/api/v1/auth/cli/logout', { schema: JsonObjectSchema, method: 'POST', ...jsonBody({}), headers: { ...jsonBody({}).headers, ...confirmationHeaders(confirmation) } }),
})
