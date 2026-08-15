import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = {
  ...process.env,
  E2E_RUN_TOKEN: randomBytes(32).toString('hex'),
  E2E_RUN_STARTED_AT: new Date().toISOString(),
}
const scripts = ['e2e:launch', 'visual:test', 'e2e:review', 'e2e:content', 'e2e:student-auth', 'e2e:application']

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`)))
})

for (const script of scripts) await run(npmExecutable, ['run', script])
await run(process.execPath, ['tests/verify-launch-screenshots.mjs'])
