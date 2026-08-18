import { ApiErrorSchema, InstitutionDirectoryResponseSchema, MyApplicationResponseSchema, ApplicationSubmitResponseSchema, StudentCheckInResponseSchema, type ApplicationDraftSaveRequest, type InstitutionDirectoryResponse, type MyApplicationResponse } from '@panshi/contracts'
import { resolveApiBaseUrl, type PublicClientRuntime } from './public-client'

export class ApplicationApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); this.name = 'ApplicationApiError' }
}

export const createApplicationClient = (apiBaseUrl?: string, runtime: PublicClientRuntime = { production: false }) => {
  const { prefix, credentials } = resolveApiBaseUrl(apiBaseUrl, runtime)
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${prefix}${path}`, { ...init, credentials, headers: { Accept: 'application/json', ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers } })
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => undefined))
      throw new ApplicationApiError(response.status, parsed.success ? parsed.data.error.code : 'REQUEST_FAILED', parsed.success ? parsed.data.error.message : '请求失败', parsed.success ? parsed.data.error.details : undefined)
    }
    return response.status === 204 ? undefined : response.json()
  }
  return {
    getMine: async (): Promise<MyApplicationResponse> => MyApplicationResponseSchema.parse(await request('/api/v1/me/application')),
    getInstitutions: async (): Promise<InstitutionDirectoryResponse> => InstitutionDirectoryResponseSchema.parse(await request('/api/v1/public/institutions')),
    saveDraft: async (body: ApplicationDraftSaveRequest): Promise<MyApplicationResponse> => MyApplicationResponseSchema.parse(await request('/api/v1/me/application/draft', { method: 'PUT', body: JSON.stringify(body) })),
    reopen: async (expectedRevision: number): Promise<MyApplicationResponse> => MyApplicationResponseSchema.parse(await request('/api/v1/me/application/reopen', { method: 'POST', body: JSON.stringify({ expectedRevision }) })),
    getCheckIn: async () => StudentCheckInResponseSchema.parse(await request('/api/v1/me/check-in')),
    submit: async (expectedRevision: number) => ApplicationSubmitResponseSchema.parse(await request('/api/v1/me/application/submit', { method: 'POST', body: JSON.stringify({ expectedRevision }) })),
    upload: async (file: File, slotId: string) => {
      const body = new FormData(); body.append('file', file); body.append('purpose', 'registration_attachment'); body.append('attachmentSlot', slotId)
      return request('/api/v1/files', { method: 'POST', body }) as Promise<{ data: { file: { id: string, originalName: string, mimeType: string, sizeBytes: number } } }>
    },
    removeFile: (id: string) => request(`/api/v1/files/${id}`, { method: 'DELETE' }),
    logout: () => request('/api/v1/auth/logout', { method: 'POST', body: '{}' }),
  }
}

export const applicationClient = createApplicationClient(import.meta.env.VITE_API_BASE_URL, {
  production: import.meta.env.PROD,
  pageOrigin: typeof window === 'undefined' ? undefined : window.location.origin,
})
