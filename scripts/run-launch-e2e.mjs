import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const playwrightCli = require.resolve('@playwright/test/cli')
const runToken = /^[a-f0-9]{64}$/u.test(process.env.E2E_RUN_TOKEN ?? '')
  ? process.env.E2E_RUN_TOKEN
  : randomBytes(32).toString('hex')
const startedAt = Number.isFinite(Date.parse(process.env.E2E_RUN_STARTED_AT ?? ''))
  ? process.env.E2E_RUN_STARTED_AT
  : new Date().toISOString()
const env = { ...process.env, E2E_RUN_TOKEN: runToken, E2E_RUN_STARTED_AT: startedAt }

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)))
})

await run(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)])
await run(process.execPath, ['tests/verify-launch-screenshots.mjs'])
