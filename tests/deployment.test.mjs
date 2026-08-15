import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { validateCriticalNginxConfig } from './helpers/nginx-config-validator.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const readProjectFile = (path) => readFile(join(projectRoot, path), 'utf8')
const parseYaml = async (path) => parse(await readProjectFile(path), { merge: true })

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

const baseCompose = await parseYaml('compose.yaml')
const localOverride = await parseYaml('compose.override.yaml')
const productionOverride = await parseYaml('compose.prod.yaml')
const localModel = mergeCompose(baseCompose, localOverride)
const productionModel = mergeCompose(baseCompose, productionOverride)
const { postgres, migration, api, frontend, operations: operationsService } = productionModel.services

assert.ok(!('name' in baseCompose), 'Compose must not fix a shared project name')
assert.deepEqual(localModel.services.postgres.ports, ['127.0.0.1:5433:5432'])
assert.ok(!postgres.ports?.length, 'effective production PostgreSQL must not publish a host port')
assert.equal(postgres.image, 'postgres:16.12-alpine3.23')
assert.equal(postgres.environment.POSTGRES_PASSWORD, '${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}')
assert.deepEqual(postgres.volumes, ['database-data:/var/lib/postgresql/data'])
assert.ok(postgres.healthcheck?.test, 'effective production database needs a healthcheck')

assert.deepEqual(migration.command, ['node', 'apps/api/dist/src/db/migrate.js'])
assert.equal(migration.depends_on.postgres.condition, 'service_healthy')
assert.equal(migration.restart, 'no')
assert.equal(api.depends_on.migration.condition, 'service_completed_successfully')
assert.equal(frontend.depends_on.api.condition, 'service_healthy')

assert.equal(migration.image, 'panshi-ai4s-camp-api:${IMAGE_TAG:-local}')
assert.equal(migration.build.dockerfile, 'apps/api/Dockerfile')
assert.equal(migration.build.target, 'production')
assert.equal(migration.environment.DATABASE_URL, '${DATABASE_URL:?set DATABASE_URL}')
assert.equal(api.image, migration.image)
assert.equal(api.build.dockerfile, 'apps/api/Dockerfile')
assert.equal(api.build.target, 'production')
assert.deepEqual(new Set(api.volumes), new Set(['uploads-data:/app/var/uploads', 'backups-data:/app/var/backups:ro']))
assert.ok(api.healthcheck?.test, 'effective production API needs a healthcheck')
assert.equal(api.environment.DATABASE_URL, '${DATABASE_URL:?set DATABASE_URL}')
assert.equal(api.environment.CORS_ORIGINS, '${CORS_ORIGINS:?set CORS_ORIGINS}')
assert.equal(api.environment.BACKUP_ROOT, '/app/var/backups')
assert.equal(api.environment.APP_VERSION, '${BACKUP_APP_VERSION:?set BACKUP_APP_VERSION}')
assert.ok(!('command' in api), 'API must retain its production image entrypoint')
assert.equal(frontend.image, 'panshi-ai4s-camp-frontend:${IMAGE_TAG:-local}')
assert.equal(frontend.build.dockerfile, 'apps/web/Dockerfile')
assert.equal(frontend.build.target, 'production')
assert.deepEqual(frontend.ports, ['${HTTP_BIND_ADDRESS:-127.0.0.1}:${HTTP_PORT:-8080}:8080'])
assert.ok(frontend.healthcheck?.test, 'effective production frontend needs a healthcheck')
assert.ok(!('command' in frontend), 'frontend must retain its unprivileged Nginx entrypoint')
assert.ok(!frontend.volumes?.some((volume) => String(volume).startsWith('uploads-data:')), 'frontend must not mount private uploads')
assert.equal(operationsService.image, 'postgres:16.12-bookworm')
assert.deepEqual(operationsService.profiles, ['operations'])
assert.equal(operationsService.user, '1000:1000')
assert.deepEqual(new Set(operationsService.volumes), new Set(['uploads-data:/uploads', 'backups-data:/backups', './deploy:/workspace/deploy:ro']))
assert.equal(operationsService.environment.BACKUP_DATABASE_URL, '${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}')
assert.equal(operationsService.environment.RESTORE_DATABASE_URL, '${RESTORE_DATABASE_URL:-}')
assert.equal(operationsService.environment.RESTORE_ACKNOWLEDGE, '${RESTORE_ACKNOWLEDGE:-}')
assert.deepEqual(operationsService.security_opt, ['no-new-privileges:true'])
assert.deepEqual(operationsService.cap_drop, ['ALL'])
assert.equal(operationsService.read_only, true)
assert.deepEqual(new Set(Object.keys(productionModel.volumes)), new Set(['database-data', 'uploads-data', 'backups-data']))

