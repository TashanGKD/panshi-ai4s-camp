import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  assertWindowsPathSafe,
  mergePanshiProfile,
  parseInstallerArgv,
  resolveLayout,
  runEmbeddedInstaller,
  runInstaller,
  validateManifest,
} from './install-cli.mjs'

const execFileAsync = promisify(execFile)
const body = Buffer.from('pinned release bytes')
const digest = createHash('sha256').update(body).digest('hex')
const manifest = Object.freeze({
  schemaVersion: 1,
  packageName: 'panshi-camp-cli',
  version: '1.2.3',
  assetName: 'panshi-camp-cli-1.2.3.tgz',
  url: 'https://github.com/TashanGKD/panshi-ai4s-camp/releases/download/cli-v1.2.3/panshi-camp-cli-1.2.3.tgz',
  sha256: digest,
  sizeBytes: body.length,
})

const response = (bytes = body, overrides = {}) => ({
  ok: true,
  status: 200,
  url: manifest.url,
  headers: { get: (name) => name.toLocaleLowerCase('en-US') === 'content-length' ? String(bytes.length) : null },
  body: Readable.from([bytes]),
  ...overrides,
})

const makeSandbox = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'panshi-installer-test-'))
  const homeDirectory = join(root, 'home')
  const workspaceRoot = join(root, 'workspace')
  await mkdir(homeDirectory)
  await mkdir(workspaceRoot)
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, homeDirectory, workspaceRoot }
}

const fakeNpmInstall = async (_command, args, options) => {
  assert.deepEqual(args.slice(0, 5), [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
  ])
  const packageRoot = join(options.cwd, 'node_modules', manifest.packageName)
  const binRoot = join(options.cwd, 'node_modules', '.bin')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await mkdir(binRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: manifest.packageName,
    version: manifest.version,
    bin: { 'panshi-camp': './dist/main.js' },
  }))
  await writeFile(join(packageRoot, 'dist/main.js'), '#!/usr/bin/env node\n')
  await writeFile(join(binRoot, 'panshi-camp'), '#!/bin/sh\n')
  await chmod(join(binRoot, 'panshi-camp'), 0o755)
}

const install = async (t, overrides = {}) => {
  const sandbox = await makeSandbox(t)
  let fetchCalls = 0
  let execCalls = 0
  const stdout = []
  const dependencies = {
    platform: 'linux',
    ...sandbox,
    fetch: async () => {
      fetchCalls += 1
      return response()
    },
    execFile: async (...args) => {
      execCalls += 1
      return fakeNpmInstall(...args)
    },
    stdout: (text) => stdout.push(text),
    ...overrides,
  }
  return {
    ...sandbox,
    dependencies,
    counters: { get fetch() { return fetchCalls }, get exec() { return execCalls } },
    stdout,
    run: (argv = ['--yes'], selectedManifest = manifest) => runInstaller({ argv, manifest: selectedManifest, dependencies }),
  }
}

const assertNoInstallerTemps = async (homeDirectory) => {
  const root = join(homeDirectory, '.local/share/panshi-camp-cli')
  const entries = await readdir(root).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))
  assert.equal(entries.some((entry) => entry.startsWith('.install-') || entry.startsWith('.download-')), false)
}

test('rejects a checksum mismatch and removes download and install temporaries', async (t) => {
  const tampered = Buffer.from(body)
  tampered[0] ^= 0xff
  const fixture = await install(t, { fetch: async () => response(tampered) })

  await assert.rejects(fixture.run(), /INSTALLER_SHA256_MISMATCH/u)

  assert.equal(fixture.counters.exec, 0)
  await assertNoInstallerTemps(fixture.homeDirectory)
})

test('rejects a symlinked install parent without writing through it', async (t) => {
  const fixture = await install(t)
  const outside = join(fixture.root, 'outside')
  await mkdir(join(fixture.homeDirectory, '.local'), { recursive: true })
  await mkdir(outside)
  await symlink(outside, join(fixture.homeDirectory, '.local/share'))

  await assert.rejects(fixture.run(), /INSTALLER_PATH_UNSAFE/u)

  assert.deepEqual(await readdir(outside), [])
  assert.equal(fixture.counters.fetch, 0)
})

