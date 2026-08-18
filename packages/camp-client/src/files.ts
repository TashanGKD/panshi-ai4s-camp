import { JsonObjectSchema } from '@panshi/contracts'
import type { CampTransport } from './http.js'
import { confirmationHeaders, type ConfirmedOperation } from './confirmations.js'

export const createFilesApi = (transport: CampTransport) => ({
  upload: (form: FormData, confirmation: ConfirmedOperation) => transport.json('file.upload', '/api/v1/files', { schema: JsonObjectSchema, method: 'POST', body: form, headers: confirmationHeaders(confirmation) }),
  download: (id: string, options?: Parameters<CampTransport['download']>[2]) => transport.download('file.download', `/api/v1/files/${encodeURIComponent(id)}/download`, options),
  hide: (id: string, confirmation: ConfirmedOperation) => transport.json('file.hide', `/api/v1/files/${encodeURIComponent(id)}/hide`, { schema: JsonObjectSchema, method: 'PATCH', headers: confirmationHeaders(confirmation) }),
  delete: (id: string, confirmation: ConfirmedOperation) => transport.json('file.delete', `/api/v1/files/${encodeURIComponent(id)}`, { schema: JsonObjectSchema, method: 'DELETE', headers: confirmationHeaders(confirmation) }),
})
