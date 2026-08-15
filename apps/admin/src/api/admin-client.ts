import {
  AdminContentDraftResponseSchema,
  AdminContentHistoryResponseSchema,
  AdminContentPreviewResponseSchema,
  AdminSummaryResponseSchema,
  ApiErrorSchema,
  ContentPublishResponseSchema,
  LoginResponseSchema,
  ProfileResponseSchema,
  type AdminContentDraftResponse,
  type AdminContentHistoryResponse,
  type AdminContentPreviewResponse,
  type AdminSummaryResponse,
  type AdminLoginRequest,
  type ContentModuleKey,
  type ContentPublishResponse,
  type ContentValidationDetails,
  type JsonObject,
  type LoginResponse,
  type ProfileResponse,
  RegistrationFormDraftResponseSchema,
  RegistrationFormHistoryResponseSchema,
  RegistrationFormPublishResponseSchema,
  type RegistrationForm,
  type RegistrationFormDraftResponse,
  type RegistrationFormHistoryResponse,
  type RegistrationFormPublishResponse,
} from '@panshi/contracts'

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: ContentValidationDetails,
  ) { super(message); this.name = 'AdminApiError' }
}

type AdminClientRuntime = { production: boolean }

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export const resolveApiBaseUrl = (value: string | undefined, runtime: AdminClientRuntime): string => {
  const candidate = value?.trim() ?? ''
  if (candidate === '') return ''
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error('Invalid VITE_API_BASE_URL') }
  const unsafeHttp = url.protocol === 'http:' && (runtime.production || !loopbackHosts.has(url.hostname))
  if (!['http:', 'https:'].includes(url.protocol) || unsafeHttp || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid VITE_API_BASE_URL')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`
}

export const resolvePublicWebBaseUrl = (value: string | undefined, runtime: AdminClientRuntime): string => {
  const candidate = value?.trim() ?? ''
  if (candidate === '') return ''
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error('Invalid VITE_PUBLIC_WEB_BASE_URL') }
  const unsafeHttp = url.protocol === 'http:' && (runtime.production || !loopbackHosts.has(url.hostname))
  if (!['http:', 'https:'].includes(url.protocol) || unsafeHttp || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid VITE_PUBLIC_WEB_BASE_URL')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`
}

export type AdminClient = {
  getProfile: () => Promise<ProfileResponse>
  getSummary: () => Promise<AdminSummaryResponse>
  login: (input: AdminLoginRequest) => Promise<LoginResponse>
  logout: () => Promise<void>
  getDraft: (key: ContentModuleKey) => Promise<AdminContentDraftResponse>
  saveDraft: (key: ContentModuleKey, payload: JsonObject, expectedRevision: number) => Promise<AdminContentDraftResponse>
  getPreview: (key: ContentModuleKey) => Promise<AdminContentPreviewResponse>
  publish: (key: ContentModuleKey, expectedRevision: number) => Promise<ContentPublishResponse>
  getHistory: (key: ContentModuleKey) => Promise<AdminContentHistoryResponse>
  rollback: (key: ContentModuleKey, version: number) => Promise<ContentPublishResponse>
  getRegistrationFormDraft: () => Promise<RegistrationFormDraftResponse>
  saveRegistrationFormDraft: (form: RegistrationForm, expectedRevision: number) => Promise<RegistrationFormDraftResponse>
  previewRegistrationForm: () => Promise<RegistrationFormDraftResponse>
  publishRegistrationForm: (expectedRevision: number) => Promise<RegistrationFormPublishResponse>
  getRegistrationFormHistory: () => Promise<RegistrationFormHistoryResponse>
  listApplications: (query: URLSearchParams, signal?: AbortSignal) => Promise<{ data: { items: AdminApplicationListItem[], total: number, page: number, pageSize: number } }>
  getApplication: (id: string, signal?: AbortSignal) => Promise<{ data: AdminApplicationDetail }>
  transitionApplication: (id: string, input: ReviewTransitionInput) => Promise<{ data: { id: string, revision: number, status: string } }>
  bulkTransitionApplications: (input: { applicationIds: string[], targetStatus: string, publicMessage?: string, internalNote?: string }) => Promise<{ data: { results: Array<{ applicationId: string, success: boolean, status?: string, code?: string, message?: string }> } }>
  exportApplications: (query: URLSearchParams) => Promise<Blob>
}

