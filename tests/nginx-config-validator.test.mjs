import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateCriticalNginxConfig } from './helpers/nginx-config-validator.mjs'

const nginx = await readFile(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')

const insertDirective = (source, selector, directive) => {
  const locationStart = `location ${selector} {`
  assert.ok(source.includes(locationStart), `fixture requires location ${selector}`)
  return source.replace(locationStart, `${locationStart}\n      ${directive}`)
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

console.log(`nginx validator mutation checks passed (${mutations.length} rejected mutations)`)
