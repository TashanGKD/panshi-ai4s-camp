import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import test, { after, before } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { buildCliRelease } from '../scripts/build-cli-release.mjs'
import { extractPackageEntries, parseTarGz } from '../scripts/cli-release-lib.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '..')
const sourceSkill = join(repoRoot, 'skills/panshi-camp')
let releaseRoot
let archive
let manifest

const sha256 = (contents) => createHash('sha256').update(contents).digest('hex')

before(async () => {
  releaseRoot = await mkdtemp(join(tmpdir(), 'panshi-public-release-'))
  const built = await buildCliRelease({ repoRoot, outputDirectory: join(releaseRoot, 'release') })
  archive = await readFile(built.archivePath)
  manifest = built.manifest
})

after(async () => {
  if (releaseRoot) await rm(releaseRoot, { recursive: true, force: true })
})

const inventory = async (root, cursor = root) => {
  const entries = []
  for (const entry of await readdir(cursor, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
    const absolute = join(cursor, entry.name)
    const relative = absolute.slice(root.length + 1)
    const metadata = await lstat(absolute)
    if (metadata.isSymbolicLink()) entries.push([relative, 'symlink'])
    else if (metadata.isDirectory()) {
      entries.push([relative, 'directory'])
      entries.push(...await inventory(root, absolute))
    } else if (metadata.isFile()) entries.push([relative, 'file', sha256(await readFile(absolute))])
    else entries.push([relative, 'other'])
  }
  return entries.sort((left, right) => left[0].localeCompare(right[0]))
}

const makeSandbox = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'panshi-public-install-'))
  const homeDirectory = join(root, 'home')
  const workspaceRoot = join(root, 'workspace')
  const localAppData = join(root, 'local-app-data')
  const skillDirectory = join(homeDirectory, '.codex/skills/panshi-camp')
  await mkdir(homeDirectory, { mode: 0o700 })
  await mkdir(workspaceRoot)
  await mkdir(localAppData)
  await mkdir(resolve(skillDirectory, '..'), { recursive: true })
  await cp(sourceSkill, skillDirectory, { recursive: true, errorOnExist: true, force: false })
  await writeFile(join(skillDirectory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  t.after(() => rm(root, { recursive: true, force: true }))
  const installer = await import(`${pathToFileURL(join(skillDirectory, 'scripts/install-cli.mjs')).href}?sandbox=${encodeURIComponent(basename(root))}`)
  return { root, homeDirectory, workspaceRoot, localAppData, skillDirectory, installer }
}

const localFetch = (state, bytes = archive) => async (url, options) => {
  state.fetches += 1
  assert.equal(String(url), manifest.url)
  assert.equal(options.redirect, 'manual')
  return {
    ok: true,
    status: 200,
    url: manifest.url,
    headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(bytes.length) : null },
    body: Readable.from([bytes]),
  }
}

