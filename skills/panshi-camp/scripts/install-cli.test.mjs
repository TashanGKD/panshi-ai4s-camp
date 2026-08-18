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
  readlink,
  readdir,
  rename,
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
  computePackageTreeSha256,
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
const packageJsonContents = JSON.stringify({
  name: 'panshi-camp-cli',
  version: '1.2.3',
  bin: { 'panshi-camp': './dist/main.js' },
})
const mainContents = '#!/usr/bin/env node\n'
const packageTreeDigest = (overrides = {}) => {
  const files = [
    ['dist/main.js', overrides.mainContents ?? mainContents],
    ['package.json', overrides.packageJsonContents ?? packageJsonContents],
  ].map(([path, contents]) => ({
    path,
    size: Buffer.byteLength(contents),
    sha256: createHash('sha256').update(contents).digest('hex'),
  }))
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}
const manifest = Object.freeze({
  schemaVersion: 1,
  packageName: 'panshi-camp-cli',
  version: '1.2.3',
  assetName: 'panshi-camp-cli-1.2.3.tgz',
  url: 'https://github.com/TashanGKD/panshi-ai4s-camp/releases/download/cli-v1.2.3/panshi-camp-cli-1.2.3.tgz',
  sha256: digest,
  sizeBytes: body.length,
  packageTreeSha256: packageTreeDigest(),
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
  await writeFile(join(packageRoot, 'package.json'), packageJsonContents)
  await writeFile(join(packageRoot, 'dist/main.js'), mainContents)
  await chmod(join(packageRoot, 'dist/main.js'), 0o755)
  await writeFile(join(binRoot, 'panshi-camp'), '#!/bin/sh\n')
  await chmod(join(binRoot, 'panshi-camp'), 0o755)
}

const install = async (t, overrides = {}) => {
  const sandbox = await makeSandbox(t)
  let fetchCalls = 0
  let execCalls = 0
  const stdout = []
  const stderr = []
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
    stderr: (text) => stderr.push(text),
    ...overrides,
  }
  return {
    ...sandbox,
    dependencies,
    counters: { get fetch() { return fetchCalls }, get exec() { return execCalls } },
    stdout,
    stderr,
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
    { ...manifest, packageTreeSha256: 'a'.repeat(63) },
    { ...manifest, sizeBytes: 0 },
    { ...manifest, sizeBytes: 101 * 1024 * 1024 },
    { ...manifest, version: '../1.2.3' },
  ]
  for (const value of badManifests) assert.throws(() => validateManifest(value), /INSTALLER_MANIFEST_INVALID/u)
  assert.deepEqual(validateManifest(manifest), manifest)
})

test('requires the trusted manifest package tree digest', () => {
  const withoutPackageTree = { ...manifest }
  delete withoutPackageTree.packageTreeSha256
  assert.throws(() => validateManifest(withoutPackageTree), /INSTALLER_MANIFEST_INVALID/u)
  assert.equal(validateManifest(manifest).packageTreeSha256, packageTreeDigest())
})

