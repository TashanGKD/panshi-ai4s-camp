import { createApplicationApi } from './application.js'
import { createAuthApi } from './auth.js'
import { createCheckInApi } from './check-in.js'
import { createConfirmationApi } from './confirmations.js'
import { createFilesApi } from './files.js'
import { createTransport, resolveCliBaseUrl, type CredentialProvider } from './http.js'
import { createPublicApi } from './public.js'

export type CampClientOptions = {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  credentialProvider?: CredentialProvider
  credentials?: RequestCredentials
  onCapability?: (capabilityId: import('@panshi/contracts').LearnerCapabilityId, path: string) => void
}

export const createCampClient = (options: CampClientOptions = {}) => {
  const transport = createTransport({
    baseUrl: resolveCliBaseUrl(options.baseUrl), fetch: options.fetch,
    credentialProvider: options.credentialProvider, credentials: options.credentials,
    onCapability: options.onCapability,
  })
  return {
    public: createPublicApi(transport), auth: createAuthApi(transport),
    application: createApplicationApi(transport), files: createFilesApi(transport),
    checkIn: createCheckInApi(transport), confirmations: createConfirmationApi(transport),
  }
}

export * from './http.js'
export * from './confirmations.js'
