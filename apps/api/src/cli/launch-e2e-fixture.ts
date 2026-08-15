import { resolve } from 'node:path'
import { readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runApplicationFixture } from './application-e2e-fixture.js'

const exactUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const launchStorageRoots = ['var/e2e-uploads', 'var/e2e-temp'] as const

const clearLaunchStorageContents = async () => {
  for (const relativeRoot of launchStorageRoots) {
    const root = resolve(projectRoot, relativeRoot)
    const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))
    await Promise.all(entries
      .filter((entry) => entry !== '.panshi-storage-root' && !(relativeRoot === 'var/e2e-uploads' && entry === '.tmp'))
      .map((entry) => rm(resolve(root, entry), { recursive: true, force: true })))
    if (relativeRoot === 'var/e2e-uploads') {
      const temporaryEntries = await readdir(resolve(root, '.tmp')).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))
      await Promise.all(temporaryEntries.map((entry) => rm(resolve(root, '.tmp', entry), { recursive: true, force: true })))
    }
  }
}

export const runLaunchFixture = async (operation: 'seed' | 'reset' | 'cleanup') => {
  if (process.env.LAUNCH_E2E !== '1' || process.env.DATABASE_URL !== exactUrl) throw new Error('Launch E2E fixture refused')
  process.env.APPLICATION_E2E = '1'
  if (operation === 'reset') {
    await clearLaunchStorageContents()
    await runApplicationFixture('seed')
    return
  }
  await runApplicationFixture(operation)
}
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const operation = process.argv[2]
  if (operation !== 'seed' && operation !== 'reset' && operation !== 'cleanup') throw new Error('Expected seed, reset or cleanup')
  await runLaunchFixture(operation)
}
