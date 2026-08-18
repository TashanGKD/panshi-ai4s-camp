import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfirmationClient } from './confirmation-client'

const confirmationId = '11111111-1111-4111-8111-111111111111'

describe('browser confirmation client', () => {
  const session = new Map<string, string>()
  const confirm = vi.fn()
  const prompt = vi.fn()

  beforeEach(() => {
    session.clear(); confirm.mockReset(); prompt.mockReset()
    vi.stubGlobal('window', {
      location: { origin: 'https://camp.example' }, confirm, prompt,
      sessionStorage: { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value) },
    })
  })

  it('prepares an intent but never executes it automatically', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      apiVersion: 'v1', data: {
        confirmationId, expiresAt: '2026-08-18T00:05:00.000Z', preview: { action: '提交报名' },
        payloadSha256: 'a'.repeat(64), confirmation: 'single',
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const client = createConfirmationClient('https://api.example', { production: false })
    const prepared = await client.prepare('application.submit', { expectedRevision: 3 })
    expect(prepared.confirmationId).toBe(confirmationId)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('requires the exact target identifier for double confirmation', () => {
    confirm.mockReturnValue(true); prompt.mockReturnValue('wrong-file')
    const client = createConfirmationClient('https://api.example', { production: false })
    expect(client.requestConfirmation({
      confirmationId, idempotencyKey: '22222222-2222-4222-8222-222222222222', clientBinding: 'b'.repeat(64),
      confirmation: 'double', preview: { action: '删除附件', fileId: 'file-1' },
    }, 'file-1')).toBe(false)
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('file-1'))
  })
})
