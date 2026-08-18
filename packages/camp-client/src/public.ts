import {
  ApplicationCountResponseSchema, ContactsContentSchema, InstitutionDirectoryResponseSchema, PublicContentModuleResponseSchema,
  PublicRegistrationFormResponseSchema, PublicScheduleResponseSchema, PublicSiteResponseSchema, ResourceListResponseSchema,
  TravelContentSchema, type ContentModuleKey,
} from '@panshi/contracts'
import type { CampTransport } from './http.js'

export const createPublicApi = (transport: CampTransport) => ({
  getSite: () => transport.json('public.site.show', '/api/v1/public/site', { schema: PublicSiteResponseSchema }),
  getContent: (key: ContentModuleKey) => transport.json('public.content.show', `/api/v1/public/content/${encodeURIComponent(key)}`, { schema: PublicContentModuleResponseSchema }),
  getTravel: async () => TravelContentSchema.parse((await transport.json('public.travel.show', '/api/v1/public/content/travel', { schema: PublicContentModuleResponseSchema })).data.payload),
  getContacts: async () => ContactsContentSchema.parse((await transport.json('public.contacts.show', '/api/v1/public/content/contacts', { schema: PublicContentModuleResponseSchema })).data.payload),
  getSchedule: () => transport.json('public.schedule.list', '/api/v1/public/schedule', { schema: PublicScheduleResponseSchema }),
  getInstitutions: () => transport.json('public.institutions.search', '/api/v1/public/institutions', { schema: InstitutionDirectoryResponseSchema }),
  getRegistrationForm: () => transport.json('public.registration_form.show', '/api/v1/public/registration-form', { schema: PublicRegistrationFormResponseSchema }),
  getApplicationCount: (signal?: AbortSignal) => transport.json('public.application_count.show', '/api/v1/public/statistics/applications', { schema: ApplicationCountResponseSchema, signal }),
  listResources: () => transport.json('resource.list', '/api/v1/resources', { schema: ResourceListResponseSchema }),
  downloadResource: (id: string, options?: Parameters<CampTransport['download']>[2]) => transport.download('resource.download', `/api/v1/resources/${encodeURIComponent(id)}/download`, options),
})
