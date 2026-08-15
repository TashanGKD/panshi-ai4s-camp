import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runApiLifecycle } from '../scripts/e2e-api-server.mjs'

test('failed migration skips seed and server but still runs cleanup', async () => {
  const calls = []
  await assert.rejects(runApiLifecycle({
    migrate: async () => { calls.push('migrate'); throw new Error('simulated migration failure') },
    seed: async () => { calls.push('seed') },
    serve: async () => { calls.push('serve') },
    cleanup: async () => { calls.push('cleanup') },
  }), /simulated migration failure/u)
  assert.deepEqual(calls, ['migrate', 'cleanup'])
})

test('every Playwright API server uses the fail-fast lifecycle launcher', async () => {
  const configs = {
    'playwright.config.ts': 'launch',
    'playwright.visual.config.ts': 'visual',
    'playwright.review.config.ts': 'review',
    'playwright.content.config.ts': 'content',
    'playwright.student-auth.config.ts': 'student-auth',
    'playwright.application.config.ts': 'application',
  }
  for (const [config, fixture] of Object.entries(configs)) {
    const source = await readFile(config, 'utf8')
    assert.match(source, new RegExp(`command: ['"]node scripts/e2e-api-server\\.mjs --fixture ${fixture}['"]`, 'u'), config)
    assert.doesNotMatch(source, /command: ['"][^'"]*db:migrate/u, config)
  }
})
