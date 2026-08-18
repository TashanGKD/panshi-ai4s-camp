#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { computePackageTreeSha256, validateManifest } from '../skills/panshi-camp/scripts/install-cli.mjs'
import { extractPackageEntries, parseTarGz, sha256 } from './cli-release-lib.mjs'

const execFileAsync = promisify(execFileCallback)
const PACKAGE_NAME = 'panshi-camp-cli'
const RELEASE_REPOSITORY = 'https://github.com/TashanGKD/panshi-ai4s-camp'
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`

const assertSafeOutputDirectory = (repoRoot, outputDirectory) => {
  const absolute = resolve(outputDirectory)
  const contains = (parent, child) => {
    const relation = relative(parent, child)
    return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
  }
  if (!isAbsolute(absolute) || contains(absolute, repoRoot) || contains(absolute, resolve(homedir()))) throw new Error('CLI_RELEASE_OUTPUT_UNSAFE: refusing broad output directory')
  return absolute
}

const writeAtomic = async (destination, contents) => {
  await mkdir(dirname(destination), { recursive: true })
  const temporary = join(dirname(destination), `.${randomBytes(12).toString('hex')}.tmp`)
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

const runNpm = async (args, cwd) => execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
  cwd,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  env: { ...process.env },
})

export const buildCliRelease = async ({
  repoRoot = resolve(import.meta.dirname, '..'),
  outputDirectory = join(repoRoot, 'dist-release'),
  updateSkillManifest = false,
  skillManifestPath = join(repoRoot, 'skills/panshi-camp/release-manifest.json'),
} = {}) => {
  repoRoot = resolve(repoRoot)
  outputDirectory = assertSafeOutputDirectory(repoRoot, outputDirectory)
  const cliRoot = join(repoRoot, 'apps/cli')
  const cliPackage = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'))
  if (cliPackage.name !== PACKAGE_NAME || !/^\d+\.\d+\.\d+$/u.test(cliPackage.version)) throw new Error('CLI_RELEASE_PACKAGE_INVALID: expected a stable panshi-camp-cli package')
  const assetName = `${PACKAGE_NAME}-${cliPackage.version}.tgz`

  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })
  await runNpm(['run', 'build', '-w', PACKAGE_NAME], repoRoot)
  const packed = await runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', outputDirectory, cliRoot], repoRoot)
  const reports = JSON.parse(packed.stdout)
  if (!Array.isArray(reports) || reports.length !== 1 || reports[0].filename !== assetName) throw new Error('CLI_RELEASE_PACK_INVALID: npm pack returned an unexpected artifact')
  const archivePath = join(outputDirectory, assetName)
  const archiveMetadata = await lstat(archivePath)
  if (!archiveMetadata.isFile() || archiveMetadata.isSymbolicLink()) throw new Error('CLI_RELEASE_PACK_INVALID: npm pack artifact is not a regular file')
  const archive = await readFile(archivePath)
  const entries = parseTarGz(archive)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-release-build-'))
  let packageTreeSha256
  try {
    await extractPackageEntries(entries, temporaryRoot)
    packageTreeSha256 = await computePackageTreeSha256(join(temporaryRoot, 'package'))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  const manifest = validateManifest({
    schemaVersion: 1,
    packageName: PACKAGE_NAME,
    version: cliPackage.version,
    assetName,
    url: `${RELEASE_REPOSITORY}/releases/download/cli-v${cliPackage.version}/${assetName}`,
    sha256: sha256(archive),
    sizeBytes: (await stat(archivePath)).size,
    packageTreeSha256,
  })
  const manifestSource = canonical(manifest)
  await writeAtomic(join(outputDirectory, 'release-manifest.json'), manifestSource)
  if (updateSkillManifest) await writeAtomic(skillManifestPath, manifestSource)
  return { archivePath, manifest, manifestPath: join(outputDirectory, 'release-manifest.json') }
}

const parseCliArguments = (argv) => {
  if (argv.length === 0) return { updateSkillManifest: false }
  if (argv.length === 1 && argv[0] === '--update-skill-manifest') return { updateSkillManifest: true }
  throw new Error('CLI_RELEASE_ARGUMENTS_INVALID: only --update-skill-manifest is supported')
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  buildCliRelease(parseCliArguments(process.argv.slice(2)))
    .then(({ manifest }) => process.stdout.write(`Built local release: dist-release/${manifest.assetName}\n`))
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
