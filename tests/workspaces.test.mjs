import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
assert.deepEqual(root.workspaces, ['apps/*', 'packages/*'])

const workspaces = [
  ['apps/web', '@panshi/web'],
  ['apps/admin', '@panshi/admin'],
  ['apps/api', '@panshi/api'],
  ['packages/contracts', '@panshi/contracts'],
  ['packages/ui', '@panshi/ui'],
]

const packages = new Map()
for (const [path, expectedName] of workspaces) {
  const pkg = JSON.parse(await readFile(new URL(`../${path}/package.json`, import.meta.url)))
  assert.equal(pkg.name, expectedName)
  assert.equal(pkg.private, true)
  for (const script of ['build', 'test', 'typecheck']) {
    assert.equal(typeof pkg.scripts?.[script], 'string')
  }
  packages.set(expectedName, pkg)
}

for (const name of ['@panshi/web', '@panshi/admin']) {
  assert.equal(packages.get(name).dependencies['@panshi/contracts'], '0.0.0')
  assert.equal(packages.get(name).dependencies['@panshi/ui'], '0.0.0')
}
assert.equal(packages.get('@panshi/api').dependencies['@panshi/contracts'], '0.0.0')
for (const name of ['react', 'react-dom']) {
  const peerVersion = packages.get('@panshi/ui').peerDependencies?.[name]
  assert.equal(typeof peerVersion, 'string')
  assert.equal(typeof packages.get('@panshi/ui').devDependencies[name], 'string')
  assert.equal(packages.get('@panshi/ui').dependencies[name], undefined)
}
assert.equal(root.engines?.node, '>=24 <25')
assert.equal(root.scripts.test, 'node tests/workspaces.test.mjs && npm run test:workspaces')
assert.equal(root.scripts['test:workspaces'], 'npm run test --workspaces')
for (const script of ['build', 'test', 'typecheck']) {
  assert.equal(root.scripts[script].includes('--if-present'), false)
}
console.log('workspace structure ok')
