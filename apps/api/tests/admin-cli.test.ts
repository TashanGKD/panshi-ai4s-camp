import { describe, expect, it, vi } from 'vitest'
import { createAdmin, parseCreateAdminArgs } from '../src/cli/create-admin.js'

describe('administrator creation CLI', () => {
  it.each([
    ['--password', 'secret'],
    ['--password=secret'],
  ])('rejects password argument form %j without reading interactively', async (...args) => {
    const readPassword = vi.fn<() => Promise<string>>()
    expect(() => parseCreateAdminArgs(['--phone', '13800138000', '--name', '管理员', ...args])).toThrow(
      'Password must not be supplied as a command-line argument',
    )
    expect(readPassword).not.toHaveBeenCalled()
  })

  it('normalizes the phone identically and hashes the interactive password at bcrypt cost 12', async () => {
    const repository = { createAdmin: vi.fn(async () => undefined) }
    await createAdmin(
      ['--phone', '13800138000', '--name', '管理员'],
      { repository, readPassword: async () => 'interactive secret' },
    )

    expect(repository.createAdmin).toHaveBeenCalledOnce()
    expect(repository.createAdmin).toHaveBeenCalledWith(expect.objectContaining({
      phoneNormalized: '+8613800138000',
      displayName: '管理员',
      role: 'admin',
      passwordHash: expect.stringMatching(/^\$2[aby]\$12\$/u),
    }))
  })

  it('fails when the normalized phone already exists', async () => {
    const repository = { createAdmin: vi.fn(async () => { throw new Error('phone already exists') }) }
    await expect(createAdmin(
      ['--phone', '+8613800138000', '--name', '管理员'],
      { repository, readPassword: async () => 'interactive secret' },
    )).rejects.toThrow('phone already exists')
  })

  it.each([
    'phone=13800138000',
    '01012345678',
    '+86 13800138000',
    '12800138000',
  ])('rejects malformed administrator mobile %s before persistence', async (phone) => {
    const repository = { createAdmin: vi.fn(async () => undefined) }
    await expect(createAdmin(
      ['--phone', phone, '--name', '管理员'],
      { repository, readPassword: async () => 'valid password' },
    )).rejects.toThrow('Invalid mainland China mobile number')
    expect(repository.createAdmin).not.toHaveBeenCalled()
  })

  it.each(['1234567', 'a'.repeat(73), `${'密'.repeat(24)}a`])(
    'rejects password outside 8..72 UTF-8 bytes before persistence',
    async (password) => {
      const repository = { createAdmin: vi.fn(async () => undefined) }
      await expect(createAdmin(
        ['--phone', '13800138000', '--name', '管理员'],
        { repository, readPassword: async () => password },
      )).rejects.toThrow('Password must be 8 to 72 UTF-8 bytes')
      expect(repository.createAdmin).not.toHaveBeenCalled()
    },
  )
})