test('package tree digest uses reusable UTF-8 byte path ordering', async (t) => {
  const fixture = await makeSandbox(t)
  const packageRoot = join(fixture.root, 'package')
  await mkdir(join(packageRoot, 'a'), { recursive: true })
  const files = [
    ['a/x.txt', 'nested\n'],
    ['a-z.txt', 'sibling\n'],
    ['z.txt', 'ascii\n'],
    ['ä.txt', 'unicode\n'],
  ]
  for (const [relativePath, contents] of files) await writeFile(join(packageRoot, relativePath), contents)
  const entries = files
    .map(([relativePath, contents]) => ({
      path: relativePath,
      size: Buffer.byteLength(contents),
      sha256: createHash('sha256').update(contents).digest('hex'),
    }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')))
  const expected = createHash('sha256').update(JSON.stringify(entries)).digest('hex')

  assert.equal(await computePackageTreeSha256(packageRoot), expected)
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

test('validates every redirect before fetching the next hop', async (t) => {
  const fetchedUrls = []
  const fixture = await install(t, {
    fetch: async (url, options) => {
      fetchedUrls.push(String(url))
      assert.equal(options.redirect, 'manual')
      return {
        ok: false,
        status: 302,
        headers: { get: (name) => name.toLowerCase() === 'location' ? 'https://evil.example/payload.tgz' : null },
        body: null,
      }
    },
  })

  await assert.rejects(fixture.run(), /INSTALLER_DOWNLOAD_FAILED/u)
  assert.deepEqual(fetchedUrls, [manifest.url])
})

test('follows only bounded credential-free HTTPS redirects on allowed hosts', async (t) => {
  const fetchedUrls = []
  const redirected = 'https://release-assets.githubusercontent.com/pinned/panshi-camp-cli-1.2.3.tgz'
  const fixture = await install(t, {
    fetch: async (url, options) => {
      fetchedUrls.push(String(url))
      assert.equal(options.redirect, 'manual')
      if (String(url) === manifest.url) {
        return { ok: false, status: 302, headers: { get: (name) => name.toLowerCase() === 'location' ? redirected : null }, body: null }
      }
      return response(body, { url: redirected })
    },
  })

  await fixture.run()
  assert.deepEqual(fetchedUrls, [manifest.url, redirected])
})

test('rejects redirect credentials and redirect loops without contacting an unvalidated hop', async (t) => {
  const credentialUrls = []
  const credentialFixture = await install(t, {
    fetch: async (url) => {
      credentialUrls.push(String(url))
      return { ok: false, status: 302, headers: { get: () => 'https://user:pass@release-assets.githubusercontent.com/payload.tgz' }, body: null }
    },
  })
  await assert.rejects(credentialFixture.run(), /INSTALLER_DOWNLOAD_FAILED/u)
  assert.deepEqual(credentialUrls, [manifest.url])

  let loopCalls = 0
  const loopFixture = await install(t, {
    fetch: async () => {
      loopCalls += 1
      return { ok: false, status: 302, headers: { get: () => manifest.url }, body: null }
    },
  })
  await assert.rejects(loopFixture.run(), /INSTALLER_DOWNLOAD_FAILED/u)
  assert.equal(loopCalls, 6)
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

test('failure cleanup preserves a real replacement at the staging path', async (t) => {
  let movedStagingRoot
  let replacementSentinel
  const fixture = await install(t, {
    execFile: async (...args) => {
      const options = args[2]
      await fakeNpmInstall(...args)
      movedStagingRoot = join(fixture.root, 'moved-transaction-staging')
      replacementSentinel = join(options.cwd, 'replacement-sentinel')
      await rename(options.cwd, movedStagingRoot)
      await mkdir(options.cwd)
      await writeFile(replacementSentinel, 'staging replacement must survive\n')
    },
  })

  await assert.rejects(fixture.run(), /INSTALLER_PACKAGE_INVALID/u)

  assert.equal(await readFile(replacementSentinel, 'utf8'), 'staging replacement must survive\n')
  assert.equal(await readFile(join(movedStagingRoot, 'node_modules/panshi-camp-cli/dist/main.js'), 'utf8'), mainContents)
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
  assert.equal(await readlink(layout.stableEntry), '../share/panshi-camp-cli/1.2.3/node_modules/panshi-camp-cli/dist/main.js')
  assert.deepEqual(JSON.parse(await readFile(layout.configPath, 'utf8')), {
    profiles: { panshi: { baseUrl: 'https://panshi-ai4s.tashan.chat' } },
  })
  assert.equal((await lstat(join(fixture.homeDirectory, '.config/panshi-camp'))).mode & 0o777, 0o700)
  assert.equal((await lstat(layout.configPath)).mode & 0o777, 0o600)
})

for (const mutation of [
  ['modified entry', async (root) => writeFile(join(root, 'node_modules/panshi-camp-cli/dist/main.js'), 'tampered\n')],
  ['deleted package metadata', async (root) => rm(join(root, 'node_modules/panshi-camp-cli/package.json'))],
  ['added file', async (root) => writeFile(join(root, 'unexpected.txt'), 'surprise')],
]) {
  test(`same-version reinstall rejects a ${mutation[0]} from the recorded tree inventory`, async (t) => {
    const fixture = await install(t)
    await fixture.run()
    const versionRoot = join(fixture.homeDirectory, '.local/share/panshi-camp-cli', manifest.version)
    await mutation[1](versionRoot)

    await assert.rejects(fixture.run(), /INSTALLER_VERSION_CONFLICT/u)
    assert.equal(fixture.counters.fetch, 1)
  })
}

test('same-version reuse rejects a forged marker that matches a tampered CLI package tree', async (t) => {
  const fixture = await install(t)
  await fixture.run()
  const versionRoot = join(fixture.homeDirectory, '.local/share/panshi-camp-cli', manifest.version)
  const markerPath = join(versionRoot, '.panshi-camp-install.json')
  const tamperedMain = 'tampered by same-user attacker\n'
  await writeFile(join(versionRoot, 'node_modules/panshi-camp-cli/dist/main.js'), tamperedMain)
  const marker = JSON.parse(await readFile(markerPath, 'utf8'))
  const mainEntry = marker.entries.find((entry) => entry.path === 'node_modules/panshi-camp-cli/dist/main.js')
  mainEntry.size = Buffer.byteLength(tamperedMain)
  mainEntry.sha256 = createHash('sha256').update(tamperedMain).digest('hex')
  marker.treeSha256 = createHash('sha256').update(JSON.stringify(marker.entries)).digest('hex')
  marker.packageTreeSha256 = packageTreeDigest({ mainContents: tamperedMain })
  await writeFile(markerPath, `${JSON.stringify(marker)}\n`)

  await assert.rejects(fixture.run(), /INSTALLER_VERSION_CONFLICT/u)
  assert.equal(fixture.counters.fetch, 1)
})

test('rejects a package whose declared executable target is missing or not executable', async (t) => {
  const fixture = await install(t, {
    execFile: async (_command, _args, options) => {
      const packageRoot = join(options.cwd, 'node_modules', manifest.packageName)
      await mkdir(join(packageRoot, 'dist'), { recursive: true })
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
        name: manifest.packageName,
        version: manifest.version,
        bin: { 'panshi-camp': './dist/main.js' },
      }))
      await writeFile(join(packageRoot, 'dist/main.js'), '#!/usr/bin/env node\n', { mode: 0o600 })
    },
  })

  await assert.rejects(fixture.run(), /INSTALLER_PACKAGE_INVALID/u)
})

test('preserves an existing shared 0755 bin directory', async (t) => {
  const fixture = await install(t)
  const binDirectory = join(fixture.homeDirectory, '.local/bin')
  await mkdir(binDirectory, { recursive: true, mode: 0o755 })

  await fixture.run()

  assert.equal((await lstat(binDirectory)).mode & 0o777, 0o755)
})

test('rejects an existing Unix HOME not owned by the configured current uid before network', async (t) => {
  const fixture = await install(t, { currentUid: process.getuid() + 1 })

  await assert.rejects(fixture.run(), /INSTALLER_PATH_NOT_OWNED/u)
  assert.equal(fixture.counters.fetch, 0)
})

for (const failpoint of ['bin-ready', 'stable-entry-after-swap', 'config-before-swap']) {
  test(`rolls back version, stable entry, and config when ${failpoint} fails`, async (t) => {
    const fixture = await install(t)
    const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
    const oldVersionRoot = join(layout.installRoot, '1.2.2')
    const oldEntry = '../share/panshi-camp-cli/1.2.2/node_modules/panshi-camp-cli/dist/main.js'
    await mkdir(join(oldVersionRoot, 'node_modules/panshi-camp-cli/dist'), { recursive: true, mode: 0o700 })
    await writeFile(join(oldVersionRoot, 'node_modules/panshi-camp-cli/dist/main.js'), '#!/usr/bin/env node\n', { mode: 0o755 })
    await mkdir(layout.binDirectory, { recursive: true, mode: 0o755 })
    await symlink(oldEntry, layout.stableEntry)
    await mkdir(layout.configDirectory, { recursive: true, mode: 0o700 })
    const originalConfig = '{"profiles":{"local":{"baseUrl":"http://127.0.0.1:3001"}},"formatVersion":7}\n'
    await writeFile(layout.configPath, originalConfig, { mode: 0o600 })
    fixture.dependencies.failpoint = async (name) => {
      if (name === failpoint) throw new Error(`injected ${failpoint}`)
    }

    await assert.rejects(fixture.run(), new RegExp(`injected ${failpoint}`))

    await assert.rejects(lstat(join(layout.installRoot, manifest.version)), { code: 'ENOENT' })
    assert.equal(await readlink(layout.stableEntry), oldEntry)
    assert.equal(await readFile(layout.configPath, 'utf8'), originalConfig)
  })
}

test('runs a parent-path safety recheck after each rename/swap', async (t) => {
  const checks = []
  const fixture = await install(t, { afterSwapCheck: async (name) => { checks.push(name) } })

  await fixture.run()

  assert.deepEqual(checks, ['version', 'stable-entry', 'config'])
})

test('revalidates the complete version inventory after the version rename', async (t) => {
  let fixture
  fixture = await install(t, {
    afterSwapCheck: async (name) => {
      if (name === 'version') {
        await writeFile(join(fixture.homeDirectory, '.local/share/panshi-camp-cli', manifest.version, 'post-swap-injection'), 'tampered')
      }
    },
  })

  await assert.rejects(fixture.run(), /INSTALLER_VERSION_CONFLICT/u)
  await assert.rejects(lstat(join(fixture.homeDirectory, '.local/share/panshi-camp-cli', manifest.version)), { code: 'ENOENT' })
})

test('final verification rejects a config-after-swap version-root symlink and fully rolls back', async (t) => {
  const fixture = await install(t)
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  const oldVersionRoot = join(layout.installRoot, '1.2.2')
  const oldEntry = '../share/panshi-camp-cli/1.2.2/node_modules/panshi-camp-cli/dist/main.js'
  await mkdir(join(oldVersionRoot, 'node_modules/panshi-camp-cli/dist'), { recursive: true, mode: 0o700 })
  await writeFile(join(oldVersionRoot, 'node_modules/panshi-camp-cli/dist/main.js'), mainContents, { mode: 0o755 })
  await mkdir(layout.binDirectory, { recursive: true, mode: 0o755 })
  await symlink(oldEntry, layout.stableEntry)
  await mkdir(layout.configDirectory, { recursive: true, mode: 0o700 })
  const originalConfig = '{"profiles":{"local":{"baseUrl":"http://127.0.0.1:3001"}},"formatVersion":7}\n'
  await writeFile(layout.configPath, originalConfig, { mode: 0o600 })
  const outside = join(fixture.root, 'outside-final-swap')
  await mkdir(outside)
  await writeFile(join(outside, 'sentinel'), 'keep')
  fixture.dependencies.afterSwapCheck = async (name) => {
    if (name !== 'config') return
    const versionRoot = join(layout.installRoot, manifest.version)
    await rm(versionRoot, { recursive: true })
    await symlink(outside, versionRoot)
  }

  await assert.rejects(fixture.run(), /INSTALLER_(?:PATH_UNSAFE|VERSION_CONFLICT)/u)

  const replacement = join(layout.installRoot, manifest.version)
  assert.equal((await lstat(replacement)).isSymbolicLink(), true)
  assert.equal(await readlink(replacement), outside)
  assert.equal(await readlink(layout.stableEntry), oldEntry)
  assert.equal(await readFile(layout.configPath, 'utf8'), originalConfig)
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'keep')
})

test('rollback preserves a real replacement when the fresh version directory identity changed', async (t) => {
  const fixture = await install(t)
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  const versionRoot = join(layout.installRoot, manifest.version)
  const movedTransactionRoot = join(fixture.root, 'moved-transaction-version')
  const sentinel = join(versionRoot, 'replacement-sentinel')
  fixture.dependencies.afterSwapCheck = async (name) => {
    if (name !== 'config') return
    await rename(versionRoot, movedTransactionRoot)
    await mkdir(versionRoot)
    await writeFile(sentinel, 'replacement must survive\n')
  }

  await assert.rejects(fixture.run(), (error) => error?.code === 'INSTALLER_VERSION_CONFLICT')

  assert.equal(await readFile(sentinel, 'utf8'), 'replacement must survive\n')
  assert.equal((await lstat(movedTransactionRoot)).isDirectory(), true)
  assert.equal(await readFile(join(movedTransactionRoot, 'node_modules/panshi-camp-cli/dist/main.js'), 'utf8'), mainContents)
})

test('final verification rejects a config-after-swap config symlink without touching its target', async (t) => {
  const fixture = await install(t)
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  const outside = join(fixture.root, 'outside-config.json')
  await writeFile(outside, 'outside must survive\n')
  fixture.dependencies.failpoint = async (name) => {
    if (name !== 'config-after-swap') return
    await rm(layout.configPath)
    await symlink(outside, layout.configPath)
  }

  await assert.rejects(fixture.run(), /INSTALLER_PATH_UNSAFE/u)

  assert.equal(await readFile(outside, 'utf8'), 'outside must survive\n')
  assert.equal((await lstat(layout.configPath)).isSymbolicLink(), true)
  assert.equal(await readlink(layout.configPath), outside)
  await assert.rejects(lstat(join(layout.installRoot, manifest.version)), { code: 'ENOENT' })
})

test('final verification rejects config-directory permission drift after the config swap', async (t) => {
  const fixture = await install(t, {
    failpoint: async (name) => {
      if (name === 'config-after-swap') await chmod(join(fixture.homeDirectory, '.config/panshi-camp'), 0o755)
    },
  })
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })

  await assert.rejects(fixture.run(), /INSTALLER_CONFIG_PERMISSIONS_UNSAFE/u)

  await assert.rejects(lstat(join(layout.installRoot, manifest.version)), { code: 'ENOENT' })
})

