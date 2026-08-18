import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { learnerCapabilities } from '../packages/contracts/dist/index.js'

const cliPackage = JSON.parse(await readFile(new URL('../apps/cli/package.json', import.meta.url), 'utf8'))
const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const extractReference = (document) => {
  const match = document.match(/<!-- CLI_COMMAND_REFERENCE_START -->([\s\S]*?)<!-- CLI_COMMAND_REFERENCE_END -->/u)
  assert.ok(match, 'CLI command reference markers are required')
  return match[1]
}

const verifyReference = (document, capabilities = learnerCapabilities) => {
  const reference = extractReference(document)
  const documentedIds = [...reference.matchAll(/^\| `([^`]+)` \|/gmu)].map((match) => match[1])
  assert.deepEqual(documentedIds, capabilities.map(({ id }) => id), 'CLI documentation capability order drifted')
  for (const capability of capabilities) {
    const row = reference.split('\n').find((line) => line.startsWith(`| \`${capability.id}\` |`))
    assert.ok(row?.includes(capability.cliCommand), `${capability.id} command drifted from the registry`)
  }
}

test('CLI command reference matches the capability registry', async () => {
  verifyReference(await readFile(new URL('../docs/cli.md', import.meta.url), 'utf8'))
})

test('CLI documentation gate catches a missing registered capability', async () => {
  const document = await readFile(new URL('../docs/cli.md', import.meta.url), 'utf8')
  const damaged = document.replace(/^\| `check_in\.qr\.export` .*\n/mu, '')
  assert.throws(() => verifyReference(damaged), /capability order drifted/u)
})

test('active docs and executable scripts do not use the retired CLI workspace name', async () => {
  const scriptDirectory = new URL('../scripts/', import.meta.url)
  // docs/superpowers/{plans,specs} are non-executable historical records and are intentionally out of scope.
  const activeFiles = [
    new URL('../docs/cli.md', import.meta.url),
    new URL('../docs/cli-release-checklist.md', import.meta.url),
    new URL('../package.json', import.meta.url),
    ...(await readdir(scriptDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
      .map((entry) => new URL(entry.name, scriptDirectory)),
  ]

  for (const file of activeFiles) {
    const contents = await readFile(file, 'utf8')
    assert.doesNotMatch(contents, /(?:^|\s)-w(?:orkspace)?(?:=|\s+)@panshi\/cli(?:\s|$)/u, `${file.pathname} uses the retired CLI workspace name`)
  }
})

test('CLI workspace commands match the package name in docs and root scripts', async () => {
  const cliDocument = await readFile(new URL('../docs/cli.md', import.meta.url), 'utf8')
  const expectedSelector = `-w ${cliPackage.name}`

  assert.ok(cliDocument.includes(`npm run build ${expectedSelector}\n`), 'docs/cli.md CLI workspace selector drifted from package name')
  for (const scriptName of ['check:parity', 'test:parity']) {
    assert.ok(rootPackage.scripts[scriptName].includes(`npm run build ${expectedSelector}`), `${scriptName} CLI workspace selector drifted from package name`)
  }
})
