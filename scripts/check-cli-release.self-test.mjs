#!/usr/bin/env node

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { buildCliRelease } from './build-cli-release.mjs'
import { checkCliRelease } from './check-cli-release.mjs'
import { computePackageTreeSha256 } from '../skills/panshi-camp/scripts/install-cli.mjs'
import { extractPackageEntries, parseTarGz, sha256 } from './cli-release-lib.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-release-self-test-'))
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`

const writeString = (header, offset, length, value) => Buffer.from(value).copy(header, offset, 0, length)
const writeOctal = (header, offset, length, value) => writeString(header, offset, length, value.toString(8).padStart(length - 1, '0') + '\0')
const splitTarPath = (path) => {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' }
  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index)
    const name = path.slice(index + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix }
  }
  throw new Error(`self-test path too long: ${path}`)
}
const makeTarGz = (entries) => {
  const blocks = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    const { name, prefix } = splitTarPath(entry.path)
    writeString(header, 0, 100, name)
    writeOctal(header, 100, 8, entry.type === '5' ? 0o755 : 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, entry.type === '0' ? entry.data.length : 0)
    writeOctal(header, 136, 12, 0)
    header.fill(0x20, 148, 156)
    header[156] = Buffer.from(entry.type)[0]
    writeString(header, 157, 100, entry.linkPath ?? '')
    writeString(header, 257, 6, 'ustar\0')
    writeString(header, 263, 2, '00')
    writeString(header, 345, 155, prefix)
    writeOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0))
    blocks.push(header)
    if (entry.type === '0') {
      blocks.push(entry.data)
      const padding = (512 - (entry.data.length % 512)) % 512
      if (padding) blocks.push(Buffer.alloc(padding))
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 })
}

const createFixture = async (name, goodRelease) => {
  const fixture = join(temporaryRoot, name)
  await mkdir(join(fixture, 'apps/cli'), { recursive: true })
  await cp(join(repoRoot, 'apps/cli/package.json'), join(fixture, 'apps/cli/package.json'))
  await cp(goodRelease, join(fixture, 'dist-release'), { recursive: true })
  await mkdir(join(fixture, 'skills/panshi-camp'), { recursive: true })
  await cp(join(goodRelease, 'release-manifest.json'), join(fixture, 'skills/panshi-camp/release-manifest.json'))
  return fixture
}

const rewriteArchiveMetadata = async (fixture, archive, { packageTreeSha256 } = {}) => {
  const manifestPath = join(fixture, 'dist-release/release-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.sha256 = sha256(archive)
  manifest.sizeBytes = archive.length
  if (packageTreeSha256) manifest.packageTreeSha256 = packageTreeSha256
  await writeFile(join(fixture, 'dist-release', manifest.assetName), archive)
  await writeFile(manifestPath, canonical(manifest))
  await writeFile(join(fixture, 'skills/panshi-camp/release-manifest.json'), canonical(manifest))
}

const computeTreeFromEntries = async (entries) => {
  const extractionRoot = await mkdtemp(join(temporaryRoot, 'tree-'))
  await extractPackageEntries(entries, extractionRoot)
  return computePackageTreeSha256(join(extractionRoot, 'package'))
}

const expectGateFailure = async (label, fixture, pattern) => {
  await assert.rejects(checkCliRelease({ repoRoot: fixture }), pattern)
  process.stdout.write(`PASS: ${label}\n`)
}

try {
  const goodRelease = join(temporaryRoot, 'good-release')
  await buildCliRelease({ repoRoot, outputDirectory: goodRelease })

  const versionFixture = await createFixture('version-drift', goodRelease)
  const versionManifestPath = join(versionFixture, 'skills/panshi-camp/release-manifest.json')
  const versionManifest = JSON.parse(await readFile(versionManifestPath, 'utf8'))
  versionManifest.version = '0.1.1'
  versionManifest.assetName = 'panshi-camp-cli-0.1.1.tgz'
  versionManifest.url = 'https://github.com/TashanGKD/panshi-ai4s-camp/releases/download/cli-v0.1.1/panshi-camp-cli-0.1.1.tgz'
  await writeFile(versionManifestPath, canonical(versionManifest))
  await expectGateFailure('version drift', versionFixture, /CLI_RELEASE_MANIFEST_DRIFT/u)

  const dependencyFixture = await createFixture('dependency-leak', goodRelease)
  const dependencyManifest = JSON.parse(await readFile(join(dependencyFixture, 'dist-release/release-manifest.json'), 'utf8'))
  const dependencyArchive = await readFile(join(dependencyFixture, 'dist-release', dependencyManifest.assetName))
  const dependencyEntries = parseTarGz(dependencyArchive)
  const packageEntry = dependencyEntries.find((entry) => entry.path === 'package/package.json')
  const packageJson = JSON.parse(packageEntry.data.toString('utf8'))
  packageJson.dependencies = { ...(packageJson.dependencies ?? {}), '@panshi/contracts': '0.1.0' }
  packageEntry.data = Buffer.from(canonical(packageJson))
  packageEntry.size = packageEntry.data.length
  const leakedArchive = makeTarGz(dependencyEntries)
  await rewriteArchiveMetadata(dependencyFixture, leakedArchive, { packageTreeSha256: await computeTreeFromEntries(dependencyEntries) })
  await expectGateFailure('internal dependency leak', dependencyFixture, /CLI_RELEASE_INTERNAL_DEPENDENCY/u)

  const linkFixture = await createFixture('dangerous-link', goodRelease)
  const linkManifest = JSON.parse(await readFile(join(linkFixture, 'dist-release/release-manifest.json'), 'utf8'))
  const linkEntries = parseTarGz(await readFile(join(linkFixture, 'dist-release', linkManifest.assetName)))
  linkEntries.push({ path: 'package/dist/escape', type: '2', size: 0, linkPath: '../../outside', data: Buffer.alloc(0) })
  await rewriteArchiveMetadata(linkFixture, makeTarGz(linkEntries))
  await assert.rejects(checkCliRelease({ repoRoot: linkFixture }), /CLI_RELEASE_LINK_UNSAFE/u)

  const traversalFixture = await createFixture('dangerous-path', goodRelease)
  const traversalManifest = JSON.parse(await readFile(join(traversalFixture, 'dist-release/release-manifest.json'), 'utf8'))
  const traversalEntries = parseTarGz(await readFile(join(traversalFixture, 'dist-release', traversalManifest.assetName)))
  traversalEntries.push({ path: 'package/../escape', type: '0', size: 4, linkPath: '', data: Buffer.from('evil') })
  await rewriteArchiveMetadata(traversalFixture, makeTarGz(traversalEntries))
  await assert.rejects(checkCliRelease({ repoRoot: traversalFixture }), /CLI_RELEASE_PATH_UNSAFE/u)
  process.stdout.write('PASS: dangerous path or link\n')

  const digestFixture = await createFixture('wrong-digest', goodRelease)
  for (const manifestPath of [join(digestFixture, 'dist-release/release-manifest.json'), join(digestFixture, 'skills/panshi-camp/release-manifest.json')]) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.packageTreeSha256 = '0'.repeat(64)
    await writeFile(manifestPath, canonical(manifest))
  }
  await expectGateFailure('wrong package tree digest', digestFixture, /CLI_RELEASE_PACKAGE_TREE_DIGEST/u)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
