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
const { postgres, migration, api, frontend, 'operations-volume-init': operationsVolumeInit, backup, restore } = productionModel.services

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
assert.deepEqual(new Set(api.volumes), new Set(['uploads-data:/data', 'backups-data:/backups:ro']))
assert.ok(api.healthcheck?.test, 'effective production API needs a healthcheck')
assert.equal(api.environment.DATABASE_URL, '${DATABASE_URL:?set DATABASE_URL}')
assert.equal(api.environment.CORS_ORIGINS, '${CORS_ORIGINS:?set CORS_ORIGINS}')
for (const key of ['TRUST_PROXY_HOPS', 'RATE_LIMIT_STORE_MAX_BUCKETS', 'RATE_LIMIT_STORE_SWEEP_INTERVAL_MS', 'RATE_LIMIT_LOGIN_FAILURE_MAX', 'RATE_LIMIT_LOGIN_FAILURE_WINDOW_MS', 'RATE_LIMIT_AUTH_MAX', 'RATE_LIMIT_AUTH_WINDOW_MS', 'RATE_LIMIT_PUBLIC_MAX', 'RATE_LIMIT_PUBLIC_WINDOW_MS', 'RATE_LIMIT_AUTHENTICATED_MAX', 'RATE_LIMIT_AUTHENTICATED_WINDOW_MS', 'RATE_LIMIT_ADMIN_MAX', 'RATE_LIMIT_ADMIN_WINDOW_MS']) {
  assert.equal(api.environment[key], `\${${key}:?set ${key}}`, `production API must receive ${key}`)
}
assert.equal(api.environment.FILE_STORAGE_ROOT, '/data/uploads')
assert.equal(api.environment.FILE_UPLOAD_TEMP_ROOT, '/data/uploads/.incoming')
assert.equal(api.environment.BACKUP_ROOT, '/backups')
assert.equal(api.environment.APP_VERSION, '${BACKUP_APP_VERSION:?set BACKUP_APP_VERSION}')
assert.equal(api.environment.VERIFICATION_PROVIDER, '${VERIFICATION_PROVIDER:?set VERIFICATION_PROVIDER}')
assert.equal(api.environment.VERIFICATION_SECRET, '${VERIFICATION_SECRET:?set VERIFICATION_SECRET}')
assert.equal(api.environment.CHECK_IN_TOKEN_SECRET, '${CHECK_IN_TOKEN_SECRET:?set CHECK_IN_TOKEN_SECRET}')
for (const key of ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIYUN_SMS_SIGN_NAME', 'ALIYUN_SMS_TEMPLATE_CODE']) {
  assert.ok(key in api.environment, `production API must receive ${key}`)
}
assert.equal(api.user, '${OPERATIONS_UID:?set OPERATIONS_UID}:${OPERATIONS_GID:?set OPERATIONS_GID}')
assert.equal(api.depends_on['operations-volume-init'].condition, 'service_completed_successfully')
assert.ok(!('command' in api), 'API must retain its production image entrypoint')
assert.equal(frontend.image, 'panshi-ai4s-camp-frontend:${IMAGE_TAG:-local}')
assert.equal(frontend.build.dockerfile, 'apps/web/Dockerfile')
assert.equal(frontend.build.target, 'production')
assert.deepEqual(frontend.ports, ['${HTTP_BIND_ADDRESS:-127.0.0.1}:${HTTP_PORT:-8080}:8080'])
assert.ok(frontend.healthcheck?.test, 'effective production frontend needs a healthcheck')
assert.ok(!('command' in frontend), 'frontend must retain its unprivileged Nginx entrypoint')
assert.ok(!frontend.volumes?.some((volume) => String(volume).startsWith('uploads-data:')), 'frontend must not mount private uploads')
assert.equal(operationsVolumeInit.image, 'panshi-ai4s-camp-operations:${IMAGE_TAG:-local}')
assert.equal(operationsVolumeInit.user, '0:0')
assert.deepEqual(operationsVolumeInit.command, ['deploy/init-operation-volumes.sh'])
assert.deepEqual(new Set(operationsVolumeInit.volumes), new Set(['uploads-data:/data', 'backups-data:/backups', './deploy:/workspace/deploy:ro']))
assert.deepEqual(new Set(operationsVolumeInit.cap_add), new Set(['CHOWN', 'DAC_OVERRIDE', 'FOWNER']))
assert.equal(backup.image, 'panshi-ai4s-camp-operations:${IMAGE_TAG:-local}')
assert.equal(backup.build.dockerfile, 'deploy/Dockerfile.operations')
assert.deepEqual(backup.profiles, ['backup'])
assert.equal(backup.user, '${OPERATIONS_UID:?set OPERATIONS_UID}:${OPERATIONS_GID:?set OPERATIONS_GID}')
assert.deepEqual(new Set(backup.volumes), new Set(['uploads-data:/data:ro', 'backups-data:/backups', './deploy:/workspace/deploy:ro', '${BACKUP_PGPASSFILE_HOST:?set BACKUP_PGPASSFILE_HOST}:/run/secrets/backup.pgpass:ro']))
assert.equal(backup.environment.BACKUP_UPLOAD_DIR, '/data/uploads')
assert.equal(backup.environment.BACKUP_PGPASSFILE, '/run/secrets/backup.pgpass')
assert.equal(backup.depends_on['operations-volume-init'].condition, 'service_completed_successfully')
assert.equal(backup.environment.MAINTENANCE_API_HEALTH_URL, '${MAINTENANCE_API_HEALTH_URL:?set MAINTENANCE_API_HEALTH_URL}')
assert.equal(backup.environment.MAINTENANCE_ACK, '${MAINTENANCE_ACK:-}')
for (const key of ['UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES', 'UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES', 'UPLOAD_ARCHIVE_MAX_ENTRIES', 'UPLOAD_ARCHIVE_MAX_PATH_DEPTH']) {
  assert.equal(backup.environment[key], `\${${key}:?set ${key}}`)
}
assert.ok(!Object.keys(backup.environment).some((key) => key.startsWith('RESTORE_')), 'backup service must not receive restore settings')
assert.equal(restore.image, backup.image)
assert.equal(restore.build.dockerfile, 'deploy/Dockerfile.operations')
assert.deepEqual(restore.profiles, ['restore'])
assert.equal(restore.user, '${OPERATIONS_UID:?set OPERATIONS_UID}:${OPERATIONS_GID:?set OPERATIONS_GID}')
assert.deepEqual(new Set(restore.volumes), new Set(['uploads-data:/data', 'backups-data:/backups', './deploy:/workspace/deploy:ro', '${RESTORE_PGPASSFILE_HOST:?set RESTORE_PGPASSFILE_HOST}:/run/secrets/restore.pgpass:ro']))
assert.equal(restore.environment.RESTORE_UPLOAD_DIR, '/data/uploads')
assert.equal(restore.environment.RESTORE_PGPASSFILE, '/run/secrets/restore.pgpass')
assert.equal(restore.environment.RESTORE_MIN_FREE_BYTES, '${RESTORE_MIN_FREE_BYTES:?set RESTORE_MIN_FREE_BYTES}')
assert.equal(restore.environment.MAINTENANCE_API_HEALTH_URL, '${MAINTENANCE_API_HEALTH_URL:?set MAINTENANCE_API_HEALTH_URL}')
assert.equal(restore.environment.MAINTENANCE_ACK, '${MAINTENANCE_ACK:-}')
assert.ok(!Object.keys(restore.environment).some((key) => key.startsWith('BACKUP_PG')), 'restore service must not receive backup database settings')
assert.deepEqual(new Set(Object.keys(productionModel.volumes)), new Set(['database-data', 'uploads-data', 'backups-data']))

