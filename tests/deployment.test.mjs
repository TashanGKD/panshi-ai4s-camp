import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const requiredFiles = [
  '.dockerignore',
  'apps/web/Dockerfile',
  'apps/admin/Dockerfile',
  'apps/api/Dockerfile',
  'deploy/nginx.conf',
  'compose.prod.yaml',
  'docs/operations.md',
]

const contents = Object.fromEntries(await Promise.all(requiredFiles.map(async (path) => {
  try {
    return [path, await readProjectFile(path)]
  } catch (error) {
    assert.fail(`missing deployment file ${path}: ${error.message}`)
  }
})))

const dockerignore = contents['.dockerignore']
const ignoredPaths = new Set(dockerignore.split(/\r?\n/u))
for (const privateOrGeneratedPath of ['.env', 'node_modules', 'dist', 'var/uploads']) {
  assert.ok(ignoredPaths.has(privateOrGeneratedPath), `.dockerignore must exclude ${privateOrGeneratedPath}`)
}

const nginx = contents['deploy/nginx.conf']
assert.match(nginx, /location\s+\^?~?\s*\/api\/\s*\{[^}]*proxy_pass\s+http:\/\/api:3001\s*;/s, '/api/ must proxy to the API service without stripping its prefix')
assert.match(nginx, /location\s*=\s*\/admin\s*\{[^}]*\/admin\//s, '/admin must redirect to the canonical trailing-slash URL')
assert.match(nginx, /location\s+\^~\s+\/admin\/\s*\{[^}]*try_files\s+\$uri\s+\$uri\/\s+\/admin\/index\.html\s*;/s, '/admin/ must serve admin assets with an admin SPA fallback')
assert.match(nginx, /location\s+\/\s*\{[^}]*try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/s, 'all remaining paths must use the public web SPA fallback')
assert.match(nginx, /location\s+=\s+\/uploads\s*\{[^}]*return\s+404\s*;/s, 'the exact /uploads path must be denied')
assert.match(nginx, /location\s+\^~\s+\/uploads\/\s*\{[^}]*return\s+404\s*;/s, '/uploads descendants must be denied before SPA routing')
assert.doesNotMatch(nginx, /(?:alias|root)\s+[^;]*uploads/iu, 'Nginx must never map the private uploads directory')

for (const app of ['web', 'admin', 'api']) {
  const dockerfile = contents[`apps/${app}/Dockerfile`]
  assert.match(dockerfile, new RegExp(`npm run build -w @panshi/${app}`), `${app} image must run its own workspace build`)
}
assert.match(contents['apps/admin/Dockerfile'], /--base=\/admin\//, 'admin assets must be built for the /admin/ base')
assert.match(await readProjectFile('apps/admin/vite.config.ts'), /base:\s*['"]\/admin\/['"]/, 'ordinary admin builds must retain the /admin/ base')
assert.doesNotMatch(contents['apps/web/Dockerfile'], /apps\/api|@panshi\/api/, 'the frontend image must not use backend source or builds')
assert.match(contents['apps/web/Dockerfile'], /COPY\s+--from=web-build\s+\/app\/apps\/web\/dist\s+\/usr\/share\/nginx\/html/, 'Nginx must receive the web artifact')
assert.match(contents['apps/web/Dockerfile'], /COPY\s+--from=admin-build\s+\/app\/apps\/admin\/dist\s+\/usr\/share\/nginx\/html\/admin/, 'Nginx must receive the admin artifact')

const localCompose = await readProjectFile('compose.yaml')
const productionCompose = contents['compose.prod.yaml']
const serviceBlock = (name) => {
  const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|^volumes:|(?![\\s\\S]))`, 'm').exec(productionCompose)
  assert.ok(match, `production Compose must define ${name}`)
  return match[0]
}
assert.match(localCompose, /image:\s*postgres:16(?:\s|$)/, 'local Compose must keep PostgreSQL 16 available')
const postgresService = serviceBlock('postgres')
const migrationService = serviceBlock('migration')
const apiService = serviceBlock('api')
const frontendService = serviceBlock('frontend')
for (const volume of ['database-data', 'uploads-data', 'backups-data']) {
  assert.match(productionCompose, new RegExp(`^  ${volume}:`, 'm'), `production Compose must define the ${volume} named volume`)
}
assert.match(migrationService, /postgres:[\s\S]*?condition:\s*service_healthy/, 'migration must wait for a healthy database')
assert.match(apiService, /migration:[\s\S]*?condition:\s*service_completed_successfully/, 'API must wait for successful migration completion')
assert.match(frontendService, /api:[\s\S]*?condition:\s*service_healthy/, 'frontend must wait for a healthy API')
assert.doesNotMatch(migrationService, /(?:\|\|\s*true|exit\s+0)/, 'migration failures must not be ignored')
assert.match(postgresService, /healthcheck:/, 'database healthcheck must exist')
assert.match(apiService, /healthcheck:/, 'API healthcheck must exist')
assert.match(frontendService, /healthcheck:/, 'frontend healthcheck must exist')
assert.match(apiService, /uploads-data:\/app\/var\/uploads/, 'uploads volume must be mounted only for API-managed storage')
assert.doesNotMatch(frontendService, /uploads-data:/, 'frontend must not mount private uploads')
assert.match(productionCompose, /\$\{POSTGRES_PASSWORD:\?[^}]+\}/, 'production database password must be required from the environment')
assert.match(productionCompose, /\$\{DATABASE_URL:\?[^}]+\}/, 'production database URL must be required from the environment')

const operations = contents['docs/operations.md']
for (const term of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'CORS_ORIGINS']) {
  assert.match(operations, new RegExp(term), `operations guide must document ${term}`)
}
assert.match(operations, /database[\s\S]*migration[\s\S]*API[\s\S]*frontend/i, 'operations guide must document startup order')

console.log('deployment configuration checks passed')
