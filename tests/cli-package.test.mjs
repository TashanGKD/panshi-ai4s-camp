import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '..')
const cliRoot = join(repoRoot, 'apps/cli')
const cliPackage = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'))

const run = (command, args, options = {}) => execFileAsync(command, args, {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  ...options,
})

const createTrackedSourceSnapshot = async (temporaryRoot) => {
  const indexPath = join(temporaryRoot, 'git-index')
  const archivePath = join(temporaryRoot, 'source.tar')
  const extractionRoot = join(temporaryRoot, 'source')
  const gitEnvironment = { ...process.env, GIT_INDEX_FILE: indexPath }

  await run('git', ['read-tree', 'HEAD'], { env: gitEnvironment })
  await run('git', ['add', '--all'], { env: gitEnvironment })
  const { stdout: treeOutput } = await run('git', ['write-tree'], { env: gitEnvironment })
  await run('git', ['archive', '--format=tar', '--output', archivePath, treeOutput.trim()])
  await mkdir(extractionRoot)
  await run('tar', ['-xf', archivePath, '-C', extractionRoot])

  return extractionRoot
}

test('tracked source can npm ci and pack the CLI without ignored dist files', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-fresh-source-'))
  try {
    const sourceRoot = await createTrackedSourceSnapshot(temporaryRoot)
    await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: sourceRoot })
    await assert.rejects(
      readFile(join(sourceRoot, 'packages/camp-client/dist/index.js')),
      { code: 'ENOENT' },
      'npm pack must not rely on the ignored camp-client dist directory',
    )

    const packDestination = join(temporaryRoot, 'packed')
    await mkdir(packDestination)
    const packed = await run('npm', [
      'pack',
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
    const dryRun = await run('npm', ['pack', '--dry-run', '--json', cliRoot])
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

    await run('npm', ['pack', '--json', '--pack-destination', temporaryRoot, cliRoot])
    const archive = `panshi-camp-cli-${cliPackage.version}.tgz`
    assert.ok((await readdir(temporaryRoot)).includes(archive), 'npm pack must create the exact tarball')

    const installationRoot = join(temporaryRoot, 'installation')
    await mkdir(installationRoot)
    await run('npm', [
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
    const executable = join(installationRoot, 'node_modules/.bin/panshi-camp')
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
    assert.equal(basename(executable), 'panshi-camp')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