const resolvedVolume = (project, volume) => `${project}_${volume}`
const localVolumes = new Set(Object.keys(localModel.volumes).map((volume) => resolvedVolume('panshi-ai4s-camp-local', volume)))
const productionVolumes = new Set(Object.keys(productionModel.volumes).map((volume) => resolvedVolume('panshi-ai4s-camp-prod', volume)))
assert.deepEqual([...localVolumes], ['panshi-ai4s-camp-local_database-data'])
assert.ok([...productionVolumes].every((volume) => volume.startsWith('panshi-ai4s-camp-prod_')))
assert.ok([...productionVolumes].every((volume) => !localVolumes.has(volume)), 'local and production named volumes must be isolated')

for (const [name, service] of Object.entries({ postgres, migration, api, frontend, operationsVolumeInit, backup, restore })) {
  assert.deepEqual(service.security_opt, ['no-new-privileges:true'], `${name} must prohibit privilege escalation`)
}
for (const [name, service] of Object.entries({ migration, api, frontend, operationsVolumeInit, backup, restore })) {
  assert.deepEqual(service.cap_drop, ['ALL'], `${name} must drop Linux capabilities`)
  assert.equal(service.read_only, true, `${name} root filesystem must be read-only`)
}
assert.deepEqual(frontend.tmpfs, ['/tmp:rw,noexec,nosuid,size=16m'])

