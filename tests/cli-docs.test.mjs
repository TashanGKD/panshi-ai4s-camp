import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { learnerCapabilities } from '../packages/contracts/dist/index.js'

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
