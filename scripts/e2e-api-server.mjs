import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixtureScripts = {
  application: 'e2e:application-fixture',
  content: 'e2e:publishing-fixture',
  launch: 'e2e:launch-fixture',
  review: 'e2e:application-fixture',
  'student-auth': 'e2e:student-auth-fixture',
  visual: 'e2e:visual-fixture',
}

export const runApiLifecycle = async ({ migrate, seed, serve, cleanup }) => {
  try {
    await migrate()
    await seed()
    await serve()
  } finally {
    await cleanup()
  }
}

export const e2eApiEnvironment = (environment = process.env) => ({
  RATE_LIMIT_LOGIN_FAILURE_MAX: '100',
  RATE_LIMIT_AUTH_MAX: '10000',
  RATE_LIMIT_PUBLIC_MAX: '10000',
  RATE_LIMIT_AUTHENTICATED_MAX: '10000',
  RATE_LIMIT_ADMIN_MAX: '10000',
  ...environment,
})

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const fixture = process.argv[2] === '--fixture' ? process.argv[3] : undefined
  const fixtureScript = fixture && fixtureScripts[fixture]
  if (!fixtureScript) throw new Error(`Expected --fixture ${Object.keys(fixtureScripts).join('|')}`)

  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const apiEnvironment = e2eApiEnvironment()
  let activeChild
  let stoppingSignal
  const run = (command, args, options = {}) => new Promise((resolve, reject) => {
    if (stoppingSignal && !options.allowStoppedStart) {
      reject(new Error(`Refusing to start ${command} after ${stoppingSignal}`))
      return
    }
    const child = spawn(command, args, { cwd: process.cwd(), env: apiEnvironment, stdio: 'inherit' })
    activeChild = child
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (activeChild === child) activeChild = undefined
      if (code === 0 || (options.allowSignalExit && stoppingSignal && signal)) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`))
    })
  })
  const stop = (signal) => {
    stoppingSignal = signal
    activeChild?.kill(signal)
  }
  const stopForSigint = () => stop('SIGINT')
  const stopForSigterm = () => stop('SIGTERM')
  process.once('SIGINT', stopForSigint)
  process.once('SIGTERM', stopForSigterm)

  try {
    await runApiLifecycle({
      migrate: () => run(npmExecutable, ['run', 'db:migrate', '-w', '@panshi/api']),
      seed: () => run(npmExecutable, ['run', fixtureScript, '-w', '@panshi/api', '--', 'seed']),
      serve: () => run(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], { allowSignalExit: true }),
      cleanup: () => run(npmExecutable, ['run', fixtureScript, '-w', '@panshi/api', '--', 'cleanup'], { allowStoppedStart: true }),
    })
  } finally {
    process.removeListener('SIGINT', stopForSigint)
    process.removeListener('SIGTERM', stopForSigterm)
  }
}