test('rejects a symlink at the target version without replacing its destination', async (t) => {
  const fixture = await install(t)
  const shareRoot = join(fixture.homeDirectory, '.local/share/panshi-camp-cli')
  const outside = join(fixture.root, 'outside-version')
  await mkdir(shareRoot, { recursive: true })
  await mkdir(outside)
  await writeFile(join(outside, 'sentinel'), 'keep')
  await symlink(outside, join(shareRoot, manifest.version))

  await assert.rejects(fixture.run(), /INSTALLER_PATH_UNSAFE/u)

  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'keep')
  assert.equal(fixture.counters.fetch, 0)
})

test('rejects conflicting content already present at the same version', async (t) => {
  const fixture = await install(t)
  const versionRoot = join(fixture.homeDirectory, '.local/share/panshi-camp-cli', manifest.version)
  await mkdir(versionRoot, { recursive: true })
  await writeFile(join(versionRoot, 'foreign.txt'), 'do not delete')

  await assert.rejects(fixture.run(), /INSTALLER_VERSION_CONFLICT/u)

  assert.equal(await readFile(join(versionRoot, 'foreign.txt'), 'utf8'), 'do not delete')
  assert.equal(fixture.counters.fetch, 0)
})

test('no arguments only print a preview with zero network and zero writes', async (t) => {
  const fixture = await install(t)

  const result = await fixture.run([])

  assert.equal(result.status, 'preview')
  assert.equal(fixture.counters.fetch, 0)
  assert.equal(fixture.counters.exec, 0)
  assert.match(fixture.stdout.join(''), /panshi-camp-cli-1\.2\.3\.tgz/u)
  assert.deepEqual(await readdir(fixture.homeDirectory), [])
})

test('only one exact --yes token is accepted', () => {
  assert.equal(parseInstallerArgv([]), 'preview')
  assert.equal(parseInstallerArgv(['--yes']), 'install')
  for (const argv of [['--yes=false'], ['--yes', '--yes'], ['--YES'], ['yes'], ['--force'], ['--yes', 'https://evil.example/x.tgz']]) {
    assert.throws(() => parseInstallerArgv(argv), /INSTALLER_ARGUMENTS_INVALID/u)
  }
})

test('strict manifest validation rejects unknown fields, unsafe URLs, bad assets, hashes, sizes, and versions', () => {
  const badManifests = [
    { ...manifest, extra: true },
    { ...manifest, url: manifest.url.replace('https:', 'http:') },
    { ...manifest, url: 'https://evil.example/panshi-camp-cli-1.2.3.tgz' },
    { ...manifest, url: 'https://raw.githubusercontent.com/TashanGKD/panshi-ai4s-camp/main/panshi-camp-cli-1.2.3.tgz' },
    { ...manifest, url: 'https://github.com/another/repository/releases/download/cli-v1.2.3/panshi-camp-cli-1.2.3.tgz' },
    { ...manifest, url: 'https://github.com/TashanGKD/panshi-ai4s-camp/releases/download/wrong-tag/panshi-camp-cli-1.2.3.tgz' },
    { ...manifest, assetName: '../panshi-camp-cli-1.2.3.tgz' },
    { ...manifest, assetName: 'panshi-camp-cli-latest.tgz' },
    { ...manifest, sha256: 'a'.repeat(63) },
    { ...manifest, sizeBytes: 0 },
    { ...manifest, sizeBytes: 101 * 1024 * 1024 },
    { ...manifest, version: '../1.2.3' },
  ]
  for (const value of badManifests) assert.throws(() => validateManifest(value), /INSTALLER_MANIFEST_INVALID/u)
  assert.deepEqual(validateManifest(manifest), manifest)
})

test('rejects a download redirect to a non-release githubusercontent host', async (t) => {
  const fixture = await install(t, {
    fetch: async () => response(body, {
      url: 'https://raw.githubusercontent.com/TashanGKD/panshi-ai4s-camp/main/panshi-camp-cli-1.2.3.tgz',
    }),
  })

  await assert.rejects(fixture.run(), /INSTALLER_DOWNLOAD_FAILED/u)
  await assertNoInstallerTemps(fixture.homeDirectory)
})

