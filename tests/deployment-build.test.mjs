import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const readProjectFile = (path) => readFile(join(projectRoot, path), 'utf8')
const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: options.cwd ?? projectRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    VITE_API_BASE_URL: '',
    VITE_PUBLIC_WEB_BASE_URL: '',
    ...options.env,
  },
  maxBuffer: 20 * 1024 * 1024,
})

const runSuccessfully = (command, args, options = {}) => {
  const result = run(command, args, options)
  assert.equal(result.status, 0, `${options.label ?? `${command} ${args.join(' ')}`} failed (exit ${result.status})\n${result.stdout}${result.stderr}`)
  return result
}

const pathExists = async (path) => stat(path).then(() => true, () => false)
const copyClean = async (sourcePath, destinationRoot) => {
  const source = join(projectRoot, sourcePath)
  const destination = join(destinationRoot, sourcePath)
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, {
    recursive: true,
    filter: (path) => !/(?:^|\/)(?:node_modules|dist|coverage|\.env(?:\..*)?)\/?$/u.test(path),
  })
}

const dockerRunCommands = (dockerfile) => dockerfile
  .replace(/\\\r?\n\s*/gu, ' ')
  .split(/\r?\n/u)
  .filter((line) => line.startsWith('RUN '))
  .map((line) => line.slice(4))

const simulations = [
  {
    name: 'web image',
    dockerfile: 'apps/web/Dockerfile',
    dependencyPaths: ['package.json', 'package-lock.json', 'tsconfig.base.json', 'apps/web/package.json', 'apps/admin/package.json', 'packages/contracts', 'packages/ui'],
    buildPaths: ['apps/web', 'apps/admin'],
    expectedOutputs: ['apps/web/dist/index.html', 'apps/admin/dist/index.html'],
  },
  {
    name: 'admin image',
    dockerfile: 'apps/admin/Dockerfile',
    dependencyPaths: ['package.json', 'package-lock.json', 'tsconfig.base.json', 'apps/admin/package.json', 'packages/contracts', 'packages/ui'],
    buildPaths: ['apps/admin'],
    expectedOutputs: ['apps/admin/dist/index.html'],
  },
  {
    name: 'api image',
    dockerfile: 'apps/api/Dockerfile',
    dependencyPaths: ['package.json', 'package-lock.json', 'tsconfig.base.json', 'apps/api/package.json', 'packages/contracts'],
    buildPaths: ['apps/api'],
    expectedOutputs: ['apps/api/dist/src/server.js', 'apps/api/dist/src/db/migrate.js', 'apps/api/dist/src/cli/create-admin.js', 'apps/api/dist/drizzle/0001_initial.sql', 'packages/contracts/dist/index.js'],
  },
]

