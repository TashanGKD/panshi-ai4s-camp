import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { validateCriticalNginxConfig } from './helpers/nginx-config-validator.mjs'

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
  assert.equal(
    result.status,
    0,
    `${options.label ?? `${command} ${args.join(' ')}`} failed (exit ${result.status})\n${result.stdout}${result.stderr}`,
  )
  return result
}

const pathExists = async (path) => stat(path).then(() => true, () => false)
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
    dependencyPaths: [
      'package.json', 'package-lock.json', 'tsconfig.base.json',
      'apps/web/package.json', 'apps/admin/package.json', 'packages/contracts', 'packages/ui',
    ],
    buildPaths: ['apps/web', 'apps/admin'],
    expectedOutputs: ['apps/web/dist/index.html', 'apps/admin/dist/index.html'],
  },
  {
    name: 'admin image',
    dockerfile: 'apps/admin/Dockerfile',
    dependencyPaths: [
      'package.json', 'package-lock.json', 'tsconfig.base.json',
      'apps/admin/package.json', 'packages/contracts', 'packages/ui',
    ],
    buildPaths: ['apps/admin'],
    expectedOutputs: ['apps/admin/dist/index.html'],
  },
  {
    name: 'api image',
    dockerfile: 'apps/api/Dockerfile',
    dependencyPaths: [
      'package.json', 'package-lock.json', 'tsconfig.base.json',
      'apps/api/package.json', 'packages/contracts',
    ],
    buildPaths: ['apps/api'],
    expectedOutputs: [
      'apps/api/dist/src/server.js',
      'apps/api/dist/src/db/migrate.js',
      'apps/api/dist/drizzle/0001_initial.sql',
      'packages/contracts/dist/index.js',
    ],
  },
]

const simulateCleanDockerBuild = async (simulation) => {
  const context = await mkdtemp(join(tmpdir(), 'panshi-deployment-test-'))
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
    for (const command of buildCommands) {
      runSuccessfully('sh', ['-c', command], { cwd: context, label: `${simulation.name} build stage` })
    }

    for (const output of simulation.expectedOutputs) {
      assert.ok(await pathExists(join(context, output)), `${simulation.name} must emit ${output}`)
    }

    if (simulation.name === 'web image' || simulation.name === 'admin image') {
      const adminHtml = await readFile(join(context, 'apps/admin/dist/index.html'), 'utf8')
      assert.match(adminHtml, /(?:src|href)="\/admin\/assets\//u, 'admin build output must use the /admin/ asset base')
    }

    if (simulation.name === 'api image') {
      runSuccessfully('node', ['--input-type=module', '-e', "await import('./apps/api/dist/src/server.js'); await import('./apps/api/dist/src/db/migrate.js'); await import('@panshi/contracts')"], {
        cwd: context,
        label: 'API production runtime imports',
      })
    }
  } finally {
    await rm(context, { recursive: true, force: true })
  }
}

for (const simulation of simulations) await simulateCleanDockerBuild(simulation)

const webDockerfile = await readProjectFile('apps/web/Dockerfile')
assert.doesNotMatch(webDockerfile, /apps\/api|@panshi\/api/u, 'frontend image must not use backend source or builds')
assert.match(webDockerfile, /COPY --from=web-build \/app\/apps\/web\/dist \/usr\/share\/nginx\/html/u, 'Nginx image must contain the web artifact')
assert.match(webDockerfile, /COPY --from=admin-build \/app\/apps\/admin\/dist \/usr\/share\/nginx\/html\/admin/u, 'Nginx image must contain the admin artifact')

const dockerignore = await readProjectFile('.dockerignore')
const ignoredPaths = new Set(dockerignore.split(/\r?\n/u))
for (const privateOrGeneratedPath of ['.env', 'node_modules', 'dist', 'var/uploads']) {
  assert.ok(ignoredPaths.has(privateOrGeneratedPath), `.dockerignore must exclude ${privateOrGeneratedPath}`)
}

const nginx = await readProjectFile('deploy/nginx.conf')
validateCriticalNginxConfig(nginx)