const resolvedVolume = (project, volume) => `${project}_${volume}`
const localVolumes = new Set(Object.keys(localModel.volumes).map((volume) => resolvedVolume('panshi-ai4s-camp-local', volume)))
const productionVolumes = new Set(Object.keys(productionModel.volumes).map((volume) => resolvedVolume('panshi-ai4s-camp-prod', volume)))
assert.deepEqual([...localVolumes], ['panshi-ai4s-camp-local_database-data'])
assert.ok([...productionVolumes].every((volume) => volume.startsWith('panshi-ai4s-camp-prod_')))
assert.ok([...productionVolumes].every((volume) => !localVolumes.has(volume)), 'local and production named volumes must be isolated')

for (const [name, service] of Object.entries({ postgres, migration, api, frontend, operations: operationsService })) {
  assert.deepEqual(service.security_opt, ['no-new-privileges:true'], `${name} must prohibit privilege escalation`)
}
for (const [name, service] of Object.entries({ migration, api, frontend, operations: operationsService })) {
  assert.deepEqual(service.cap_drop, ['ALL'], `${name} must drop Linux capabilities`)
  assert.equal(service.read_only, true, `${name} root filesystem must be read-only`)
}
assert.deepEqual(frontend.tmpfs, ['/tmp:rw,noexec,nosuid,size=16m'])

const webDockerfile = await readProjectFile('apps/web/Dockerfile')
const adminDockerfile = await readProjectFile('apps/admin/Dockerfile')
const apiDockerfile = await readProjectFile('apps/api/Dockerfile')
for (const [path, dockerfile] of Object.entries({
  'apps/web/Dockerfile': webDockerfile,
  'apps/admin/Dockerfile': adminDockerfile,
  'apps/api/Dockerfile': apiDockerfile,
})) {
  assert.doesNotMatch(dockerfile, /^FROM node:24-alpine\b/mu, `${path} must pin an exact Node and Alpine version`)
  assert.match(dockerfile, /^FROM node:24\.14\.0-alpine3\.23\b/mu, `${path} must use the release-pinned Node base`)
}
assert.match(webDockerfile, /^FROM nginxinc\/nginx-unprivileged:1\.29\.4-alpine3\.23 AS production$/mu)
assert.match(adminDockerfile, /^FROM scratch AS artifact$/mu)
assert.match(adminDockerfile, /COPY --from=admin-build \/app\/apps\/admin\/dist \/admin/u)
assert.doesNotMatch(webDockerfile, /apps\/api|@panshi\/api/u, 'frontend image must not use backend source or builds')
assert.match(webDockerfile, /COPY --from=web-build \/app\/apps\/web\/dist \/usr\/share\/nginx\/html/u)
assert.match(webDockerfile, /COPY --from=admin-build \/app\/apps\/admin\/dist \/usr\/share\/nginx\/html\/admin/u)

const dockerignore = await readProjectFile('.dockerignore')
const ignoredPaths = new Set(dockerignore.split(/\r?\n/u))
for (const path of ['.env', 'node_modules', 'dist', 'var/uploads']) assert.ok(ignoredPaths.has(path))