test('rejects an existing unmanaged stable Unix entry before downloading', async (t) => {
  const fixture = await install(t)
  const binDirectory = join(fixture.homeDirectory, '.local/bin')
  await mkdir(binDirectory, { recursive: true })
  await writeFile(join(binDirectory, 'panshi-camp'), '#!/bin/sh\necho foreign\n')

  await assert.rejects(fixture.run(), /INSTALLER_STABLE_ENTRY_UNMANAGED/u)

  assert.match(await readFile(join(binDirectory, 'panshi-camp'), 'utf8'), /foreign/u)
  assert.equal(fixture.counters.fetch, 0)
})

test('profile merge preserves others, is idempotent for the same URL, and rejects a different URL', () => {
  const original = { profiles: { local: { baseUrl: 'http://127.0.0.1:3001', phoneHint: '1234' } } }
  const merged = mergePanshiProfile(original)
  assert.deepEqual(merged, {
    profiles: {
      local: original.profiles.local,
      panshi: { baseUrl: 'https://panshi-ai4s.tashan.chat' },
    },
  })
  assert.deepEqual(mergePanshiProfile(merged), merged)
  assert.throws(() => mergePanshiProfile({ profiles: { panshi: { baseUrl: 'https://other.example' } } }), /INSTALLER_PROFILE_CONFLICT/u)
})

test('rejects a same-name different-address profile before downloading', async (t) => {
  const fixture = await install(t)
  const configRoot = join(fixture.homeDirectory, '.config/panshi-camp')
  await mkdir(configRoot, { recursive: true, mode: 0o700 })
  await writeFile(join(configRoot, 'config.json'), JSON.stringify({
    profiles: { panshi: { baseUrl: 'https://other.example' } },
  }), { mode: 0o600 })

  await assert.rejects(fixture.run(), /INSTALLER_PROFILE_CONFLICT/u)

  assert.equal(fixture.counters.fetch, 0)
})

test('download failures leave no temporary files or stable entry', async (t) => {
  const fixture = await install(t, { fetch: async () => { throw new Error('network interrupted') } })

  await assert.rejects(fixture.run(), /network interrupted/u)

  await assertNoInstallerTemps(fixture.homeDirectory)
  await assert.rejects(lstat(join(fixture.homeDirectory, '.local/bin/panshi-camp')), { code: 'ENOENT' })
})

test('npm install failures use --ignore-scripts and clean the staging directory', async (t) => {
  let receivedArgs
  const fixture = await install(t, {
    execFile: async (_command, args) => {
      receivedArgs = args
      throw new Error('npm failed')
    },
  })

  await assert.rejects(fixture.run(), /npm failed/u)

  assert.ok(receivedArgs.includes('--ignore-scripts'))
  await assertNoInstallerTemps(fixture.homeDirectory)
  await assert.rejects(lstat(join(fixture.homeDirectory, '.local/share/panshi-camp-cli/1.2.3')), { code: 'ENOENT' })
})

test('successful installation verifies package metadata, writes secure config, and is idempotent', async (t) => {
  const fixture = await install(t)

  const first = await fixture.run()
  const second = await fixture.run()

  assert.equal(first.status, 'installed')
  assert.equal(second.status, 'already-installed')
  assert.equal(fixture.counters.fetch, 1)
  assert.equal(fixture.counters.exec, 1)
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  assert.equal((await lstat(layout.stableEntry)).isSymbolicLink(), true)
  assert.deepEqual(JSON.parse(await readFile(layout.configPath, 'utf8')), {
    profiles: { panshi: { baseUrl: 'https://panshi-ai4s.tashan.chat' } },
  })
  assert.equal((await lstat(join(fixture.homeDirectory, '.config/panshi-camp'))).mode & 0o777, 0o700)
  assert.equal((await lstat(layout.configPath)).mode & 0o777, 0o600)
})

