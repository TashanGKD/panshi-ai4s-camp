import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '..')
const cliRoot = join(repoRoot, 'apps/cli')
const cliPackage = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const resolveCommandInvocation = (command, args, { platform = process.platform, env = process.env } = {}) => (
  platform === 'win32' && command.toLowerCase().endsWith('.cmd')
    ? {
        command: env.ComSpec || env.COMSPEC || 'cmd.exe',
        args: ['/d', '/s', '/c', command, ...args],
      }
    : { command, args }
)

const run = (command, args, options = {}) => {
  const invocation = resolveCommandInvocation(command, args, { env: options.env ?? process.env })
  return execFileAsync(invocation.command, invocation.args, {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  ...options,
})
}

test('Windows command shims run through ComSpec under Node 24', () => {
  assert.deepEqual(
    resolveCommandInvocation('npm.cmd', ['ci'], {
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    }),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', 'ci'],
    },
  )
  assert.deepEqual(
    resolveCommandInvocation('panshi-camp', ['--version'], { platform: 'linux', env: {} }),
    { command: 'panshi-camp', args: ['--version'] },
  )
})

const createTrackedSourceSnapshot = async (temporaryRoot) => {
  const archivePath = join(temporaryRoot, 'source.tar')
  const extractionRoot = join(temporaryRoot, 'source')

  await run('git', ['archive', '--format=tar', '--output', archivePath, 'HEAD'])
  await mkdir(extractionRoot)
  await run('tar', ['-xf', archivePath, '-C', extractionRoot])

  return extractionRoot
}

test('fresh-source snapshot ignores uncommitted working-tree files', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-head-snapshot-'))
  const sentinelName = `.cli-package-uncommitted-${process.pid}`
  const sentinelPath = join(repoRoot, sentinelName)
  try {
    await writeFile(sentinelPath, 'must not enter the HEAD snapshot\n')
    const sourceRoot = await createTrackedSourceSnapshot(temporaryRoot)

    await assert.rejects(
      readFile(join(sourceRoot, sentinelName)),
      { code: 'ENOENT' },
      'fresh-source snapshot must contain committed HEAD only',
    )
  } finally {
    await rm(sentinelPath, { force: true })
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('tracked source can npm ci and pack the CLI without ignored dist files', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-fresh-source-'))
  try {
    const sourceRoot = await createTrackedSourceSnapshot(temporaryRoot)
    await run(npmCommand, ['ci', '--no-audit', '--no-fund'], { cwd: sourceRoot })
    await assert.rejects(
      readFile(join(sourceRoot, 'packages/camp-client/dist/index.js')),
      { code: 'ENOENT' },
      'npm pack must not rely on the ignored camp-client dist directory',
    )

    const packDestination = join(temporaryRoot, 'packed')
    await mkdir(packDestination)
    await run(npmCommand, ['run', 'build', '-w', 'panshi-camp-cli'], { cwd: sourceRoot })
    const packed = await run(npmCommand, [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      packDestination,
      join(sourceRoot, 'apps/cli'),
    ], { cwd: sourceRoot })
    const [packReport] = JSON.parse(packed.stdout)

    assert.equal(packReport.name, 'panshi-camp-cli')
    assert.equal(packReport.filename, `panshi-camp-cli-${cliPackage.version}.tgz`)
    assert.deepEqual(await readdir(packDestination), [packReport.filename])
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('packed CLI installs and runs outside the monorepo', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-package-'))
  try {
    await run(npmCommand, ['run', 'build', '-w', 'panshi-camp-cli'])
    const dryRun = await run(npmCommand, ['pack', '--ignore-scripts', '--dry-run', '--json', cliRoot])
    const [packReport] = JSON.parse(dryRun.stdout)
    const packedPaths = packReport.files.map(({ path }) => path).sort()

    assert.equal(packReport.name, 'panshi-camp-cli')
    assert.equal(packReport.filename, `panshi-camp-cli-${cliPackage.version}.tgz`)
    assert.deepEqual(packedPaths, [
      'dist/main.js',
      'dist/skill/SKILL.md',
      'dist/skill/capabilities.json',
      'dist/skill/examples/check-status-and-check-in.md',
      'dist/skill/examples/register-and-apply.md',
      'dist/skill/references/installation.md',
      'dist/skill/scripts/install-cli.mjs',
      'package.json',
    ])

    const packedPackage = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'))
    assert.deepEqual(packedPackage.dependencies, { '@napi-rs/keyring': '1.3.0' })
    assert.deepEqual(packedPackage.devDependencies, {
      '@panshi/camp-client': '0.0.0',
      '@panshi/contracts': '0.0.0',
      esbuild: '^0.28.2',
      qr: '0.6.0',
    })
    assert.equal(Object.keys(packedPackage.dependencies).some((name) => name.startsWith('@panshi/')), false)
    assert.ok(!packedPaths.includes('dist/skill/release-manifest.json'), 'the package snapshot must not contain the tracked trust root')
    assert.ok(!packedPaths.some((path) => /(?:^|\/)tests?(?:\/|$)|\.test\./u.test(path)), 'the package must not contain tests')
    const sourceManifest = JSON.parse(await readFile(join(repoRoot, 'skills/panshi-camp/release-manifest.json'), 'utf8'))
    assert.equal(sourceManifest.packageName, cliPackage.name)
    assert.equal(sourceManifest.version, cliPackage.version)

    await run(npmCommand, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot, cliRoot])
    const archive = `panshi-camp-cli-${cliPackage.version}.tgz`
    assert.ok((await readdir(temporaryRoot)).includes(archive), 'npm pack must create the exact tarball')

    const installationRoot = join(temporaryRoot, 'installation')
    await mkdir(installationRoot)
    await run(npmCommand, [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      join(temporaryRoot, archive),
    ], { cwd: installationRoot })

    for (const internalPackage of ['camp-client', 'contracts']) {
      await assert.rejects(
        readFile(join(installationRoot, 'node_modules/@panshi', internalPackage, 'package.json')),
        { code: 'ENOENT' },
      )
    }
    const executable = join(installationRoot, `node_modules/.bin/panshi-camp${process.platform === 'win32' ? '.cmd' : ''}`)
    const isolatedEnvironment = {
      ...process.env,
      HOME: join(temporaryRoot, 'empty-home'),
      XDG_CONFIG_HOME: join(temporaryRoot, 'empty-config'),
    }

    const noArguments = await run(executable, [], { cwd: temporaryRoot, env: isolatedEnvironment })
    assert.match(noArguments.stdout, /用法：panshi-camp/u)
    assert.equal(noArguments.stderr, '')

    const help = await run(executable, ['--help'], { cwd: temporaryRoot, env: isolatedEnvironment })
    assert.match(help.stdout, /用法：panshi-camp/u)
    assert.equal(help.stderr, '')

    const version = await run(executable, ['--version'], { cwd: temporaryRoot, env: isolatedEnvironment })
    assert.equal(version.stdout, `${cliPackage.version}\n`)
    assert.equal(version.stderr, '')
    assert.equal(basename(executable), process.platform === 'win32' ? 'panshi-camp.cmd' : 'panshi-camp')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
