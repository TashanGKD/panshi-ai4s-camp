import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runApplicationFixture } from './application-e2e-fixture.js'

const exactUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
export const runLaunchFixture = async (operation: 'seed' | 'cleanup') => {
  if (process.env.LAUNCH_E2E !== '1' || process.env.DATABASE_URL !== exactUrl) throw new Error('Launch E2E fixture refused')
  process.env.APPLICATION_E2E = '1'
  await runApplicationFixture(operation)
}
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const operation = process.argv[2]
  if (operation !== 'seed' && operation !== 'cleanup') throw new Error('Expected seed or cleanup')
  await runLaunchFixture(operation)
}
