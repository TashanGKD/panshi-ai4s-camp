import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const exact = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
if (process.env.TEST_DATABASE_URL !== exact) {
  console.error('TEST_DATABASE_URL must be the exact loopback panshi_ai4s_camp_test database')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const playwrightCli = require.resolve('@playwright/test/cli')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = {
  ...process.env,
  CLI_E2E: '1',
  APPLICATION_E2E: '1',
  E2E_VERIFICATION_CODE: process.env.E2E_VERIFICATION_CODE ?? '123456',
  E2E_REGISTER_PHONE: process.env.E2E_REGISTER_PHONE ?? '+8613800000099',
  E2E_REGISTER_PASSWORD: process.env.E2E_REGISTER_PASSWORD ?? 'Cli-E2E-Student-19!',
  E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? 'Cli-E2E-Admin-19!',
  VERIFICATION_SECRET: process.env.VERIFICATION_SECRET ?? '11'.repeat(32),
}

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`)))
})

await run(npm, ['run', 'build', '-w', '@panshi/contracts'])
await run(npm, ['run', 'build', '-w', '@panshi/camp-client'])
await run(npm, ['run', 'build', '-w', 'panshi-camp-cli'])
await run(process.execPath, [playwrightCli, 'test', '--config=playwright.cli.config.ts'])
