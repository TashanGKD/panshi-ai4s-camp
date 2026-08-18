import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { buildCliRelease, resolveNpmInvocation } from '../scripts/build-cli-release.mjs'
import * as releaseGate from '../scripts/check-cli-release.mjs'
import { assertSafeArchivePath } from '../scripts/cli-release-lib.mjs'

const execFileAsync = promisify(execFile)
const { checkCliRelease } = releaseGate
const repoRoot = resolve(import.meta.dirname, '..')

test('release builder invokes npm through ComSpec on Windows', () => {
  assert.deepEqual(resolveNpmInvocation({ platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } }), {
    command: 'C:\\Windows\\System32\\cmd.exe',
    prefix: ['/d', '/s', '/c', 'npm.cmd'],
  })
  assert.deepEqual(resolveNpmInvocation({ platform: 'win32', env: {} }), {
    command: 'cmd.exe',
    prefix: ['/d', '/s', '/c', 'npm.cmd'],
  })
  assert.deepEqual(resolveNpmInvocation({ platform: 'linux', env: {} }), {
    command: 'npm',
    prefix: [],
  })
})
const skillManifestPath = join(repoRoot, 'skills/panshi-camp/release-manifest.json')

test('default release build is local-only and does not modify the tracked Skill manifest', async () => {
  const before = await readFile(skillManifestPath, 'utf8')
  const result = await buildCliRelease({ repoRoot })
  assert.equal(await readFile(skillManifestPath, 'utf8'), before)
  assert.equal(result.manifest.version, '0.1.2')
  assert.equal(result.manifest.assetName, 'panshi-camp-cli-0.1.2.tgz')
  assert.equal((await stat(result.archivePath)).size, result.manifest.sizeBytes)
  await checkCliRelease({ repoRoot })
  await assert.rejects(checkCliRelease({ repoRoot, expectedTag: 'cli-v0.1.3' }), /CLI_RELEASE_TAG_DRIFT/u)
})

test('release path gate rejects traversal, absolute paths, and Windows drive paths', () => {
  for (const candidate of ['package/../escape', '/absolute/escape', 'C:\\escape']) {
    assert.throws(() => assertSafeArchivePath(candidate), /CLI_RELEASE_PATH_UNSAFE/u)
  }
})

test('exported release version validator rejects only package-manifest version drift', () => {
  assert.equal(typeof releaseGate.validateReleaseVersion, 'function')
  assert.equal(releaseGate.validateReleaseVersion({
    packageVersion: '0.1.0',
    manifest: { version: '0.1.0', assetName: 'panshi-camp-cli-0.1.0.tgz' },
  }), 'panshi-camp-cli-0.1.0.tgz')
  assert.throws(() => releaseGate.validateReleaseVersion({
    packageVersion: '0.1.0',
    manifest: {
      version: '0.1.1',
      assetName: 'panshi-camp-cli-0.1.1.tgz',
    },
  }), /CLI_RELEASE_VERSION_DRIFT/u)
})

test('updating the Skill manifest cannot change the reproducible tarball digests', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-release-repro-'))
  try {
    const temporarySkillManifest = join(temporaryRoot, 'skill/release-manifest.json')
    const first = await buildCliRelease({ repoRoot, outputDirectory: join(temporaryRoot, 'first') })
    const updated = await buildCliRelease({ repoRoot, outputDirectory: join(temporaryRoot, 'updated'), updateSkillManifest: true, skillManifestPath: temporarySkillManifest })
    const rebuilt = await buildCliRelease({ repoRoot, outputDirectory: join(temporaryRoot, 'rebuilt') })
    assert.equal(updated.manifest.sha256, first.manifest.sha256)
    assert.equal(updated.manifest.packageTreeSha256, first.manifest.packageTreeSha256)
    assert.equal(rebuilt.manifest.sha256, first.manifest.sha256)
    assert.equal(rebuilt.manifest.packageTreeSha256, first.manifest.packageTreeSha256)
    assert.deepEqual(JSON.parse(await readFile(temporarySkillManifest, 'utf8')), updated.manifest)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('release builder rejects broad deletion targets before building', async () => {
  await assert.rejects(buildCliRelease({ repoRoot, outputDirectory: repoRoot }), /CLI_RELEASE_OUTPUT_UNSAFE/u)
})

test('release gate self-test constructs and catches all required bad artifacts', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/check-cli-release.self-test.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  assert.equal(stderr, '')
  for (const label of ['version drift', 'version check mutation guard', 'internal dependency leak', 'dangerous path or link', 'wrong package tree digest']) {
    assert.match(stdout, new RegExp(`PASS: ${label}`, 'u'))
  }
})

test('tag-only release workflow gates all three Node 24 platforms before upload', async () => {
  const workflow = await readFile(join(repoRoot, '.github/workflows/cli-release.yml'), 'utf8')
  assert.match(workflow, /push:\s*\n\s*tags:\s*\n\s*- ['"]cli-v\*['"]/u)
  assert.match(workflow, /permissions:\s*\n\s*contents: write/u)
  for (const platform of ['ubuntu-latest', 'windows-latest', 'macos-latest']) assert.ok(workflow.includes(platform))
  assert.match(workflow, /node-version: ['"]24['"]/u)
  assert.match(workflow, /skills\/panshi-camp\/scripts\/install-cli\.test\.mjs/u)
  const docsGate = workflow.indexOf('node --test tests/cli-docs.test.mjs')
  const packageGate = workflow.indexOf('node --test tests/cli-package.test.mjs')
  const releaseGate = workflow.indexOf('node --test tests/cli-release.test.mjs')
  assert.ok(docsGate >= 0 && docsGate < packageGate && packageGate < releaseGate, 'release tests that share build output must run in separate ordered steps')
  assert.match(workflow, /needs: test/u)
  assert.match(workflow, /RELEASE_TAG: \$\{\{ github\.ref_name \}\}/u)
  assert.match(workflow, /check:cli-release -- --tag "\$RELEASE_TAG"/u)
  assert.match(workflow, /dist-release\/panshi-camp-cli-\*\.tgz/u)
  assert.match(workflow, /dist-release\/release-manifest\.json/u)
})
