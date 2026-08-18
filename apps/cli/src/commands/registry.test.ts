import { describe, expect, it } from 'vitest'
import { CliSuccessSchema } from '@panshi/contracts'
import { learnerCommands } from './registry.js'

const expected = [
  ['public.site.show', 'info show'],
  ['public.content.show', 'content get'],
  ['public.schedule.list', 'schedule list'],
  ['public.travel.show', 'travel show'],
  ['public.contacts.show', 'contacts show'],
  ['public.institutions.search', 'institutions search'],
  ['public.registration_form.show', 'application form'],
  ['resource.list', 'resources list'],
  ['resource.download', 'resources download'],
  ['auth.login', 'auth login'],
  ['auth.status', 'auth status'],
  ['application.show', 'application show'],
  ['application.validate', 'application validate'],
  ['file.download', 'files download'],
  ['check_in.show', 'check-in show'],
  ['check_in.qr.export', 'check-in qr export'],
] as const

describe('learner read command registry', () => {
  it('registers every approved command exactly once with its capability ID', () => {
    expect(learnerCommands.map(({ capabilityId, path }) => [capabilityId, path.join(' ')])).toEqual(expected)
    expect(new Set(learnerCommands.map(({ capabilityId }) => capabilityId)).size).toBe(expected.length)
  })

  it('uses the stable CLI success envelope', () => {
    for (const [capabilityId] of expected) {
      expect(CliSuccessSchema.safeParse({ ok: true, apiVersion: 'v1', capabilityId, data: {}, requestId: 'local' }).success).toBe(true)
    }
  })
})