export type AdminApplicationListItem = { id: string, revision: number, status: string, name: string, phone: string, organization: string, identityType: string, educationStage: string, submittedAt: string | null, updatedAt: string }
export type AdminApplicationDetail = { application: AdminApplicationListItem & { coreFields: Record<string, string>, answers: Record<string, string | string[]>, form: RegistrationForm, internalReviewNote?: string | null }, versions: Array<{ id: string, snapshot: JsonObject, reason: string, createdAt: string }>, history: Array<{ fromStatus: string | null, toStatus: string, reason: string | null, internalNote: string | null, changedBy: string | null, createdAt: string }>, attachments: Array<{ id: string, slotId: string, originalName: string, mimeType: string, sizeBytes: number, downloadUrl: string }> }
export type ReviewTransitionInput = { expectedRevision: number, targetStatus: string, publicMessage?: string, internalNote?: string, supplementDeadline?: string, editableFieldIds: string[], editableAttachmentIds: string[] }

export const createAdminClient = (apiBaseUrl: string | undefined, runtime: AdminClientRuntime): AdminClient => {
  const prefix = resolveApiBaseUrl(apiBaseUrl, runtime)
  const send = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetch(`${prefix}${path}`, {
      ...init,
      credentials: prefix === '' ? 'same-origin' : 'include',
      headers: { Accept: 'application/json', ...init?.headers },
    })
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => ({})))
      const error = parsed.success ? parsed.data.error : undefined
      const details = error?.details && typeof error.details === 'object' && 'fields' in error.details
        ? error.details as ContentValidationDetails
        : undefined
      throw new AdminApiError(response.status, error?.message ?? '请求失败', error?.code, details)
    }
    return response
  }
  return {
    getProfile: async () => ProfileResponseSchema.parse(await (await send('/api/v1/me/profile')).json()),
    getSummary: async () => AdminSummaryResponseSchema.parse(await (await send('/api/v1/admin/summary')).json()),
    login: async (input) => LoginResponseSchema.parse(await (await send('/api/v1/auth/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })).json()),
    logout: async () => { await send('/api/v1/auth/admin/logout', { method: 'POST' }) },
    getDraft: async (key) => AdminContentDraftResponseSchema.parse(await (await send(`/api/v1/admin/content/${key}/draft`)).json()),
    saveDraft: async (key, payload, expectedRevision) => AdminContentDraftResponseSchema.parse(await (await send(`/api/v1/admin/content/${key}/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload, expectedRevision }),
    })).json()),
    getPreview: async (key) => AdminContentPreviewResponseSchema.parse(await (await send(`/api/v1/admin/content/${key}/preview`)).json()),
    publish: async (key, expectedRevision) => ContentPublishResponseSchema.parse(await (await send(`/api/v1/admin/content/${key}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision }),
    })).json()),
    getHistory: async (key) => AdminContentHistoryResponseSchema.parse(await (await send(`/api/v1/admin/content/${key}/versions`)).json()),
    rollback: async (key, version) => ContentPublishResponseSchema.parse(await (await send(`/api/v1/admin/content/${key}/rollback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }),
    })).json()),
    getRegistrationFormDraft: async () => RegistrationFormDraftResponseSchema.parse(await (await send('/api/v1/admin/registration-form/draft')).json()),
    saveRegistrationFormDraft: async (form, expectedRevision) => RegistrationFormDraftResponseSchema.parse(await (await send('/api/v1/admin/registration-form/draft', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form, expectedRevision }),
    })).json()),
    previewRegistrationForm: async () => RegistrationFormDraftResponseSchema.parse(await (await send('/api/v1/admin/registration-form/preview')).json()),
    publishRegistrationForm: async (expectedRevision) => RegistrationFormPublishResponseSchema.parse(await (await send('/api/v1/admin/registration-form/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision }),
    })).json()),
    getRegistrationFormHistory: async () => RegistrationFormHistoryResponseSchema.parse(await (await send('/api/v1/admin/registration-form/history')).json()),
    listApplications: async (query, signal) => (await send(`/api/v1/admin/applications?${query.toString()}`, { signal })).json(),
    getApplication: async (id, signal) => (await send(`/api/v1/admin/applications/${encodeURIComponent(id)}`, { signal })).json(),
    transitionApplication: async (id, input) => (await send(`/api/v1/admin/applications/${encodeURIComponent(id)}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json(),
    bulkTransitionApplications: async (input) => (await send('/api/v1/admin/applications/bulk-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json(),
    exportApplications: async (query) => (await send(`/api/v1/admin/applications/export.csv?${query.toString()}`)).blob(),
  }
}

export const createConfiguredAdminClient = (env: { VITE_API_BASE_URL?: string, PROD: boolean }) => (
  createAdminClient(env.VITE_API_BASE_URL, { production: env.PROD })
)

export const adminClient = createConfiguredAdminClient(import.meta.env)
