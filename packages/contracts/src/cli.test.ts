import { describe, expect, it } from 'vitest'
import { CliFailureSchema, CliSuccessSchema, StableCliErrorCodeSchema } from './cli.js'

describe('CLI output contracts', () => {
  it('accepts a strict success envelope', () => {
    expect(CliSuccessSchema.parse({
      ok: true,
      apiVersion: 'v1',
      capabilityId: 'public.site.show',
      data: { title: '磐石实训营' },
      requestId: 'request-1',
    })).toBeTruthy()
  })

  it('rejects unknown fields in success output', () => {
    expect(CliSuccessSchema.safeParse({
      ok: true,
      apiVersion: 'v1',
      capabilityId: 'public.site.show',
      data: {},
      requestId: 'request-1',
      token: 'must-not-leak',
    }).success).toBe(false)
  })

  it('accepts a stable failure envelope and rejects unknown error codes', () => {
    expect(CliFailureSchema.parse({
      ok: false,
      code: 'APPLICATION_REVISION_CONFLICT',
      message: '报名信息已变化',
      details: { expectedRevision: 3 },
      requestId: 'request-2',
    })).toBeTruthy()
    expect(StableCliErrorCodeSchema.safeParse('SOMETHING_NEW').success).toBe(false)
  })
})