test('backup cleanup failure is best effort after final state confirmation', async (t) => {
  const fixture = await install(t, { backupCleanup: () => { throw new Error('reviewer-shaped backup cleanup failure') } })
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  const oldVersionRoot = join(layout.installRoot, '1.2.2')
  await mkdir(join(oldVersionRoot, 'node_modules/panshi-camp-cli/dist'), { recursive: true, mode: 0o700 })
  await writeFile(join(oldVersionRoot, 'node_modules/panshi-camp-cli/dist/main.js'), mainContents, { mode: 0o755 })
  await mkdir(layout.binDirectory, { recursive: true, mode: 0o755 })
  await symlink('../share/panshi-camp-cli/1.2.2/node_modules/panshi-camp-cli/dist/main.js', layout.stableEntry)
  await mkdir(layout.configDirectory, { recursive: true, mode: 0o700 })
  await writeFile(layout.configPath, '{"profiles":{"local":{"baseUrl":"http://127.0.0.1:3001"}}}\n', { mode: 0o600 })

  const result = await fixture.run()

  assert.equal(result.status, 'installed')
  assert.equal(await readlink(layout.stableEntry), '../share/panshi-camp-cli/1.2.3/node_modules/panshi-camp-cli/dist/main.js')
  assert.deepEqual(JSON.parse(await readFile(layout.configPath, 'utf8')), {
    profiles: {
      local: { baseUrl: 'http://127.0.0.1:3001' },
      panshi: { baseUrl: 'https://panshi-ai4s.tashan.chat' },
    },
  })
  assert.equal((await lstat(join(layout.installRoot, manifest.version))).isDirectory(), true)
  assert.equal((await readdir(layout.binDirectory)).some((name) => name.includes('.backup-')), true)
  assert.equal((await readdir(layout.configDirectory)).some((name) => name.includes('.backup-')), true)
  assert.deepEqual(result.warnings.map(({ code }) => code), [
    'INSTALLER_BACKUP_CLEANUP_FAILED',
    'INSTALLER_BACKUP_CLEANUP_FAILED',
  ])
  assert.ok(result.warnings.every(({ path, message }) => path.includes('.backup-') && message.includes('备份已保留')))
  assert.equal(fixture.stderr.length, 2)
  assert.ok(fixture.stderr.every((line) => line.includes('INSTALLER_BACKUP_CLEANUP_FAILED')))
})

