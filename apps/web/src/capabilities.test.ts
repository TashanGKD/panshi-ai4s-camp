import { describe, expect, it } from 'vitest'
import { learnerCapabilities, type LearnerCapabilityId } from '@panshi/contracts'
import { webCapabilities } from './capabilities.js'

const expectedRoutes = ['/', '/schedule', '/travel', '/contact', '/resources', '/register', '/login', '/forgot-password', '/application', '/account']

describe('Web learner capability bindings', () => {
  it('binds every public and learner route explicitly', () => {
    expect(Object.keys(webCapabilities).sort()).toEqual(expectedRoutes.sort())
  })

  it('uses registered learner capability IDs without copying endpoint paths', () => {
    const ids = new Set<LearnerCapabilityId>(learnerCapabilities.map((capability) => capability.id))
    for (const [route, capabilities] of Object.entries(webCapabilities)) {
      expect(route).not.toContain('/api/')
      expect(capabilities.length).toBeGreaterThan(0)
      for (const capability of capabilities) expect(ids.has(capability)).toBe(true)
    }
  })

  it('covers every learner-v1 capability exposed by the current Web application', () => {
    const bound = new Set<LearnerCapabilityId>(Object.values(webCapabilities).flat())
    const locallyOrWebExposed = learnerCapabilities
      .filter(({ id }) => !['auth.status', 'check_in.qr.export', 'application.validate'].includes(id) || bound.has(id))
      .map(({ id }) => id)
    for (const id of locallyOrWebExposed) expect(bound.has(id), id).toBe(true)
  })
})