const parseYaml = (path) => {
  const ruby = "data = YAML.safe_load(File.read(ARGV.fetch(0)), [], [], true); puts JSON.generate(data)"
  const result = runSuccessfully('ruby', ['-ryaml', '-rjson', '-e', ruby, join(projectRoot, path)], { label: `parse ${path}` })
  return JSON.parse(result.stdout)
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const mergeCompose = (base, override) => {
  if (!isObject(base) || !isObject(override)) return override
  const merged = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (key === 'ports') {
      merged[key] = [...(base[key] ?? []), ...value]
    } else if (key === 'volumes' && Array.isArray(value)) {
      const byTarget = new Map((base[key] ?? []).map((entry) => [String(entry).split(':').at(-1), entry]))
      for (const entry of value) byTarget.set(String(entry).split(':').at(-1), entry)
      merged[key] = [...byTarget.values()]
    } else {
      merged[key] = key in base ? mergeCompose(base[key], value) : value
    }
  }
  return merged
}

const baseCompose = parseYaml('compose.yaml')
const localOverride = parseYaml('compose.override.yaml')
const productionOverride = parseYaml('compose.prod.yaml')
const localModel = mergeCompose(baseCompose, localOverride)
const productionModel = mergeCompose(baseCompose, productionOverride)
const localPostgres = localModel.services.postgres
const { postgres, migration, api, frontend } = productionModel.services

assert.deepEqual(localPostgres.ports, ['127.0.0.1:5433:5432'], 'local Compose must publish PostgreSQL on loopback port 5433')
assert.ok(!('ports' in postgres) || postgres.ports.length === 0, 'effective production PostgreSQL must not publish a host port')
assert.equal(postgres.image, 'postgres:16')
assert.equal(postgres.environment.POSTGRES_PASSWORD, '${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}')
assert.deepEqual(new Set(postgres.volumes), new Set(['database-data:/var/lib/postgresql/data', 'backups-data:/backups']))
assert.ok(postgres.healthcheck?.test, 'effective production database needs a healthcheck')
assert.deepEqual(migration.command, ['node', 'apps/api/dist/src/db/migrate.js'])
assert.equal(migration.image, 'panshi-ai4s-camp-api:${IMAGE_TAG:-local}')
assert.equal(migration.build.dockerfile, 'apps/api/Dockerfile')
assert.equal(migration.build.target, 'production')
assert.equal(migration.depends_on.postgres.condition, 'service_healthy')
assert.equal(migration.environment.DATABASE_URL, '${DATABASE_URL:?set DATABASE_URL}')
assert.equal(migration.restart, 'no')
assert.equal(api.image, 'panshi-ai4s-camp-api:${IMAGE_TAG:-local}')
assert.equal(api.build.dockerfile, 'apps/api/Dockerfile')
assert.equal(api.build.target, 'production')
assert.ok(!('command' in api), 'API must use the production image entrypoint')
assert.equal(api.depends_on.migration.condition, 'service_completed_successfully')
assert.deepEqual(api.volumes, ['uploads-data:/app/var/uploads'])
assert.ok(api.healthcheck?.test, 'effective production API needs a healthcheck')
assert.equal(api.environment.DATABASE_URL, '${DATABASE_URL:?set DATABASE_URL}')
assert.equal(api.environment.CORS_ORIGINS, '${CORS_ORIGINS:?set CORS_ORIGINS}')
assert.equal(frontend.image, 'panshi-ai4s-camp-frontend:${IMAGE_TAG:-local}')
assert.equal(frontend.build.dockerfile, 'apps/web/Dockerfile')
assert.equal(frontend.build.target, 'production')
assert.ok(!('command' in frontend), 'frontend must use the Nginx image entrypoint')
assert.equal(frontend.depends_on.api.condition, 'service_healthy')
assert.deepEqual(frontend.ports, ['${HTTP_BIND_ADDRESS:-0.0.0.0}:${HTTP_PORT:-8080}:8080'])
assert.ok(frontend.healthcheck?.test, 'effective production frontend needs a healthcheck')
assert.ok(!frontend.volumes?.some((volume) => String(volume).startsWith('uploads-data:')), 'frontend must not mount private uploads')
assert.deepEqual(new Set(Object.keys(productionModel.volumes)), new Set(['database-data', 'uploads-data', 'backups-data']))

const packageJson = JSON.parse(await readProjectFile('package.json'))
assert.equal(packageJson.scripts['test:deployment'], 'node tests/nginx-config-validator.test.mjs && node tests/deployment.test.mjs')
assert.match(packageJson.scripts.test, /npm run test:deployment/u, 'normal npm test must include deployment regressions')

