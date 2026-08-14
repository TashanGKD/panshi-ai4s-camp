import { describe, expect, it } from 'vitest'
import { runContentPublishingFixture } from '../src/cli/content-publishing-e2e-fixture.js'

describe('content publishing E2E fixture safety controls', () => {
  it('refuses to run without the explicit publishing switch', async () => {
    await expect(runContentPublishingFixture('cleanup', {
      databaseUrl: 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test',
      enabled: undefined,
      phone: '13800138000',
      password: 'test-only-password',
    })).rejects.toThrow('explicit test controls and exact dedicated database')
  })

  it('refuses any database URL other than the exact dedicated test database', async () => {
    await expect(runContentPublishingFixture('cleanup', {
      databaseUrl: 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test_copy',
      enabled: '1',
      phone: '13800138000',
      password: 'test-only-password',
    })).rejects.toThrow('explicit test controls and exact dedicated database')
  })

  it('requires explicit temporary E2E credentials', async () => {
    await expect(runContentPublishingFixture('cleanup', {
      databaseUrl: 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test',
      enabled: '1',
      phone: undefined,
      password: undefined,
    })).rejects.toThrow('E2E_ADMIN_PHONE and E2E_ADMIN_PASSWORD are required')
  })
})