test('durable commit survives a later backup warning whose stderr sink throws', async (t) => {
  let cleanupCalls = 0
  const fixture = await install(t, {
    backupCleanup: async (candidate) => {
      cleanupCalls += 1
      if (cleanupCalls === 1) return rm(candidate, { force: true })
      throw new Error('entry backup cleanup failed after config backup was removed')
    },
    stderr: () => { throw new Error('warning sink failed') },
  })
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  await mkdir(layout.binDirectory, { recursive: true, mode: 0o755 })
  await symlink('../share/panshi-camp-cli/1.2.2/node_modules/panshi-camp-cli/dist/main.js', layout.stableEntry)
  await mkdir(layout.configDirectory, { recursive: true, mode: 0o700 })
  await writeFile(layout.configPath, '{"profiles":{"local":{"baseUrl":"http://127.0.0.1:3001"}}}\n', { mode: 0o600 })

  const result = await fixture.run()

  assert.equal(result.status, 'installed')
  assert.equal(cleanupCalls, 2)
  assert.deepEqual(result.warnings.map(({ code }) => code), ['INSTALLER_BACKUP_CLEANUP_FAILED'])
  assert.equal(await readlink(layout.stableEntry), '../share/panshi-camp-cli/1.2.3/node_modules/panshi-camp-cli/dist/main.js')
  assert.deepEqual(JSON.parse(await readFile(layout.configPath, 'utf8')), {
    profiles: {
      local: { baseUrl: 'http://127.0.0.1:3001' },
      panshi: { baseUrl: 'https://panshi-ai4s.tashan.chat' },
    },
  })
})