const installLocalArchive = async (_command, args, options) => {
  assert.deepEqual(args.slice(0, 5), ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'])
  const archivePath = args[5]
  assert.equal(sha256(await readFile(archivePath)), manifest.sha256)
  const extracted = join(options.cwd, '.local-release-extract')
  const packageTarget = join(options.cwd, 'node_modules', manifest.packageName)
  try {
    await extractPackageEntries(parseTarGz(await readFile(archivePath)), extracted)
    await mkdir(resolve(packageTarget, '..'), { recursive: true })
    await rename(join(extracted, 'package'), packageTarget)
    await chmod(join(packageTarget, 'dist/main.js'), 0o755)
    const napiSource = join(repoRoot, 'node_modules/@napi-rs')
    const napiTarget = join(options.cwd, 'node_modules/@napi-rs')
    await mkdir(napiTarget, { recursive: true })
    for (const name of await readdir(napiSource)) {
      if (name === 'keyring' || name.startsWith('keyring-')) {
        await cp(join(napiSource, name), join(napiTarget, name), { recursive: true, errorOnExist: true, force: false })
      }
    }
  } finally {
    await rm(extracted, { recursive: true, force: true })
  }
}

const dependenciesFor = (sandbox, state, bytes = archive) => ({
  platform: process.platform,
  homeDirectory: sandbox.homeDirectory,
  workspaceRoot: sandbox.workspaceRoot,
  localAppData: sandbox.localAppData,
  fetch: localFetch(state, bytes),
  execFile: installLocalArchive,
  stdout: (text) => state.stdout.push(text),
  stderr: (text) => state.stderr.push(text),
})

const assertNoTransactionResidue = async (homeDirectory) => {
  const entries = await inventory(homeDirectory)
  const residue = entries.filter(([name]) => /(?:^|\/)(?:\.install-|\.download-|.*\.tmp-|.*\.backup-|.*\.quarantine-)/u.test(name))
  assert.deepEqual(residue, [])
}

const executeStable = async (stableEntry, args, homeDirectory) => {
  const env = { ...process.env, HOME: homeDirectory, XDG_CONFIG_HOME: join(homeDirectory, '.config') }
  if (process.platform === 'win32') {
    return execFileAsync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', stableEntry, ...args], { encoding: 'utf8', env })
  }
  return execFileAsync(stableEntry, args, { encoding: 'utf8', env })
}

test('empty HOME installs the public Skill, previews without network or writes, then boots the local CLI release', async (t) => {
  const sandbox = await makeSandbox(t)
  const skill = await readFile(join(sandbox.skillDirectory, 'SKILL.md'), 'utf8')
  assert.match(skill, /^name: panshi-camp$/mu)
  assert.equal((await lstat(join(sandbox.homeDirectory, '.codex/skills/panshi-camp'))).isDirectory(), true)

  const state = { fetches: 0, stdout: [], stderr: [] }
  const beforePreview = await inventory(sandbox.homeDirectory)
  const preview = await sandbox.installer.runEmbeddedInstaller({ argv: [], dependencies: dependenciesFor(sandbox, state) })
  assert.equal(preview.status, 'preview')
  assert.equal(state.fetches, 0)
  assert.deepEqual(await inventory(sandbox.homeDirectory), beforePreview)

  const result = await sandbox.installer.runEmbeddedInstaller({ argv: ['--yes'], dependencies: dependenciesFor(sandbox, state) })
  assert.equal(result.status, 'installed')
  assert.equal(state.fetches, 1)
  const version = await executeStable(result.stableEntry, ['--version'], sandbox.homeDirectory)
  assert.equal(version.stderr, '')
  assert.equal(version.stdout.trim(), manifest.version)
  const help = await executeStable(result.stableEntry, ['--help'], sandbox.homeDirectory)
  assert.equal(help.stderr, '')
  assert.match(help.stdout, /磐石·科学智能实训营 CLI/u)
  assert.match(help.stdout, /用法：panshi-camp/u)
  await assertNoTransactionResidue(sandbox.homeDirectory)
})

test('rejects a local release checksum mismatch and removes allocated transaction files', async (t) => {
  const sandbox = await makeSandbox(t)
  const state = { fetches: 0, stdout: [], stderr: [] }
  const tampered = Buffer.from(archive)
  tampered[Math.floor(tampered.length / 2)] ^= 0xff

  await assert.rejects(
    sandbox.installer.runEmbeddedInstaller({ argv: ['--yes'], dependencies: dependenciesFor(sandbox, state, tampered) }),
    /INSTALLER_SHA256_MISMATCH/u,
  )
  assert.equal(state.fetches, 1)
  await assertNoTransactionResidue(sandbox.homeDirectory)
})

test('rejects a symlinked install parent without writing outside HOME', { skip: process.platform === 'win32' }, async (t) => {
  const sandbox = await makeSandbox(t)
  const state = { fetches: 0, stdout: [], stderr: [] }
  const outside = join(sandbox.root, 'outside')
  await mkdir(join(sandbox.homeDirectory, '.local'), { recursive: true })
  await mkdir(outside)
  await symlink(outside, join(sandbox.homeDirectory, '.local/share'))

  await assert.rejects(
    sandbox.installer.runEmbeddedInstaller({ argv: ['--yes'], dependencies: dependenciesFor(sandbox, state) }),
    /INSTALLER_PATH_UNSAFE/u,
  )
  assert.equal(state.fetches, 0)
  assert.deepEqual(await readdir(outside), [])
  await assertNoTransactionResidue(sandbox.homeDirectory)
})

test('rejects a Windows junction install parent without writing through it', { skip: process.platform !== 'win32' }, async (t) => {
  const sandbox = await makeSandbox(t)
  const state = { fetches: 0, stdout: [], stderr: [] }
  const outside = join(sandbox.root, 'outside-junction')
  const junction = join(sandbox.localAppData, 'panshi-camp-cli')
  await mkdir(outside)
  await symlink(outside, junction, 'junction')

  await assert.rejects(
    sandbox.installer.runEmbeddedInstaller({ argv: ['--yes'], dependencies: dependenciesFor(sandbox, state) }),
    /INSTALLER_WINDOWS_REPARSE_POINT/u,
  )
  assert.equal(state.fetches, 0)
  assert.deepEqual(await readdir(outside), [])
  await assertNoTransactionResidue(sandbox.homeDirectory)
})

test('rejects conflicting content at the target version and preserves it', async (t) => {
  const sandbox = await makeSandbox(t)
  const state = { fetches: 0, stdout: [], stderr: [] }
  const layout = sandbox.installer.resolveLayout({ platform: process.platform, homeDirectory: sandbox.homeDirectory, localAppData: sandbox.localAppData })
  const versionRoot = layout.pathApi.join(layout.installRoot, manifest.version)
  await mkdir(versionRoot, { recursive: true })
  await writeFile(layout.pathApi.join(versionRoot, 'foreign.txt'), 'preserve me\n')

  await assert.rejects(
    sandbox.installer.runEmbeddedInstaller({ argv: ['--yes'], dependencies: dependenciesFor(sandbox, state) }),
    /INSTALLER_VERSION_CONFLICT/u,
  )
  assert.equal(state.fetches, 0)
  assert.equal(await readFile(layout.pathApi.join(versionRoot, 'foreign.txt'), 'utf8'), 'preserve me\n')
  await assertNoTransactionResidue(sandbox.homeDirectory)
})

test('rejects and preserves a non-managed stable entry', async (t) => {
  const sandbox = await makeSandbox(t)
  const state = { fetches: 0, stdout: [], stderr: [] }
  const layout = sandbox.installer.resolveLayout({ platform: process.platform, homeDirectory: sandbox.homeDirectory, localAppData: sandbox.localAppData })
  await mkdir(layout.binDirectory, { recursive: true })
  await writeFile(layout.stableEntry, 'foreign stable entry\n')

  await assert.rejects(
    sandbox.installer.runEmbeddedInstaller({ argv: ['--yes'], dependencies: dependenciesFor(sandbox, state) }),
    /INSTALLER_STABLE_ENTRY_UNMANAGED/u,
  )
  assert.equal(state.fetches, 0)
  assert.equal(await readFile(layout.stableEntry, 'utf8'), 'foreign stable entry\n')
  await assertNoTransactionResidue(sandbox.homeDirectory)
})

test('rejects a same-name different-address panshi profile and preserves the config', async (t) => {
  const sandbox = await makeSandbox(t)
  const state = { fetches: 0, stdout: [], stderr: [] }
  const layout = sandbox.installer.resolveLayout({ platform: process.platform, homeDirectory: sandbox.homeDirectory, localAppData: sandbox.localAppData })
  const original = '{"profiles":{"panshi":{"baseUrl":"https://different.example.org"}}}\n'
  await mkdir(layout.configDirectory, { recursive: true, mode: 0o700 })
  await writeFile(layout.configPath, original, { mode: 0o600 })
  if (process.platform !== 'win32') {
    await chmod(layout.configDirectory, 0o700)
    await chmod(layout.configPath, 0o600)
  }

  await assert.rejects(
    sandbox.installer.runEmbeddedInstaller({ argv: ['--yes'], dependencies: dependenciesFor(sandbox, state) }),
    /INSTALLER_PROFILE_CONFLICT/u,
  )
  assert.equal(state.fetches, 0)
  assert.equal(await readFile(layout.configPath, 'utf8'), original)
  await assertNoTransactionResidue(sandbox.homeDirectory)
})
