import {
  ApplicationDraftSaveRequestSchema, ApplicationSubmitResponseSchema, JsonObjectSchema, MyApplicationResponseSchema,
  type ApplicationDraftSaveRequest,
} from '@panshi/contracts'
import type { CampTransport } from './http.js'
import { confirmationHeaders, type ConfirmedOperation } from './confirmations.js'

const confirmedJson = (body: unknown, confirmation: ConfirmedOperation) => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...confirmationHeaders(confirmation) }, body: JSON.stringify(body),
})

export const createApplicationApi = (transport: CampTransport) => ({
  getMine: () => transport.json('application.show', '/api/v1/me/application', { schema: MyApplicationResponseSchema }),
  validate: (input: ApplicationDraftSaveRequest) => ApplicationDraftSaveRequestSchema.safeParse(input),
  saveDraft: (body: ApplicationDraftSaveRequest, confirmation: ConfirmedOperation) => transport.json('application.draft.save', '/api/v1/me/application/draft', { schema: MyApplicationResponseSchema, ...confirmedJson(body, confirmation), method: 'PUT' }),
  reopen: (expectedRevision: number, confirmation: ConfirmedOperation) => transport.json('application.reopen', '/api/v1/me/application/reopen', { schema: MyApplicationResponseSchema, ...confirmedJson({ expectedRevision }, confirmation) }),
  submit: (expectedRevision: number, confirmation: ConfirmedOperation) => transport.json('application.submit', '/api/v1/me/application/submit', { schema: ApplicationSubmitResponseSchema, ...confirmedJson({ expectedRevision }, confirmation) }),
  rawMutation: (path: string, body: unknown, confirmation: ConfirmedOperation) => transport.json('application.draft.save', path, { schema: JsonObjectSchema, ...confirmedJson(body, confirmation) }),
})
