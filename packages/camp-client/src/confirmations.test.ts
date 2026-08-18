import { describe, expect, it, vi } from 'vitest'
import { createCampClient } from './index.js'

describe('confirmation API', () => {
  it('keeps prepare and execute as separate caller-controlled operations', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/confirmations/prepare')) return new Response(JSON.stringify({ apiVersion: 'v1', data: { confirmationId: '00000000-0000-4000-8000-000000000001', expiresAt: '2026-08-18T12:00:00.000Z', preview: { action: '提交报名' }, payloadSha256: 'a'.repeat(64), confirmation: 'single' } }), { headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ apiVersion: 'v1', data: { accepted: true } }), { headers: { 'Content-Type': 'application/json' } })
    })
    const client = createCampClient({ fetch: fetchMock as typeof fetch })
    const context = { clientBinding: 'b'.repeat(64), idempotencyKey: '00000000-0000-4000-8000-000000000002' }
    const prepared = await client.confirmations.prepare('application.submit', { expectedRevision: 1 }, context)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect('prepareAndExecute' in client.confirmations).toBe(false)
    await client.confirmations.execute(prepared.data.confirmationId, { expectedRevision: 1 }, context)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