test('quarantine preserves a real directory swapped into the version cleanup window', async (t) => {
  const fixture = await install(t, {
    failpoint: async (name) => { if (name === 'config-after-swap') throw new Error('primary finalization failure') },
  })
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  const versionRoot = join(layout.installRoot, manifest.version)
  const movedTransaction = join(fixture.root, 'moved-version-transaction')
  const sentinel = join(versionRoot, 'replacement-sentinel')
  let injected = false
  fixture.dependencies.beforeQuarantineRename = async ({ candidate, kind }) => {
    if (candidate !== versionRoot || kind !== 'directory') return
    injected = true
    await rename(versionRoot, movedTransaction)
    await mkdir(versionRoot)
    await writeFile(sentinel, 'directory replacement survives\n')
  }

  await assert.rejects(fixture.run(), /primary finalization failure/u)

  assert.equal(injected, true)
  assert.equal(await readFile(sentinel, 'utf8'), 'directory replacement survives\n')
  assert.equal((await lstat(movedTransaction)).isDirectory(), true)
})

test('quarantine preserves a symlink swapped into the stable-entry rollback window', async (t) => {
  const fixture = await install(t, {
    failpoint: async (name) => { if (name === 'stable-entry-after-swap') throw new Error('primary stable failure') },
  })
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  await mkdir(layout.binDirectory, { recursive: true, mode: 0o755 })
  const oldTarget = '../share/panshi-camp-cli/1.2.2/node_modules/panshi-camp-cli/dist/main.js'
  const replacementTarget = '../replacement-must-survive'
  const movedTransaction = join(fixture.root, 'moved-stable-transaction')
  await symlink(oldTarget, layout.stableEntry)
  let injected = false
  fixture.dependencies.beforeQuarantineRename = async ({ candidate, kind }) => {
    if (candidate !== layout.stableEntry || kind !== 'symlink') return
    injected = true
    await rename(layout.stableEntry, movedTransaction)
    await symlink(replacementTarget, layout.stableEntry)
  }

  await assert.rejects(fixture.run(), /primary stable failure/u)

  assert.equal(injected, true)
  assert.equal(await readlink(layout.stableEntry), replacementTarget)
  assert.equal((await lstat(movedTransaction)).isSymbolicLink(), true)
})