test('package name, version, and bin are verified before switching the stable entry', async (t) => {
  const fixture = await install(t, {
    execFile: async (_command, _args, options) => {
      const packageRoot = join(options.cwd, 'node_modules', manifest.packageName)
      await mkdir(packageRoot, { recursive: true })
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
        name: 'lookalike-package',
        version: manifest.version,
        bin: { 'panshi-camp': './dist/main.js' },
      }))
    },
  })

  await assert.rejects(fixture.run(), /INSTALLER_PACKAGE_INVALID/u)

  await assertNoInstallerTemps(fixture.homeDirectory)
  await assert.rejects(lstat(join(fixture.homeDirectory, '.local/bin/panshi-camp')), { code: 'ENOENT' })
})

test('Windows layout uses win32 semantics and the user-level stable cmd entry', () => {
  const layout = resolveLayout({
    platform: 'win32',
    homeDirectory: 'C:\\Users\\alice',
    localAppData: 'C:\\Users\\alice\\AppData\\Local',
  })
  assert.equal(layout.installRoot, 'C:\\Users\\alice\\AppData\\Local\\panshi-camp-cli')
  assert.equal(layout.stableEntry, 'C:\\Users\\alice\\AppData\\Local\\panshi-camp-cli\\bin\\panshi-camp.cmd')
  assert.equal(layout.configPath, 'C:\\Users\\alice\\.config\\panshi-camp\\config.json')
  assert.equal(win32.isAbsolute(layout.stableEntry), true)
})

test('Windows path safety fails closed when an ancestor has reparse-point attributes', async () => {
  const seen = []
  await assert.rejects(
    assertWindowsPathSafe([
      'C:\\Users\\alice\\AppData\\Local\\panshi-camp-cli',
      'C:\\Users\\alice\\.config\\panshi-camp',
    ], {
      inspect: async (candidate) => {
        seen.push(candidate)
        return { exists: true, reparsePoint: candidate.includes('AppData') }
      },
    }),
    /INSTALLER_WINDOWS_REPARSE_POINT/u,
  )
  assert.ok(seen.some((candidate) => candidate.includes('AppData')))
})

test('Windows CI rejects a real junction ancestor', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'panshi-installer-junction-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const outside = join(root, 'outside')
  const junction = join(root, 'junction')
  await mkdir(outside)
  await symlink(outside, junction, 'junction')

  await assert.rejects(assertWindowsPathSafe([join(junction, 'child')]), /INSTALLER_WINDOWS_REPARSE_POINT/u)
})

test('embedded entry fails safely when the trusted manifest is not published', async (t) => {
  const fixture = await install(t)
  let fetched = false

  await assert.rejects(runEmbeddedInstaller({
    argv: ['--yes'],
    dependencies: {
      ...fixture.dependencies,
      fetch: async () => { fetched = true; return response() },
      readManifest: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error },
    },
  }), /INSTALLER_NOT_PUBLISHED/u)

  assert.equal(fetched, false)
  assert.deepEqual(await readdir(fixture.homeDirectory), [])
})

test('the executable has no URL or SHA environment/argument override hooks', async () => {
  const source = await readFile(new URL('./install-cli.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /process\.env\.(?:.*URL|.*SHA)|--(?:url|sha256|manifest)/iu)
})

test('direct execution without the Task 3 manifest reports not published and creates nothing', async () => {
  const script = new URL('./install-cli.mjs', import.meta.url)
  const result = await execFileAsync(process.execPath, [script.pathname, '--yes'], { encoding: 'utf8' }).catch((error) => error)
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /尚未发布|INSTALLER_NOT_PUBLISHED/u)
})

test('Skill documents preview-first bootstrap and only uses an absolute stable CLI placeholder', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8')
  const installation = await readFile(new URL('../references/installation.md', import.meta.url), 'utf8')
  const combined = `${skill}\n${installation}`

  assert.match(skill, /<PANSHI_CAMP_CLI>/u)
  assert.match(skill, /scripts\/install-cli\.mjs/u)
  assert.match(skill, /--yes/u)
  assert.doesNotMatch(skill, /`panshi-camp(?:\s|`)/u)
  assert.match(installation, /无参数.*预览/su)
  assert.match(installation, /明确同意.*--yes/su)
  assert.match(installation, /\.local\/bin\/panshi-camp/u)
  assert.match(installation, /panshi-camp\.cmd/u)
  assert.doesNotMatch(combined, /github\.com\/[^\s)]+\/releases\/download\//u)
})
