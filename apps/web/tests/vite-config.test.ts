// @vitest-environment node

import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

describe('Vite environment directory', () => {
  it('loads browser environment variables from the project root', async () => {
    const projectRoot = await realpath(fileURLToPath(new URL('../../..', import.meta.url)))

    expect(await realpath(viteConfig.envDir as string)).toBe(projectRoot)
    expect(await readFile(new URL('../../../.env.example', import.meta.url), 'utf8'))
      .toMatch(/^VITE_API_BASE_URL=/mu)
  })
})
