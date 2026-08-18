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

test('packed CLI installs and runs outside the monorepo', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-cli-package-'))
  try {
    const dryRun = await run('npm', ['pack', '--dry-run', '--json', cliRoot])
    const [packReport] = JSON.parse(dryRun.stdout)
    const packedPaths = packReport.files.map(({ path }) => path).sort()

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
    const archive = (await readdir(temporaryRoot)).find((file) => file.endsWith('.tgz'))
    assert.ok(archive, 'npm pack must create a tarball')

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
