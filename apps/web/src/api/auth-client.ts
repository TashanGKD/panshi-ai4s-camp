import {
  ApiErrorSchema,
  LoginResponseSchema,
  RegistrationResponseSchema,
  type LoginResponse,
  type RegistrationResponse,
  type JsonObject,
  type VerificationPurpose,
} from '@panshi/contracts'
import { resolveApiBaseUrl, type PublicClientRuntime } from './public-client'
import { confirmationClient, maskMainlandPhone } from './confirmation-client'

export class AuthApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'AuthApiError'
  }
}

export const createAuthClient = (apiBaseUrl?: string, runtime: PublicClientRuntime = { production: false }) => {
  const { credentials, prefix } = resolveApiBaseUrl(apiBaseUrl, runtime)
  const request = async (path: string, body: Record<string, unknown>, confirmation?: Awaited<ReturnType<typeof confirmationClient.prepare>>) => {
    const response = await fetch(`${prefix}${path}`, {
      method: 'POST', credentials,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(confirmation ? confirmationClient.headers(confirmation) : {}) },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => undefined))
      throw new AuthApiError(
        parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
        parsed.success ? parsed.data.error.message : '请求失败，请稍后重试',
        response.status,
      )
    }
    return response.status === 204 ? undefined : response.json()
  }
  const confirmed = async (capabilityId: Parameters<typeof confirmationClient.prepare>[0], previewPayload: JsonObject, path: string, body: Record<string, unknown>) => {
    const prepared = await confirmationClient.prepare(capabilityId, previewPayload)
    if (!confirmationClient.requestConfirmation(prepared)) throw new AuthApiError('CONFIRMATION_CANCELLED', '操作已取消', 409)
    return request(path, body, prepared)
  }
  return {
    sendVerificationCode: (phone: string, purpose: VerificationPurpose) => confirmed('auth.verification.send', { phoneMasked: maskMainlandPhone(phone), purpose }, '/api/v1/auth/verification/send', { phone, purpose }),
    register: async (phone: string, code: string, password: string): Promise<RegistrationResponse> => RegistrationResponseSchema.parse(
      await confirmed('auth.register', { phoneMasked: maskMainlandPhone(phone) }, '/api/v1/auth/register', { phone, code, password }),
    ),
    login: async (phone: string, password: string): Promise<LoginResponse> => LoginResponseSchema.parse(
      await confirmed('auth.login', { phoneMasked: maskMainlandPhone(phone), clientKind: 'web' }, '/api/v1/auth/login', { phone, password }),
    ),
    resetPassword: (phone: string, code: string, newPassword: string) => confirmed('auth.password_reset', { phoneMasked: maskMainlandPhone(phone) }, '/api/v1/auth/password/reset', { phone, code, newPassword }),
    changePassword: (currentPassword: string, newPassword: string) => confirmed('account.password_change', { account: 'self' }, '/api/v1/me/account/password', { currentPassword, newPassword }),
    logout: () => confirmed('auth.logout', { scope: 'current' }, '/api/v1/auth/logout', {}),
  }
}

const authClient = createAuthClient(import.meta.env.VITE_API_BASE_URL, {
  production: import.meta.env.PROD,
  pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin,
})
export const sendVerificationCode = authClient.sendVerificationCode
export const registerStudent = authClient.register
export const loginStudent = authClient.login
export const resetStudentPassword = authClient.resetPassword
export const changeStudentPassword = authClient.changePassword
export const logoutStudent = authClient.logout
