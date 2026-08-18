import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseCliArgv } from './argv.js'
import { loadConfig, resolveEndpoint } from './config.js'
import { readSecret, readSecretBundle } from './io.js'
import { runCli } from './main.js'

describe('CLI safe defaults', () => {
  it('prints help without network, config, keychain, or filesystem mutation', async () => {
    const stdout = vi.fn(); const stderr = vi.fn(); const fetch = vi.fn(); const readConfig = vi.fn(); const credential = vi.fn()
    await expect(runCli([], { stdout, stderr, fetch: fetch as typeof globalThis.fetch, readConfig, getCredential: credential })).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled(); expect(readConfig).not.toHaveBeenCalled(); expect(credential).not.toHaveBeenCalled()
  })

  it('emits a single stable JSON failure for an unknown command', async () => {
    const stdout = vi.fn(); const stderr = vi.fn()
    await expect(runCli(['--json', 'unknown'], { stdout, stderr })).resolves.toBe(1)
    expect(stdout).toHaveBeenCalledOnce()
    expect(stderr).not.toHaveBeenCalled()
    expect(JSON.parse(stdout.mock.calls[0]?.[0] as string)).toMatchObject({ ok: false, code: 'INPUT_INVALID' })
  })

  it('uses an available learner credential for optionally authenticated resource reads', async () => {
    const token = 'a'.repeat(64)
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`)
      return new Response(JSON.stringify({ apiVersion: 'v1', data: { resources: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const stdout = vi.fn()

    await expect(runCli(['--json', 'resources', 'list'], {
      stdout,
      fetch: fetch as typeof globalThis.fetch,
      getCredential: async () => token,
    })).resolves.toBe(0)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['--password', '--verification-code', '--token', '--cookie'])('rejects secret-bearing option %s', (option) => {
    expect(() => parseCliArgv(['auth', 'login', option, 'secret'])).toThrow('UNKNOWN_OR_FORBIDDEN_OPTION')
  })

  it('defaults only to the local API and gates production', () => {
    expect(resolveEndpoint({})).toBe('http://127.0.0.1:3001')
    expect(() => resolveEndpoint({ explicitBaseUrl: 'https://camp.example.org' })).toThrow('PRODUCTION_PROFILE_REQUIRED')
    expect(resolveEndpoint({ profile: { name: 'live', baseUrl: 'https://camp.example.org' }, environment: 'production' })).toBe('https://camp.example.org')
  })

  it('rejects secret keys and symlinked config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-cli-config-'))
    await mkdir(join(root, 'real'), { mode: 0o700 })
    await writeFile(join(root, 'real', 'bad.json'), JSON.stringify({ token: 'secret' }), { mode: 0o600 })
    await expect(loadConfig(join(root, 'real', 'bad.json'))).rejects.toMatchObject({ code: 'CONFIG_SECRET_FORBIDDEN' })
    await writeFile(join(root, 'real', 'ok.json'), JSON.stringify({ profiles: {} }), { mode: 0o600 })
    await symlink(join(root, 'real', 'ok.json'), join(root, 'config.json'))
    await expect(loadConfig(join(root, 'config.json'))).rejects.toMatchObject({ code: 'CONFIG_SYMLINK_FORBIDDEN' })
  })

  it('rejects a symlinked configuration directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-cli-config-dir-'))
    await mkdir(join(root, 'real'), { mode: 0o700 })
    await writeFile(join(root, 'real', 'config.json'), JSON.stringify({ profiles: {} }), { mode: 0o600 })
    await symlink(join(root, 'real'), join(root, 'linked'))
    await expect(loadConfig(join(root, 'linked', 'config.json'))).rejects.toMatchObject({ code: 'CONFIG_DIRECTORY_UNSAFE' })
  })

  it('requires a TTY or dedicated inherited file descriptor for secrets', async () => {
    await expect(readSecret({ isTTY: false, env: {}, readFd: vi.fn() }, '密码')).rejects.toMatchObject({ code: 'INTERACTIVE_INPUT_REQUIRED' })
    const readFd = vi.fn(async (fd: number) => { expect(fd).toBe(9); return 'private\n' })
    await expect(readSecret({ isTTY: false, env: { PANSHI_CAMP_SECRET_FD: '9' }, readFd }, '密码')).resolves.toBe('private')
  })

  it('reads multiple agent secrets from one dedicated descriptor without using stdin', async () => {
    const readFd = vi.fn(async () => JSON.stringify({ code: '123456', password: 'private-value' }))
    await expect(readSecretBundle({ isTTY: false, env: { PANSHI_CAMP_SECRET_FD: '9' }, readFd }, [
      { key: 'code', label: '验证码' }, { key: 'password', label: '密码' },
    ])).resolves.toEqual({ code: '123456', password: 'private-value' })
    expect(readFd).toHaveBeenCalledOnce()
  })
})
