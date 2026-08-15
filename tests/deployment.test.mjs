import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  assert.equal(
    result.status,
    0,
    `${options.label ?? `${command} ${args.join(' ')}`} failed (exit ${result.status})\n${result.stdout}${result.stderr}`,
  )
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

const extractBlocks = (source, keyword) => {
  const blocks = new Map()
  const pattern = new RegExp(`(?:^|\\n)\\s*${keyword}\\s+([^\\n{]+)\\s*\\{`, 'gu')
  for (const match of source.matchAll(pattern)) {
    const openIndex = match.index + match[0].lastIndexOf('{')
    let depth = 1
    let quote = ''
    let closeIndex = openIndex + 1
    for (; closeIndex < source.length && depth > 0; closeIndex += 1) {
      const character = source[closeIndex]
      if (quote) {
        if (character === quote && source[closeIndex - 1] !== '\\') quote = ''
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1
      }
    }
    assert.equal(depth, 0, `unbalanced ${keyword} block for ${match[1].trim()}`)
    blocks.set(match[1].trim(), source.slice(openIndex + 1, closeIndex - 1))
  }
  return blocks
}

const directives = (block) => new Map(block
  .split(/;\s*(?:\r?\n|$)/u)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.includes('{'))
  .map((line) => {
    const separator = line.search(/\s/u)
    return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator).trim()]
  }))

const nginx = await readProjectFile('deploy/nginx.conf')
const locations = extractBlocks(nginx, 'location')
for (const selector of ['= /healthz', '= /uploads', '^~ /uploads/', '/api/', '= /admin', '^~ /admin/', '/']) {
  assert.ok(locations.has(selector), `Nginx must define location ${selector}`)
}
assert.equal(directives(locations.get('/api/')).get('proxy_pass'), 'http://api:3001', '/api/ must proxy without stripping its prefix')
assert.equal(directives(locations.get('= /admin')).get('return'), '308 /admin/', '/admin must redirect to its canonical trailing-slash URL')
assert.equal(directives(locations.get('^~ /admin/')).get('try_files'), '$uri $uri/ /admin/index.html', 'admin location must use its SPA fallback')
assert.equal(directives(locations.get('/')).get('try_files'), '$uri $uri/ /index.html', 'public location must use its SPA fallback')
assert.equal(directives(locations.get('= /uploads')).get('return'), '404', 'exact /uploads path must be denied')
assert.equal(directives(locations.get('^~ /uploads/')).get('return'), '404', '/uploads descendants must be denied')
assert.doesNotMatch(nginx, /(?:alias|root)\s+[^;]*uploads/iu, 'Nginx must never map the private uploads directory')

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
assert.equal(packageJson.scripts['test:deployment'], 'node tests/deployment.test.mjs')
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
  } finally {
    run('docker', ['image', 'rm', ...builds.map(([, , tag]) => tag)])
  }
} else {
  console.warn('LIMITATION: Docker engine unavailable; validated exact clean dependency/build stages and structured Nginx routing instead')
}

console.log('deployment configuration and clean-build checks passed')
