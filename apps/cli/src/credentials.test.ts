import { describe, expect, it, vi } from 'vitest'
import { KeychainCredentialStore } from './credentials.js'

describe('keychain credentials', () => {
  it('uses the fixed service/account namespace and never includes secrets in errors', async () => {
    const secret = 'a'.repeat(64)
    const adapter = { getPassword: vi.fn(async () => null), setPassword: vi.fn(async () => { throw new Error(`denied ${secret}`) }), deletePassword: vi.fn(async () => true) }
    const store = new KeychainCredentialStore(adapter)
    await expect(store.get('local')).resolves.toBeNull()
    await expect(store.set('local', secret)).rejects.toSatisfy((error: unknown) => error instanceof Error && error.message === 'KEYCHAIN_UNAVAILABLE' && !error.message.includes(secret))
    expect(adapter.setPassword).toHaveBeenCalledWith('cn.ac.tashan.panshi-camp', 'local:cli-session', secret)
  })
})
