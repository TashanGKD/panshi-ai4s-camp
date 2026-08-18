import { describe, expect, it, vi } from 'vitest'
import { createCampClient, type ConfirmedOperation } from './index.js'

const confirmation: ConfirmedOperation = {
  confirmationId: '00000000-0000-4000-8000-000000000001',
  clientBinding: 'b'.repeat(64),
  idempotencyKey: '00000000-0000-4000-8000-000000000002',
}

describe('business method capability routing', () => {
  it.each([
    ['public.site.show', '/api/v1/public/site', (client: ReturnType<typeof createCampClient>) => client.public.getSite()],
    ['public.content.show', '/api/v1/public/content/travel', (client: ReturnType<typeof createCampClient>) => client.public.getContent('travel')],
    ['public.schedule.list', '/api/v1/public/schedule', (client: ReturnType<typeof createCampClient>) => client.public.getSchedule()],
    ['public.institutions.search', '/api/v1/public/institutions', (client: ReturnType<typeof createCampClient>) => client.public.getInstitutions()],
    ['public.registration_form.show', '/api/v1/public/registration-form', (client: ReturnType<typeof createCampClient>) => client.public.getRegistrationForm()],
    ['public.application_count.show', '/api/v1/public/statistics/applications', (client: ReturnType<typeof createCampClient>) => client.public.getApplicationCount()],
    ['resource.list', '/api/v1/resources', (client: ReturnType<typeof createCampClient>) => client.public.listResources()],
    ['auth.status', '/api/v1/me/profile', (client: ReturnType<typeof createCampClient>) => client.auth.status()],
    ['application.show', '/api/v1/me/application', (client: ReturnType<typeof createCampClient>) => client.application.getMine()],
    ['check_in.show', '/api/v1/me/check-in', (client: ReturnType<typeof createCampClient>) => client.checkIn.show()],
    ['application.submit', '/api/v1/me/application/submit', (client: ReturnType<typeof createCampClient>) => client.application.submit(1, confirmation)],
    ['file.hide', '/api/v1/files/file-id/hide', (client: ReturnType<typeof createCampClient>) => client.files.hide('file-id', confirmation)],
    ['file.delete', '/api/v1/files/file-id', (client: ReturnType<typeof createCampClient>) => client.files.delete('file-id', confirmation)],
  ])('declares %s for %s', async (capabilityId, path, invoke) => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(`http://127.0.0.1:3001${path}`)
      expect(new Headers(init?.headers).get('X-Capability-Id')).toBe(capabilityId)
      return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'fixture stop', requestId: 'fixture' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    })
    await expect(invoke(createCampClient({ fetch: fetchMock as typeof fetch }))).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
