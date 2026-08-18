import { spawn } from 'node:child_process'
import pg from 'pg'

const value = process.env.TEST_DATABASE_URL
let url
try { url = value ? new URL(value) : undefined } catch { url = undefined }
if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/panshi_ai4s_camp_test') {
  console.error('TEST_DATABASE_URL must target loopback database panshi_ai4s_camp_test')
  process.exit(1)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = { ...process.env, DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString() }
const run = (args, runtimeEnv = env) => new Promise((resolve, reject) => {
  const child = spawn(npm, args, { cwd: process.cwd(), env: runtimeEnv, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} exited with ${code ?? signal}`)))
})

const suites = ['content', 'publishing', 'auth', 'migrations', 'student-auth', 'registration', 'files', 'application', 'resources', 'admin-management', 'summary', 'schema']
try {
  const unitEnv = { ...env }
  delete unitEnv.TEST_DATABASE_URL
  delete unitEnv.DATABASE_URL
  await run(['run', 'test:parity'], unitEnv)
  await run(['test'], unitEnv)
  for (const suite of suites) {
    await run(['run', 'db:migrate', '-w', '@panshi/api'])
    await run(['run', `test:integration:${suite}`, '-w', '@panshi/api'])
  }
} finally {
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 })
  try {
    const result = await pool.query("select tablename from pg_tables where schemaname='public' and tablename <> 'panshi_schema_migrations'")
    if (result.rows.length) await pool.query(`truncate ${result.rows.map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`).join(', ')} cascade`)
  } finally { await pool.end() }
}