test('quarantine preserves a regular file swapped into the config rollback window', async (t) => {
  const fixture = await install(t, {
    failpoint: async (name) => { if (name === 'config-after-swap') throw new Error('primary config failure') },
  })
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  await mkdir(layout.configDirectory, { recursive: true, mode: 0o700 })
  await writeFile(layout.configPath, '{"profiles":{"old":{"baseUrl":"http://localhost:3001"}}}\n', { mode: 0o600 })
  const movedTransaction = join(fixture.root, 'moved-config-transaction')
  const replacement = 'replacement config must survive\n'
  let injected = false
  fixture.dependencies.beforeQuarantineRename = async ({ candidate, kind }) => {
    if (candidate !== layout.configPath || kind !== 'file') return
    injected = true
    await rename(layout.configPath, movedTransaction)
    await writeFile(layout.configPath, replacement, { mode: 0o600 })
  }

  await assert.rejects(fixture.run(), /primary config failure/u)

  assert.equal(injected, true)
  assert.equal(await readFile(layout.configPath, 'utf8'), replacement)
  assert.equal((await lstat(movedTransaction)).isFile(), true)
})

test('later failure removes only installer-created empty roots', async (t) => {
  const fixture = await install(t, {
    failpoint: async (name) => { if (name === 'config-after-swap') throw new Error('late failure') },
  })
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })

  await assert.rejects(fixture.run(), /late failure/u)

  for (const directory of [layout.installRoot, layout.binDirectory, layout.configDirectory]) {
    await assert.rejects(lstat(directory), { code: 'ENOENT' })
  }
})

