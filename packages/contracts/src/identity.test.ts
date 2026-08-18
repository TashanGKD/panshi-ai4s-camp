import { describe, expect, it } from 'vitest'
import { maskMainlandChinaMobile } from './identity.js'

describe('mainland mobile display masking', () => {
  it('uses one shared representation for confirmation bindings', () => {
    expect(maskMainlandChinaMobile('13800138000')).toBe('+8613******000')
    expect(maskMainlandChinaMobile('+8613800138000')).toBe('+8613******000')
  })
})
