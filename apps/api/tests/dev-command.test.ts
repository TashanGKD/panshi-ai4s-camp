import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type ApiPackage = { scripts: { dev?: string } }

describe('API development command', () => {
  it('loads the project-root environment with the supported Node watch option order', async () => {
    const apiRoot = fileURLToPath(new URL('..', import.meta.url))
    const apiPackage = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as ApiPackage

    expect(apiPackage.scripts.dev).toBe(
      'node --watch --env-file=../../.env --import tsx src/server.ts',
    )

    const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-api-dev-command-'))
    try {
      const envPath = join(temporaryRoot, '.env')
      const probePath = join(temporaryRoot, 'probe.ts')
      await writeFile(envPath, 'PANSHI_DEV_ENV_PROBE=loaded-from-temp-root\n')
      await writeFile(
        probePath,
        "const loaded: string | undefined = process.env.PANSHI_DEV_ENV_PROBE\nconsole.log(loaded)\n",
      )

      const child = spawn(process.execPath, [
        '--watch',
        `--env-file=${envPath}`,
        '--import',
        'tsx',
        probePath,
      ], {
        cwd: apiRoot,
      })
      let stderr = ''
      let stdout = ''
      child.stderr.setEncoding('utf8')
      child.stdout.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => { stderr += chunk })

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill('SIGTERM')
          reject(new Error('Node watch probe did not load the environment in time'))
        }, 5_000)

        child.once('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk
          if (stdout.includes('loaded-from-temp-root')) {
            clearTimeout(timeout)
            child.kill('SIGTERM')
          }
        })
        child.once('close', () => {
          clearTimeout(timeout)
          resolve()
        })
      })

      expect(stderr).toBe('')
      expect(stdout).toContain('loaded-from-temp-root')
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
