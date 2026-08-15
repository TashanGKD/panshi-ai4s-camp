import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateCriticalNginxConfig } from './helpers/nginx-config-validator.mjs'

const nginx = await readFile(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')

const insertDirective = (source, selector, directive) => {
  const locationStart = `location ${selector} {`
  assert.ok(source.includes(locationStart), `fixture requires location ${selector}`)
  return source.replace(locationStart, `${locationStart}\n      ${directive}`)
}

const insertLocation = (source, selector) => {
  const rootLocation = '    location / {'
  assert.ok(source.includes(rootLocation), 'fixture requires the public root location')
  return source.replace(rootLocation, `    location ${selector} {\n      return 418;\n    }\n\n${rootLocation}`)
}

const insertServerDirective = (source, directive) => {
  const serverStart = '  server {'
  assert.ok(source.includes(serverStart), 'fixture requires the production server block')
  return source.replace(serverStart, `${serverStart}\n    ${directive}`)
}

validateCriticalNginxConfig(nginx)

const mutations = [
  ['/api/ rejects return', '/api/', 'return 404;'],
  ['/api/ rejects rewrite', '/api/', 'rewrite ^ /maintenance.html last;'],
  ['/admin/ rejects return', '^~ /admin/', 'return 404;'],
  ['/admin/ rejects error_page', '^~ /admin/', 'error_page 404 /index.html;'],
  ['/admin redirect rejects contradictory return', '= /admin', 'return 404;'],
  ['web root rejects return', '/', 'return 404;'],
  ['web root rejects internal', '/', 'internal;'],
  ['exact uploads rejects SPA bypass', '= /uploads', 'try_files $uri /index.html;'],
  ['uploads prefix rejects proxy bypass', '^~ /uploads/', 'proxy_pass http://api:3001;'],
  ['exact uploads rejects contradictory return', '= /uploads', 'return 200;'],
]

for (const [name, selector, directive] of mutations) {
  assert.throws(
    () => validateCriticalNginxConfig(insertDirective(nginx, selector, directive)),
    { name: 'AssertionError' },
    name,
  )
}

const selectorMutations = [
  ['regex API override', '~ ^/api/'],
  ['exact admin child override', '= /admin/deep/link'],
  ['specific public web prefix override', '/schedule/'],
  ['exact uploads child override', '= /uploads/private.pdf'],
]

for (const [name, selector] of selectorMutations) {
  assert.throws(
    () => validateCriticalNginxConfig(insertLocation(nginx, selector)),
    { name: 'AssertionError' },
    name,
  )
}

const serverDirectiveMutations = [
  ['server-level return', 'return 404;'],
  ['server-level rewrite', 'rewrite ^ /maintenance.html last;'],
  ['server-level error_page', 'error_page 404 /index.html;'],
]

for (const [name, directive] of serverDirectiveMutations) {
  assert.throws(
    () => validateCriticalNginxConfig(insertServerDirective(nginx, directive)),
    { name: 'AssertionError' },
    name,
  )
}

const mutationCount = mutations.length + selectorMutations.length + serverDirectiveMutations.length
console.log(`nginx validator mutation checks passed (${mutationCount} rejected mutations)`)
