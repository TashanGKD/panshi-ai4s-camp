import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { learnerCapabilities } from '../packages/contracts/dist/index.js'

const cliPackage = JSON.parse(await readFile(new URL('../apps/cli/package.json', import.meta.url), 'utf8'))
const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const installCommand = 'npx --yes skills@latest add TashanGKD/panshi-ai4s-camp --global --agent codex claude-code --skill panshi-camp --yes'
const productionFlags = '--profile panshi --environment production'
const releaseDocuments = [
  ['README.md', new URL('../README.md', import.meta.url)],
  ['docs/cli.md', new URL('../docs/cli.md', import.meta.url)],
  ['SKILL.md', new URL('../skills/panshi-camp/SKILL.md', import.meta.url)],
  ['register example', new URL('../skills/panshi-camp/examples/register-and-apply.md', import.meta.url)],
  ['status example', new URL('../skills/panshi-camp/examples/check-status-and-check-in.md', import.meta.url)],
]

const verifyDocumentVersion = (contents, version, name) => {
  const declarations = [...contents.matchAll(/所需 CLI 版本：`([^`]+)`/gu)].map((match) => match[1])
  assert.deepEqual(declarations, [version], `${name} required CLI version drifted from package.version`)
}

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

test('public CLI release docs derive their version, install, and production contracts from the package', async () => {
  for (const [name, url] of releaseDocuments) {
    const contents = await readFile(url, 'utf8')
    verifyDocumentVersion(contents, cliPackage.version, name)
    assert.ok(contents.includes(installCommand), `${name} must use the canonical public Skill install command`)
    assert.ok(contents.includes(productionFlags), `${name} must require the canonical production profile and environment`)
  }

  for (const url of [new URL('../README.md', import.meta.url), new URL('../docs/cli.md', import.meta.url)]) {
    const contents = await readFile(url, 'utf8')
    assert.match(contents, /Node(?:\.js)? 24/u)
    assert.match(contents, /npm 11/u)
    assert.match(contents, /无需克隆源码/u)
    assert.match(contents, /无需 sudo/u)
    assert.match(contents, /预览[\s\S]{0,120}明确同意/u)
    assert.match(contents, /CLI 包内[\s\S]{0,160}不携带[\s\S]{0,80}信任根/u)
    assert.match(contents, /GitHub Skill/u)
  }
})

test('CLI documentation version gate catches a wrong version in every release document', async () => {
  const expected = `所需 CLI 版本：\`${cliPackage.version}\``
  for (const [name, url] of releaseDocuments) {
    const contents = await readFile(url, 'utf8')
    assert.ok(contents.includes(expected), `${name} must start as a valid mutation fixture`)
    const damaged = contents.replace(expected, '所需 CLI 版本：`9.9.9`')
    assert.throws(() => verifyDocumentVersion(damaged, cliPackage.version, name), /required CLI version drifted/u)
  }
})
