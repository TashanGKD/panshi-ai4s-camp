import bcrypt from 'bcryptjs'
import { describe, expect, it, vi } from 'vitest'
import {
  BCRYPT_COST,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from '../src/modules/identity/password.js'

describe('administrator password boundary', () => {
  it.each([
    '1234567',
    'a'.repeat(73),
    `${'密'.repeat(24)}a`,
  ])('rejects password outside 8..72 UTF-8 bytes', async (password) => {
    await expect(hashPassword(password)).rejects.toThrow('Password must be 8 to 72 UTF-8 bytes')
  })

  it.each(['12345678', 'a'.repeat(72), '密'.repeat(24)])('hashes valid password at cost 12', async (password) => {
    expect(await hashPassword(password)).toMatch(/^\$2[aby]\$12\$/u)
  })

  it('rejects a bcrypt tail collision beyond 72 bytes', async () => {
    const password = 'a'.repeat(72)
    const hash = await bcrypt.hash(password, BCRYPT_COST)
    expect(await bcrypt.compare(`${password}tail`, hash)).toBe(true)
    await expect(verifyPassword(`${password}tail`, hash)).resolves.toBe(false)
  })

  it('uses the dummy timing path and fails safely for malformed or wrong-cost stored hashes', async () => {
    const wrongCost = await bcrypt.hash('valid password', 10)
    const compare = vi.spyOn(bcrypt, 'compare')

    for (const storedHash of ['not-a-bcrypt-hash', '$2b$12$short', wrongCost]) {
      await expect(verifyPassword('valid password', storedHash)).resolves.toBe(false)
      expect(compare).toHaveBeenLastCalledWith('valid password', DUMMY_PASSWORD_HASH)
    }
  })
})
