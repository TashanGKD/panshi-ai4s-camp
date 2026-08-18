import { describe, expect, it } from 'vitest'
import {
  CapabilityRegistrySchema,
  CapabilitySchema,
  LearnerCapabilityIdSchema,
  learnerCapabilities,
} from './capabilities.js'

const baseCapability = {
  id: 'public.site.show',
  apiOperation: 'GET /api/v1/public/site',
  webSurface: ['/'],
  cliCommand: 'info show',
  skillIndex: ['info.show'],
  roles: ['anonymous'],
  effect: 'read',
  confirmation: 'none',
  outputSchema: 'PublicSiteResponse',
  phase: 'learner-v1',
} as const

describe('capability contracts', () => {
  it('accepts a read-only public capability', () => {
    expect(CapabilitySchema.parse(baseCapability)).toEqual(baseCapability)
  })

  it('rejects a destructive capability without double confirmation', () => {
    expect(CapabilitySchema.safeParse({
      ...baseCapability,
      id: 'file.delete',
      apiOperation: 'DELETE /api/v1/files/:id',
      cliCommand: 'files delete <id>',
      roles: ['user'],
      effect: 'delete',
      confirmation: 'none',
      outputSchema: 'FileMutationResponse',
    }).success).toBe(false)
  })

  it('rejects an anonymous application mutation', () => {
    expect(CapabilitySchema.safeParse({
      ...baseCapability,
      id: 'application.submit',
      apiOperation: 'POST /api/v1/me/application/submit',
      cliCommand: 'application submit',
      roles: ['anonymous'],
      effect: 'write',
      confirmation: 'single',
      outputSchema: 'ApplicationSubmitResponse',
    }).success).toBe(false)
  })

  it('rejects duplicate capability ids', () => {
    expect(CapabilityRegistrySchema.safeParse([baseCapability, baseCapability]).success).toBe(false)
  })

  it('publishes every approved learner capability exactly once', () => {
    const expected = [
      'public.site.show', 'public.content.show', 'public.schedule.list', 'public.travel.show',
      'public.contacts.show', 'public.institutions.search', 'public.registration_form.show',
      'public.application_count.show', 'resource.list', 'resource.download',
      'auth.verification.send', 'auth.register', 'auth.login', 'auth.status', 'auth.logout',
      'auth.password_reset', 'account.password_change', 'application.show',
      'application.validate', 'application.draft.save', 'application.reopen',
      'application.submit', 'file.upload', 'file.download', 'file.hide', 'file.delete',
      'check_in.show', 'check_in.qr.export',
    ].sort()
    expect(learnerCapabilities.map(({ id }) => id).sort()).toEqual(expected)
    expect(new Set(learnerCapabilities.map(({ id }) => id)).size).toBe(expected.length)
    for (const capability of learnerCapabilities) {
      expect(LearnerCapabilityIdSchema.parse(capability.id)).toBe(capability.id)
    }
  })
})