const simulateCleanDockerBuild = async (simulation) => {
  const context = await mkdtemp(join(tmpdir(), 'panshi-deployment-build-'))
  try {
    for (const path of simulation.dependencyPaths) await copyClean(path, context)
    const dockerfile = await readProjectFile(simulation.dockerfile)
    const runCommands = dockerRunCommands(dockerfile)
    const installCommand = runCommands.find((command) => command.startsWith('npm ci '))
    assert.ok(installCommand, `${simulation.dockerfile} must contain an npm ci dependency stage`)
    runSuccessfully('sh', ['-c', installCommand], { cwd: context, label: `${simulation.name} clean dependency stage` })

    for (const path of simulation.buildPaths) await copyClean(path, context)
    const buildCommands = runCommands.filter((command) => command.startsWith('npm run build '))
    assert.ok(buildCommands.length > 0, `${simulation.dockerfile} must contain build RUN commands`)
    for (const command of buildCommands) runSuccessfully('sh', ['-c', command], { cwd: context, label: `${simulation.name} build stage` })
    for (const output of simulation.expectedOutputs) assert.ok(await pathExists(join(context, output)), `${simulation.name} must emit ${output}`)

    if (simulation.name !== 'api image') {
      const adminHtml = await readFile(join(context, 'apps/admin/dist/index.html'), 'utf8')
      assert.match(adminHtml, /(?:src|href)="\/admin\/assets\//u, 'admin output must use the /admin/ asset base')
    } else {
      runSuccessfully('node', ['--input-type=module', '-e', "await import('./apps/api/dist/src/server.js'); await import('./apps/api/dist/src/db/migrate.js'); await import('./apps/api/dist/src/cli/create-admin.js'); await import('@panshi/contracts')"], {
        cwd: context,
        label: 'API production runtime imports',
      })
    }
  } finally {
    await rm(context, { recursive: true, force: true })
  }
}

for (const simulation of simulations) await simulateCleanDockerBuild(simulation)
console.log('clean-context dependency, build-output, and API runtime-import checks passed')

const composeEnvironment = {
  POSTGRES_DB: 'panshi_prod',
  POSTGRES_USER: 'panshi_app',
  POSTGRES_PASSWORD: 'deployment-test-only',
  DATABASE_URL: 'postgresql://panshi_app:deployment-test-only@postgres:5432/panshi_prod',
  CORS_ORIGINS: 'https://camp.example.org',
}
const composeCli = run('docker', ['compose', 'version'])
if (composeCli.status === 0) {
  runSuccessfully('docker', ['compose', '-p', 'panshi-ai4s-camp-prod-test', '-f', 'compose.yaml', '-f', 'compose.prod.yaml', 'config', '-q'], {
    env: composeEnvironment,
    label: 'native Compose effective-model validation',
  })
  console.log('native Docker Compose effective-model check passed')
} else {
  console.warn('LIMITATION: Docker Compose plugin unavailable; native Compose model validation skipped')
}

const dockerEngine = run('docker', ['info'])
if (dockerEngine.status !== 0) {
  console.warn('LIMITATION: Docker engine unavailable; image builds, executable Nginx validation, and live HTTP/upload-boundary checks skipped')
  console.log('deployment build tier passed with Docker checks skipped')
  process.exit(0)
}

const fetchEventually = async (url) => {
  let lastError
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await globalThis.fetch(url)
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status} from ${url}`)
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  throw lastError
}

const tagPrefix = `panshi-deployment-test-${process.pid}`
const builds = [
  ['apps/web/Dockerfile', 'production', `${tagPrefix}-web`],
  ['apps/admin/Dockerfile', 'artifact', `${tagPrefix}-admin`],
  ['apps/api/Dockerfile', 'production', `${tagPrefix}-api`],
]
try {
  for (const [dockerfile, target, tag] of builds) {
    runSuccessfully('docker', ['build', '--file', dockerfile, '--target', target, '--tag', tag, '.'], { label: `Docker build ${dockerfile}` })
  }
  runSuccessfully('docker', ['run', '--rm', '--add-host', 'api:127.0.0.1', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', `${tagPrefix}-web`, 'nginx', '-t'], { label: 'executable hardened Nginx configuration validation' })
  runSuccessfully('docker', ['run', '--rm', '--entrypoint', 'node', `${tagPrefix}-api`, '--input-type=module', '-e', "await import('./apps/api/dist/src/server.js'); await import('./apps/api/dist/src/db/migrate.js'); await import('./apps/api/dist/src/cli/create-admin.js'); await import('@panshi/contracts')"], { label: 'API image runtime imports' })

  const network = `${tagPrefix}-network`
  const apiContainer = `${tagPrefix}-api-stub`
  const frontendContainer = `${tagPrefix}-frontend`
  try {
    runSuccessfully('docker', ['network', 'create', network], { label: 'create deployment test network' })
    runSuccessfully('docker', [
      'run', '--detach', '--rm', '--network', network, '--name', apiContainer, '--entrypoint', 'node', `${tagPrefix}-api`, '--input-type=module', '-e',
      "import http from 'node:http'; http.createServer((request,response)=>{let bytes=0;request.on('data',chunk=>{bytes+=chunk.length});request.on('end',()=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({url:request.url,bytes}))})}).listen(3001,'0.0.0.0')",
    ], { label: 'start API routing stub' })
    runSuccessfully('docker', ['run', '--detach', '--rm', '--network', network, '--name', frontendContainer, '--publish', '127.0.0.1::8080', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', `${tagPrefix}-web`], { label: 'start hardened frontend routing probe' })
    const published = runSuccessfully('docker', ['port', frontendContainer, '8080/tcp'], { label: 'resolve frontend test port' }).stdout.trim()
    assert.match(published, /^127\.0\.0\.1:\d+$/u)
    const baseUrl = `http://${published}`

    const health = await fetchEventually(`${baseUrl}/healthz`)
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(health.headers.get('x-frame-options'), 'DENY')
    const apiProbe = await fetchEventually(`${baseUrl}/api/probe?value=1`)
    assert.deepEqual(await apiProbe.json(), { url: '/api/probe?value=1', bytes: 0 })
    assert.equal((await globalThis.fetch(`${baseUrl}/admin`, { redirect: 'manual' })).status, 308)
    assert.equal((await globalThis.fetch(`${baseUrl}/admin/deep/link`)).status, 200)
    assert.equal((await globalThis.fetch(`${baseUrl}/schedule/deep/link`)).status, 200)
    assert.equal((await globalThis.fetch(`${baseUrl}/uploads`)).status, 404)
    assert.equal((await globalThis.fetch(`${baseUrl}/uploads/private.pdf`)).status, 404)

    const allowedBytes = 5 * 1024 * 1024 + 64 * 1024
    const allowedUpload = await globalThis.fetch(`${baseUrl}/api/upload-probe`, { method: 'POST', body: Buffer.alloc(allowedBytes) })
    assert.equal(allowedUpload.status, 200, '5 MiB plus 64 KiB overhead must pass through Nginx')
    assert.equal((await allowedUpload.json()).bytes, allowedBytes)
    const rejectedUpload = await globalThis.fetch(`${baseUrl}/api/upload-probe`, { method: 'POST', body: Buffer.alloc(6 * 1024 * 1024 + 1) })
    assert.equal(rejectedUpload.status, 413, 'request bodies above 6 MiB must be rejected by Nginx')
  } finally {
    run('docker', ['rm', '--force', frontendContainer, apiContainer])
    run('docker', ['network', 'rm', network])
  }
} finally {
  run('docker', ['image', 'rm', ...builds.map(([, , tag]) => tag)])
}

console.log('deployment build tier passed, including Docker image and live HTTP checks')