const operations = await readProjectFile('docs/operations.md')
for (const variable of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'CORS_ORIGINS']) {
  assert.match(operations, new RegExp(variable, 'u'), `operations guide must document ${variable}`)
}

const composeCli = run('docker', ['compose', 'version'])
const dockerEngine = run('docker', ['info'])
if (composeCli.status === 0) {
  runSuccessfully('docker', ['compose', '-f', 'compose.yaml', '-f', 'compose.prod.yaml', 'config', '-q'], {
    env: {
      POSTGRES_DB: 'panshi_prod',
      POSTGRES_USER: 'panshi_app',
      POSTGRES_PASSWORD: 'deployment-test-only',
      DATABASE_URL: 'postgresql://panshi_app:deployment-test-only@postgres:5432/panshi_prod',
      CORS_ORIGINS: 'https://camp.example.org',
    },
    label: 'native Compose merged model validation',
  })
} else {
  console.warn('LIMITATION: Docker Compose CLI unavailable; validated the merged model with the structured YAML parser')
}

if (dockerEngine.status === 0) {
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
    runSuccessfully('docker', ['run', '--rm', '--add-host', 'api:127.0.0.1', `${tagPrefix}-web`, 'nginx', '-t'], { label: 'executable Nginx configuration validation' })
    runSuccessfully('docker', ['run', '--rm', '--entrypoint', 'node', `${tagPrefix}-api`, '--input-type=module', '-e', "await import('./apps/api/dist/src/server.js'); await import('./apps/api/dist/src/db/migrate.js'); await import('@panshi/contracts')"], { label: 'API image runtime imports' })

    const network = `${tagPrefix}-network`
    const apiContainer = `${tagPrefix}-api-stub`
    const frontendContainer = `${tagPrefix}-frontend`
    try {
      runSuccessfully('docker', ['network', 'create', network], { label: 'create deployment test network' })
      runSuccessfully('docker', [
        'run', '--detach', '--rm', '--network', network, '--name', apiContainer, '--entrypoint', 'node', `${tagPrefix}-api`,
        '-e', "require('node:http').createServer((request,response)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({url:request.url}))}).listen(3001,'0.0.0.0')",
      ], { label: 'start API routing stub' })
      runSuccessfully('docker', ['run', '--detach', '--rm', '--network', network, '--name', frontendContainer, '--publish', '127.0.0.1::8080', `${tagPrefix}-web`], { label: 'start frontend routing probe' })
      const published = runSuccessfully('docker', ['port', frontendContainer, '8080/tcp'], { label: 'resolve frontend test port' }).stdout.trim()
      assert.match(published, /^127\.0\.0\.1:\d+$/u, 'frontend test port must bind only to loopback')
      const baseUrl = `http://${published}`

      const health = await fetchEventually(`${baseUrl}/healthz`)
      assert.equal(health.status, 200)
      const apiProbe = await fetchEventually(`${baseUrl}/api/probe?value=1`)
      assert.deepEqual(await apiProbe.json(), { url: '/api/probe?value=1' }, 'Nginx must preserve the API prefix and query')
      const adminRedirect = await globalThis.fetch(`${baseUrl}/admin`, { redirect: 'manual' })
      assert.equal(adminRedirect.status, 308)
      assert.equal(adminRedirect.headers.get('location'), '/admin/')
      const adminFallback = await globalThis.fetch(`${baseUrl}/admin/deep/link`)
      assert.equal(adminFallback.status, 200)
      assert.match(await adminFallback.text(), /\/admin\/assets\//u)
      const webFallback = await globalThis.fetch(`${baseUrl}/schedule/deep/link`)
      assert.equal(webFallback.status, 200)
      assert.doesNotMatch(await webFallback.text(), /\/admin\/assets\//u)
      assert.equal((await globalThis.fetch(`${baseUrl}/uploads`)).status, 404)
      assert.equal((await globalThis.fetch(`${baseUrl}/uploads/private.pdf`)).status, 404)
    } finally {
      run('docker', ['rm', '--force', frontendContainer, apiContainer])
      run('docker', ['network', 'rm', network])
    }
  } finally {
    run('docker', ['image', 'rm', ...builds.map(([, , tag]) => tag)])
  }
} else {
  console.warn('LIMITATION: Docker engine unavailable; validated exact clean dependency/build stages and structured Nginx routing instead')
}

console.log('deployment configuration and clean-build checks passed')
