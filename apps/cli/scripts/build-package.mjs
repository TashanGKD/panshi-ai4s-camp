import { chmod, cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(cliRoot, '../..')
const distRoot = join(cliRoot, 'dist')
const entryPoint = join(cliRoot, 'src/main.ts')
const outputFile = join(distRoot, 'main.js')
const skillSource = join(repositoryRoot, 'skills/panshi-camp')
const skillOutput = join(distRoot, 'skill')
const internalSourceAliases = {
  '@panshi/camp-client': join(repositoryRoot, 'packages/camp-client/src/index.ts'),
  '@panshi/contracts': join(repositoryRoot, 'packages/contracts/src/index.ts'),
}

await rm(distRoot, { recursive: true, force: true })
await mkdir(distRoot, { recursive: true })
await build({
  entryPoints: [entryPoint],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['@napi-rs/keyring'],
  alias: internalSourceAliases,
  legalComments: 'none',
  sourcemap: false,
})
await chmod(outputFile, 0o755)
await cp(skillSource, skillOutput, { recursive: true, errorOnExist: true, force: false })