const volumeInit = await readProjectFile('deploy/init-operation-volumes.sh')
const publicTunnel = await readProjectFile('deploy/start-public-tunnel.sh')
const publicNginx = await readProjectFile('deploy/ecs-nginx.conf')
assert.match(volumeInit, /OPERATIONS_UID/u)
assert.match(volumeInit, /OPERATIONS_GID/u)
assert.match(volumeInit, /chown[^\n]+\/data[^\n]+\/backups/u)
assert.doesNotMatch(volumeInit, /mkdir[^\n]+\/data\/uploads/u, 'the API must create and mark the private upload root itself')
assert.match(volumeInit, /Refusing to remove a non-empty unmarked upload root/u)
assert.match(volumeInit, /rmdir \/data\/uploads/u)
assert.doesNotMatch(volumeInit, /chown[^\n]+(?:^|\s)\/(?:\s|$)/u, 'volume init must never chown the filesystem root')
assert.match(publicTunnel, /-R "127\.0\.0\.1:\$\{ECS_PORT\}:127\.0\.0\.1:\$\{LOCAL_PORT\}"/u)
assert.match(publicTunnel, /StrictHostKeyChecking=yes/u)
assert.match(publicTunnel, /ExitOnForwardFailure=yes/u)
assert.doesNotMatch(publicTunnel, /StrictHostKeyChecking=no/u)
assert.match(publicNginx, /server_name panshi-ai4s\.tashan\.chat;/u)
assert.match(publicNginx, /proxy_pass http:\/\/127\.0\.0\.1:13200;/u)
assert.match(publicNginx, /Strict-Transport-Security/u)
assert.match(publicNginx, /client_max_body_size 6m;/u)

const webDockerfile = await readProjectFile('apps/web/Dockerfile')
const adminDockerfile = await readProjectFile('apps/admin/Dockerfile')
const apiDockerfile = await readProjectFile('apps/api/Dockerfile')
const operationsDockerfile = await readProjectFile('deploy/Dockerfile.operations')
const operationsCommon = await readProjectFile('deploy/operations-common.sh')
const webPackageJson = JSON.parse(await readProjectFile('apps/web/package.json'))
const adminPackageJson = JSON.parse(await readProjectFile('apps/admin/package.json'))
const frontendWorkspaceViolations = (dockerfile, manifest) => Object.keys(manifest.dependencies ?? {})
  .filter((name) => name.startsWith('@panshi/'))
  .flatMap((name) => {
    const directory = name.slice('@panshi/'.length)
    const violations = []
    if (!dockerfile.includes(`COPY packages/${directory} ./packages/${directory}`)) {
      violations.push(`${manifest.name} dependency ${name} is not copied into the image dependency stage`)
    }
    if (!dockerfile.includes(`--workspace ${name}`)) {
      violations.push(`${manifest.name} dependency ${name} is not installed in the image dependency stage`)
    }
    return violations
  })
