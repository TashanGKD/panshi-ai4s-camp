import { randomInt } from 'node:crypto'
import type { VerificationMessage, VerificationProvider } from './verification-provider.js'

type MockVerificationProviderOptions = {
  code?: string
  logger?: (message: VerificationMessage) => void
}

export const createMockVerificationProvider = (
  options: MockVerificationProviderOptions = {},
): VerificationProvider & { createCode: () => string } => {
  const configuredCode = options.code
  if (configuredCode !== undefined && !/^\d{6}$/u.test(configuredCode)) {
    throw new Error('Mock verification code must be exactly six digits')
  }
  const createCode = () => configuredCode ?? randomInt(0, 1_000_000).toString().padStart(6, '0')

  return {
    createCode,
    sendCode: async (message) => {
      options.logger?.(message)
    },
  }
}