const nginx = await readProjectFile('deploy/nginx.conf')
validateCriticalNginxConfig(nginx)
assert.match(nginx, /client_max_body_size\s+6m;/u, 'proxy limit must exceed the API 5 MiB file plus multipart overhead')
const fileStorage = await readProjectFile('apps/api/src/modules/files/file-storage.ts')
assert.match(fileStorage, /FILE_UPLOAD_HARD_MAX_BYTES\s*=\s*5\s*\*\s*1_?024\s*\*\s*1_?024/u)
assert.ok(6 * 1024 * 1024 > 5 * 1024 * 1024 + 64 * 1024, 'proxy request limit must cover the hard file limit and multipart overhead')
for (const header of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Content-Security-Policy']) {
  assert.match(nginx, new RegExp(`add_header\\s+${header}\\s+`, 'u'), `Nginx must set ${header}`)
}
assert.doesNotMatch(nginx, /Strict-Transport-Security/iu, 'HSTS belongs at the external TLS terminator')

const packageJson = JSON.parse(await readProjectFile('package.json'))
assert.equal(packageJson.devDependencies.yaml, '2.9.0')
assert.equal(packageJson.scripts['test:deployment'], 'node tests/nginx-config-validator.test.mjs && node tests/deployment.test.mjs')
assert.equal(packageJson.scripts['test:deployment:build'], 'node tests/deployment-build.test.mjs')
assert.match(packageJson.scripts.test, /npm run test:deployment/u)
assert.doesNotMatch(packageJson.scripts.test, /test:deployment:build/u, 'normal tests must not perform clean installs or Docker checks')

const operations = await readProjectFile('docs/operations.md')
for (const variable of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'CORS_ORIGINS', 'BACKUP_ROOT', 'BACKUP_RETENTION_DAYS', 'BACKUP_DATABASE_URL', 'BACKUP_UPLOAD_DIR', 'BACKUP_APP_VERSION', 'RESTORE_DATABASE_URL', 'RESTORE_UPLOAD_DIR']) {
  assert.match(operations, new RegExp(variable, 'u'), `operations guide must document ${variable}`)
}
const productionPrefix = 'docker compose --env-file /secure/path/panshi-ai4s-camp.prod.env -p panshi-ai4s-camp-prod -f compose.yaml -f compose.prod.yaml'
const composeCommands = operations.split(/\r?\n/u).filter((line) => line.startsWith('docker compose '))
assert.ok(composeCommands.length >= 7, 'operations guide must include complete executable commands')
for (const command of composeCommands) {
  assert.ok(
    command === 'docker compose -p panshi-ai4s-camp-local up -d' || command.startsWith(productionPrefix),
    `Compose command must use the explicit local project or full production invocation: ${command}`,
  )
}
assert.match(operations, /external TLS reverse proxy/iu)
assert.match(operations, /Secure/iu)
assert.match(operations, /trust proxy/iu)
assert.match(operations, /HSTS/iu)
assert.match(operations, /5 MiB[^\n]+64 KiB[^\n]+6 MiB/iu)
assert.match(operations, /node apps\/api\/dist\/src\/cli\/create-admin\.js --phone/u)
assert.match(operations, /VERIFICATION_PROVIDER[^\n]+disabled[^\n]+SMS/iu)
assert.match(operations, /test:deployment:build/u)
assert.match(operations, /Docker engine[^\n]+unavailable/iu)
assert.match(operations, /digest/iu)
assert.match(operations, /deploy\/backup\.sh/u)
assert.match(operations, /RESTORE_ACKNOWLEDGE=RESTORE/iu)
assert.match(operations, /deploy\/restore\.sh --yes/u)
assert.match(operations, /SHA-256/iu)
assert.match(operations, /cron|systemd timer/iu)

console.log('deployment static configuration checks passed')