const frontendViolations = [
  ...frontendWorkspaceViolations(webDockerfile, webPackageJson),
  ...frontendWorkspaceViolations(webDockerfile, adminPackageJson),
]
assert.deepEqual(frontendViolations, [], `frontend workspace dependency drift:\n${frontendViolations.join('\n')}`)
const frontendGateCanary = frontendWorkspaceViolations(
  webDockerfile.replace('COPY packages/contracts ./packages/contracts', ''),
  webPackageJson,
)
assert.ok(
  frontendGateCanary.some((violation) => violation.includes('@panshi/contracts') && violation.includes('not copied')),
  'frontend workspace dependency gate must reject a missing package copy',
)
for (const [path, dockerfile] of Object.entries({
  'apps/web/Dockerfile': webDockerfile,
  'apps/admin/Dockerfile': adminDockerfile,
  'apps/api/Dockerfile': apiDockerfile,
})) {
  assert.doesNotMatch(dockerfile, /^FROM node:24-alpine\b/mu, `${path} must pin an exact Node and Alpine version`)
  assert.match(dockerfile, /^FROM node:24\.14\.0-alpine3\.23\b/mu, `${path} must use the release-pinned Node base`)
}
assert.match(operationsDockerfile, /^FROM postgres:16\.12-alpine3\.23$/mu)
assert.match(apiDockerfile, /cp -R apps\/api\/src\/data\/\. apps\/api\/dist\/src\/data\//u)
for (const tool of ['bash', 'coreutils', 'curl', 'findutils', 'python3', 'tar', 'util-linux']) assert.match(operationsDockerfile, new RegExp(`\\b${tool}\\b`, 'u'))
assert.match(operationsCommon, /command -v flock[^\n]+flock is required/u)
assert.match(operationsCommon, /flock -n 9/u)
assert.doesNotMatch(operationsCommon, /OPERATIONS_FORCE_PORTABLE_LOCK|panshi-operations\.lock\.d/u)
assert.match(operationsCommon, /6\|7\) ;;/u)
assert.doesNotMatch(operationsCommon, /6\|7\|28/u)
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
for (const variable of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'CORS_ORIGINS', 'TRUST_PROXY_HOPS', 'RATE_LIMIT_STORE_MAX_BUCKETS', 'RATE_LIMIT_STORE_SWEEP_INTERVAL_MS', 'RATE_LIMIT_LOGIN_FAILURE_MAX', 'RATE_LIMIT_LOGIN_FAILURE_WINDOW_MS', 'RATE_LIMIT_AUTH_MAX', 'RATE_LIMIT_AUTH_WINDOW_MS', 'RATE_LIMIT_PUBLIC_MAX', 'RATE_LIMIT_PUBLIC_WINDOW_MS', 'RATE_LIMIT_AUTHENTICATED_MAX', 'RATE_LIMIT_AUTHENTICATED_WINDOW_MS', 'RATE_LIMIT_ADMIN_MAX', 'RATE_LIMIT_ADMIN_WINDOW_MS', 'OPERATIONS_UID', 'OPERATIONS_GID', 'MAINTENANCE_API_HEALTH_URL', 'MAINTENANCE_ACK', 'UPLOAD_ARCHIVE_MAX_COMPRESSED_BYTES', 'UPLOAD_ARCHIVE_MAX_EXPANDED_BYTES', 'UPLOAD_ARCHIVE_MAX_ENTRIES', 'UPLOAD_ARCHIVE_MAX_PATH_DEPTH', 'RESTORE_MIN_FREE_BYTES', 'BACKUP_ROOT', 'BACKUP_RETENTION_DAYS', 'BACKUP_PGHOST', 'BACKUP_PGDATABASE', 'BACKUP_PGUSER', 'BACKUP_PGPASSFILE', 'BACKUP_UPLOAD_DIR', 'BACKUP_APP_VERSION', 'RESTORE_PGHOST', 'RESTORE_PGDATABASE', 'RESTORE_PGUSER', 'RESTORE_PGPASSFILE', 'RESTORE_UPLOAD_DIR']) {
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
assert.match(operations, /TRUST_PROXY_HOPS=2/u)
assert.match(operations, /127\.0\.0\.1[\s\S]+trusted TLS proxy/iu)
assert.match(operations, /429[\s\S]+Cache-Control: no-store[\s\S]+Retry-After/iu)
assert.match(operations, /Secure/iu)
assert.match(operations, /TRUST_PROXY_HOPS/u)
assert.match(operations, /HSTS/iu)
assert.match(operations, /5 MiB[^\n]+64 KiB[^\n]+6 MiB/iu)
assert.match(operations, /node apps\/api\/dist\/src\/cli\/create-admin\.js --phone/u)
assert.match(operations, /VERIFICATION_PROVIDER=aliyun/iu)
assert.match(operations, /ALIBABA_CLOUD_ACCESS_KEY_ID/iu)
assert.match(operations, /uses its own PostgreSQL users/iu)
assert.match(operations, /test:deployment:build/u)
assert.match(operations, /Docker engine[^\n]+unavailable/iu)
assert.match(operations, /digest/iu)
assert.match(operations, /deploy\/backup\.sh/u)
assert.match(operations, /MAINTENANCE_ACK="BACKUP:\$\{BACKUP_PGDATABASE\}"/u)
assert.match(operations, /MAINTENANCE_ACK="RESTORE:\$\{BACKUP_ID\}:\$\{RESTORE_PGDATABASE\}"/u)
assert.match(operations, /id -u/u)
assert.match(operations, /id -g/u)
assert.match(operations, /trusted[\s\S]+0700/iu)
assert.match(operations, /authenticated checksum|signature/iu)
assert.match(operations, /deploy\/restore\.sh --yes/u)
assert.match(operations, /SHA-256/iu)
assert.match(operations, /cron|systemd timer/iu)

console.log('deployment static configuration checks passed')
