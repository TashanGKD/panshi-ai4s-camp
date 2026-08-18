import { CampClientError } from '@panshi/camp-client'
import type { ApplicationDraftSaveRequest } from '@panshi/contracts'
import { createBrowserCampClient, type PublicClientRuntime } from './browser-client'
import { applicationConfirmationPayload, confirmationClient, type PreparedConfirmation } from './confirmation-client'

export class ApplicationApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); this.name = 'ApplicationApiError' }
}
const operation = (prepared: PreparedConfirmation) => ({ confirmationId: prepared.confirmationId, clientBinding: prepared.clientBinding, idempotencyKey: prepared.idempotencyKey })
const map = (error: unknown): never => {
  if (error instanceof CampClientError) throw new ApplicationApiError(error.status, error.code, error.message, error.details)
  throw error
}

export const createApplicationClient = (apiBaseUrl?: string, runtime: PublicClientRuntime = { production: false }) => {
  const { client } = createBrowserCampClient(apiBaseUrl, runtime)
  const prepare = confirmationClient.prepare
  return {
    getMine: () => client.application.getMine().catch(map),
    getInstitutions: () => client.public.getInstitutions().catch(map),
    getCheckIn: () => client.checkIn.show().catch(map),
    saveDraft: async (body: ApplicationDraftSaveRequest) => {
      const confirmed = await prepare('application.draft.save', applicationConfirmationPayload(body))
      return client.application.saveDraft(body, operation(confirmed)).catch(map)
    },
    reopen: async (expectedRevision: number) => {
      const confirmed = await prepare('application.reopen', { expectedRevision })
      return client.application.reopen(expectedRevision, operation(confirmed)).catch(map)
    },
    submit: async (expectedRevision: number) => {
      const confirmed = await prepare('application.submit', { expectedRevision })
      return client.application.submit(expectedRevision, operation(confirmed)).catch(map)
    },
    upload: async (file: File, slotId: string) => {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (value) => value.toString(16).padStart(2, '0')).join('')
      const confirmed = await prepare('file.upload', { sha256: digest, sizeBytes: file.size, originalName: file.name, mimeType: file.type, purpose: 'registration_attachment', attachmentSlot: slotId })
      const form = new FormData(); form.append('file', file); form.append('purpose', 'registration_attachment'); form.append('attachmentSlot', slotId)
      return client.files.upload(form, operation(confirmed)).catch(map) as Promise<{ data: { file: { id: string, originalName: string, mimeType: string, sizeBytes: number } } }>
    },
    removeFile: async (id: string) => {
      const confirmed = await prepare('file.delete', { fileId: id })
      return client.files.delete(id, operation(confirmed)).catch(map)
    },
    logout: async () => {
      const confirmed = await prepare('auth.logout', { scope: 'current' })
      return client.auth.logoutWeb(operation(confirmed)).catch(map)
    },
  }
}

export const applicationClient = createApplicationClient(import.meta.env.VITE_API_BASE_URL, { production: import.meta.env.PROD, pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin })
