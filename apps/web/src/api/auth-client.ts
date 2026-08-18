import { CampClientError } from '@panshi/camp-client'
import type { VerificationPurpose } from '@panshi/contracts'
import { createBrowserCampClient, type PublicClientRuntime } from './browser-client'
import { confirmationClient, maskMainlandPhone, type PreparedConfirmation } from './confirmation-client'

export class AuthApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = 'AuthApiError' }
}
const operation = (prepared: PreparedConfirmation) => ({ confirmationId: prepared.confirmationId, clientBinding: prepared.clientBinding, idempotencyKey: prepared.idempotencyKey })
const map = (error: unknown): never => {
  if (error instanceof CampClientError) throw new AuthApiError(error.code, error.message, error.status)
  throw error
}

export const createAuthClient = (apiBaseUrl?: string, runtime: PublicClientRuntime = { production: false }) => {
  const { client } = createBrowserCampClient(apiBaseUrl, runtime)
  const confirmed = async <T>(capabilityId: Parameters<typeof confirmationClient.prepare>[0], preview: Parameters<typeof confirmationClient.prepare>[1], execute: (prepared: PreparedConfirmation) => Promise<T>) => {
    const prepared = await confirmationClient.prepare(capabilityId, preview)
    if (!confirmationClient.requestConfirmation(prepared)) throw new AuthApiError('CONFIRMATION_CANCELLED', '操作已取消', 409)
    return execute(prepared).catch(map)
  }
  return {
    sendVerificationCode: (phone: string, purpose: VerificationPurpose) => confirmed('auth.verification.send', { phoneMasked: maskMainlandPhone(phone), purpose }, (prepared) => client.auth.sendVerificationCode({ phone, purpose }, operation(prepared))),
    register: (phone: string, code: string, password: string) => confirmed('auth.register', { phoneMasked: maskMainlandPhone(phone) }, (prepared) => client.auth.register({ phone, code, password }, operation(prepared))),
    login: (phone: string, password: string) => confirmed('auth.login', { phoneMasked: maskMainlandPhone(phone), clientKind: 'web' }, (prepared) => client.auth.loginWeb({ phone, password }, operation(prepared))),
    resetPassword: (phone: string, code: string, newPassword: string) => confirmed('auth.password_reset', { phoneMasked: maskMainlandPhone(phone) }, (prepared) => client.auth.resetPassword({ phone, code, newPassword }, operation(prepared))),
    changePassword: (currentPassword: string, newPassword: string) => confirmed('account.password_change', { account: 'self' }, (prepared) => client.auth.changePassword({ currentPassword, newPassword }, operation(prepared))),
    logout: () => confirmed('auth.logout', { scope: 'current' }, (prepared) => client.auth.logoutWeb(operation(prepared))),
  }
}

const authClient = createAuthClient(import.meta.env.VITE_API_BASE_URL, { production: import.meta.env.PROD, pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin })
export const sendVerificationCode = authClient.sendVerificationCode
export const registerStudent = authClient.register
export const loginStudent = authClient.login
export const resetStudentPassword = authClient.resetPassword
export const changeStudentPassword = authClient.changePassword
export const logoutStudent = authClient.logout
