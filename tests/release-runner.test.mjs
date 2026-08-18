import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('release runner rejects production-like databases before spawning suites and guarantees cleanup', async () => {
  const source = await readFile(new URL('../scripts/run-release-tests.mjs', import.meta.url), 'utf8')
  assert.match(source, /finally\s*\{/u)
  assert.match(source, /truncate/u)
  assert.match(source, /delete unitEnv\.TEST_DATABASE_URL[\s\S]*delete unitEnv\.DATABASE_URL/u)
  assert.match(source, /run\(\['run', 'test:parity'\], unitEnv\)/u)
  assert.match(source, /for \(const suite of suites\)[\s\S]*db:migrate[\s\S]*test:integration/u)
  const result = spawnSync(process.execPath, ['scripts/run-release-tests.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, TEST_DATABASE_URL: 'postgresql://db.production.example/panshi_ai4s_camp_test' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must target loopback database/u)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /> test\b|db:migrate/u)
})
