#!/usr/bin/env node

import { readFile, lstat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { computePackageTreeSha256, validateManifest } from '../skills/panshi-camp/scripts/install-cli.mjs'
import { MAX_RELEASE_BYTES, extractPackageEntries, parseTarGz, sha256 } from './cli-release-lib.mjs'

const PACKAGE_NAME = 'panshi-camp-cli'
const RELEASE_REPOSITORY = 'https://github.com/TashanGKD/panshi-ai4s-camp'
const LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepack', 'prepare', 'postpack', 'prepublish', 'prepublishOnly', 'publish', 'postpublish'])
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:^|[^A-Za-z0-9])gh[opusr]_[A-Za-z0-9]{20,}/u,
  /(?:^|[^A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/u,
]

const readJson = async (file, label) => {
  const metadata = await lstat(file).catch(() => null)
  if (!metadata?.isFile() || metadata.isSymbolicLink()) throw new Error(`CLI_RELEASE_FILE_INVALID: ${label} must be a regular file`)
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { throw new Error(`CLI_RELEASE_JSON_INVALID: ${label}`) }
}

const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`

const inspectReleaseEntries = (entries) => {
  if (entries.length > 10_000) throw new Error('CLI_RELEASE_ENTRY_LIMIT: too many archive entries')
  const seen = new Set()
  let expandedBytes = 0
  for (const entry of entries) {
    if (seen.has(entry.path)) throw new Error(`CLI_RELEASE_DUPLICATE_PATH: ${entry.path}`)
    seen.add(entry.path)
    expandedBytes += entry.size
    if (expandedBytes > MAX_RELEASE_BYTES) throw new Error('CLI_RELEASE_SIZE_INVALID: expanded archive exceeds release limit')
    if (!entry.path.startsWith('package/')) throw new Error(`CLI_RELEASE_ROOT_INVALID: ${entry.path}`)
    if (entry.type === '1' || entry.type === '2') throw new Error(`CLI_RELEASE_LINK_UNSAFE: ${entry.path}`)
    if (!['0', '5'].includes(entry.type)) throw new Error(`CLI_RELEASE_NODE_UNSAFE: ${entry.path}`)
    if (/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.test\.|\.spec\.|\.map$/iu.test(entry.path)) throw new Error(`CLI_RELEASE_DEVELOPMENT_FILE: ${entry.path}`)
    if (/(?:^|\/)(?:\.env(?:\.|$)|id_rsa$|id_ed25519$)|\.(?:pem|key|p12)$/iu.test(entry.path)) throw new Error(`CLI_RELEASE_SECRET_FILE: ${entry.path}`)
    if (entry.type === '0' && entry.size <= 2 * 1024 * 1024) {
      const source = entry.data.toString('utf8')
      if (SECRET_PATTERNS.some((pattern) => pattern.test(source))) throw new Error(`CLI_RELEASE_SECRET_TRACE: ${entry.path}`)
    }
  }
  return seen
}

const verifyPackageJson = (packageJson, version) => {
  if (packageJson.name !== PACKAGE_NAME || packageJson.version !== version) throw new Error('CLI_RELEASE_PACKAGE_IDENTITY: package name or version drifted')
  if (packageJson.private === true) throw new Error('CLI_RELEASE_PACKAGE_PRIVATE: public release package cannot be private')
  if (packageJson.bin?.['panshi-camp'] !== './dist/main.js') throw new Error('CLI_RELEASE_BIN_INVALID: executable entry drifted')
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = packageJson[section] ?? {}
    if (Object.keys(dependencies).some((name) => name.startsWith('@panshi/'))) throw new Error(`CLI_RELEASE_INTERNAL_DEPENDENCY: ${section} contains @panshi package`)
  }
  for (const script of Object.keys(packageJson.scripts ?? {})) {
    if (LIFECYCLE_SCRIPTS.has(script)) throw new Error(`CLI_RELEASE_LIFECYCLE_SCRIPT: ${script}`)
  }
}

// Target bug: a valid, internally consistent release manifest describes a different version than apps/cli/package.json.
export const validateReleaseVersion = ({ packageVersion, manifest }) => {
  const expectedAsset = `${PACKAGE_NAME}-${packageVersion}.tgz`
  if (manifest.version !== packageVersion || manifest.assetName !== expectedAsset) throw new Error('CLI_RELEASE_VERSION_DRIFT: package, manifest, and asset versions differ')
  return expectedAsset
}

export const checkCliRelease = async ({
  repoRoot = resolve(import.meta.dirname, '..'),
  releaseDirectory = join(repoRoot, 'dist-release'),
  skillManifestPath = join(repoRoot, 'skills/panshi-camp/release-manifest.json'),
  expectedTag,
} = {}) => {
  const cliPackagePath = join(repoRoot, 'apps/cli/package.json')
  const cliPackage = await readJson(cliPackagePath, 'CLI package.json')
  const releaseManifestPath = join(releaseDirectory, 'release-manifest.json')
  const releaseManifestSource = await readFile(releaseManifestPath, 'utf8')
  const skillManifestSource = await readFile(skillManifestPath, 'utf8')
  const releaseManifest = validateManifest(JSON.parse(releaseManifestSource))
  const skillManifest = validateManifest(JSON.parse(skillManifestSource))
  if (releaseManifestSource !== canonical(releaseManifest) || skillManifestSource !== canonical(skillManifest)) throw new Error('CLI_RELEASE_MANIFEST_FORMAT: manifests must use canonical JSON formatting')
  if (JSON.stringify(releaseManifest) !== JSON.stringify(skillManifest)) throw new Error('CLI_RELEASE_MANIFEST_DRIFT: dist and Skill manifests differ')
  const expectedAsset = validateReleaseVersion({ packageVersion: cliPackage.version, manifest: releaseManifest })
  const expectedUrl = `${RELEASE_REPOSITORY}/releases/download/cli-v${cliPackage.version}/${expectedAsset}`
  if (releaseManifest.url !== expectedUrl) throw new Error('CLI_RELEASE_URL_DRIFT: release URL or tag drifted')
  if (expectedTag !== undefined && expectedTag !== `cli-v${cliPackage.version}`) throw new Error(`CLI_RELEASE_TAG_DRIFT: expected cli-v${cliPackage.version}, received ${expectedTag}`)

  const archivePath = join(releaseDirectory, expectedAsset)
  if (basename(archivePath) !== releaseManifest.assetName) throw new Error('CLI_RELEASE_ASSET_INVALID: archive basename drifted')
  const archive = await readFile(archivePath)
  if (archive.length !== releaseManifest.sizeBytes || sha256(archive) !== releaseManifest.sha256) throw new Error('CLI_RELEASE_ARCHIVE_DIGEST: archive size or SHA-256 differs from manifest')
  const entries = parseTarGz(archive)
  const paths = inspectReleaseEntries(entries)
  if (!paths.has('package/package.json') || !paths.has('package/dist/main.js')) throw new Error('CLI_RELEASE_PACKAGE_CONTENT: required runtime files are missing')
  if (paths.has('package/dist/skill/release-manifest.json')) throw new Error('CLI_RELEASE_TRUST_ROOT_LOOP: package must not contain the Skill trust root')

  const packageJsonEntry = entries.find((entry) => entry.path === 'package/package.json')
  let packedPackage
  try { packedPackage = JSON.parse(packageJsonEntry.data.toString('utf8')) } catch { throw new Error('CLI_RELEASE_PACKAGE_JSON: packed package.json is invalid') }
  verifyPackageJson(packedPackage, cliPackage.version)

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-release-check-'))
  try {
    await extractPackageEntries(entries, temporaryRoot)
    const packageTreeSha256 = await computePackageTreeSha256(join(temporaryRoot, 'package'))
    if (packageTreeSha256 !== releaseManifest.packageTreeSha256) throw new Error('CLI_RELEASE_PACKAGE_TREE_DIGEST: package tree digest differs from manifest')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  return { archivePath, manifest: releaseManifest, entries: entries.map(({ path, type, size }) => ({ path, type, size })) }
}

const parseCliArguments = (argv) => {
  if (argv.length === 0) return {}
  if (argv.length === 2 && argv[0] === '--tag' && argv[1]) return { expectedTag: argv[1] }
  throw new Error('CLI_RELEASE_ARGUMENTS_INVALID: usage: node scripts/check-cli-release.mjs [--tag cli-vX.Y.Z]')
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  checkCliRelease({ ...parseCliArguments(process.argv.slice(2)) })
    .then(({ manifest }) => process.stdout.write(`CLI release verified: ${manifest.assetName}\n`))
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
