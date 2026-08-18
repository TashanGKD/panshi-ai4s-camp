import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
assert.deepEqual(root.workspaces, ['apps/*', 'packages/*'])
for (const name of ['web', 'admin', 'api']) {
  const pkg = JSON.parse(await readFile(new URL(`../apps/${name}/package.json`, import.meta.url)))
  assert.equal(pkg.private, true)
}
const campClient = JSON.parse(await readFile(new URL('../packages/camp-client/package.json', import.meta.url)))
assert.equal(campClient.name, '@panshi/camp-client')
assert.equal(campClient.private, true)
console.log('workspace structure ok')
