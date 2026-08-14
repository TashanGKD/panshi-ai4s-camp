import type { VerificationPurpose } from './identity.repository.js'

export type VerificationMessage = {
  phone: string
  code: string
  purpose: VerificationPurpose
}

export interface VerificationProvider {
  sendCode(input: VerificationMessage): Promise<void>
}