test('later failure preserves pre-existing roots and their permissions', async (t) => {
  const fixture = await install(t, {
    failpoint: async (name) => { if (name === 'config-after-swap') throw new Error('late failure') },
  })
  const layout = resolveLayout({ platform: 'linux', homeDirectory: fixture.homeDirectory })
  await mkdir(layout.installRoot, { recursive: true, mode: 0o755 })
  await mkdir(layout.binDirectory, { recursive: true, mode: 0o751 })
  await mkdir(layout.configDirectory, { recursive: true, mode: 0o700 })

  await assert.rejects(fixture.run(), /late failure/u)

  assert.equal((await lstat(layout.installRoot)).mode & 0o777, 0o755)
  assert.equal((await lstat(layout.binDirectory)).mode & 0o777, 0o751)
  assert.equal((await lstat(layout.configDirectory)).mode & 0o777, 0o700)
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

test('profile merge normalizes equivalent URLs, preserves compatible top-level fields, and rejects nested secrets', () => {
  const original = {
    formatVersion: 7,
    profiles: {
      local: { baseUrl: 'http://localhost:3001/' },
      panshi: { baseUrl: 'https://panshi-ai4s.tashan.chat///' },
    },
  }
  assert.deepEqual(mergePanshiProfile(original), {
    formatVersion: 7,
    profiles: {
      local: { baseUrl: 'http://localhost:3001' },
      panshi: { baseUrl: 'https://panshi-ai4s.tashan.chat' },
    },
  })
  assert.throws(() => mergePanshiProfile({
    profiles: { local: { baseUrl: 'http://localhost:3001' } },
    compatibility: { nested: [{ verification_code: 'should-never-be-in-config' }] },
  }), /INSTALLER_CONFIG_SECRET_FORBIDDEN/u)
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

test('Windows real-junction probe (Task4 will add CI; unverified until then)', { skip: process.platform !== 'win32' }, async (t) => {
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
  assert.match(installation, /Task 4 将加入 Windows CI；加入前未验证/u)
  assert.match(installation, /同一用户.*返回后.*改写/u)
  const requiredOrder = [
    '无参数运行安装器',
    '读取预览中的 requiredVersion',
    '判断稳定入口是否存在',
    '运行稳定入口的 --version',
    '版本一致则直接继续',
    '不存在或版本不一致时，完整展示预览并询问用户',
    '用户明确同意后运行 --yes',
  ]
  let cursor = -1
  for (const sentence of requiredOrder) {
    const next = installation.indexOf(sentence)
    assert.ok(next > cursor, `missing or out-of-order bootstrap sentence: ${sentence}`)
    cursor = next
  }
  assert.doesNotMatch(combined, /停止询问/u)
})
