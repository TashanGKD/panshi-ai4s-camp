import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { runCli } from './main.js'

const cliPackage = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }

describe('CLI version', () => {
  it('prints the package version without touching runtime services', async () => {
    const stdout = vi.fn()
    const stderr = vi.fn()
    const fetch = vi.fn()
    const readConfig = vi.fn()
    const getCredential = vi.fn()

    await expect(runCli(['--version'], {
      stdout,
      stderr,
      fetch: fetch as typeof globalThis.fetch,
      readConfig,
      getCredential,
    })).resolves.toBe(0)

    expect(stdout).toHaveBeenCalledExactlyOnceWith(`${cliPackage.version}\n`)
    expect(stderr).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(readConfig).not.toHaveBeenCalled()
    expect(getCredential).not.toHaveBeenCalled()
  })
})
