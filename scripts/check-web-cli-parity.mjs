import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const fields = ['roles', 'phase', 'effect', 'confirmation']
const label = { web: 'WEB', cli: 'CLI', skill: 'SKILL' }

const duplicates = (items) => {
  const seen = new Set(); const repeated = new Set()
  for (const { id } of items) { if (seen.has(id)) repeated.add(id); seen.add(id) }
  return [...repeated]
}

export const checkParity = ({ canonical, web, cli, skill }) => {
  const errors = new Set()
  for (const items of [canonical, web, cli, skill]) for (const id of duplicates(items)) errors.add(`DUPLICATE_CAPABILITY_ID ${id}`)
  for (const { id } of skill) if (id.startsWith('admin.')) errors.add(`LEARNER_SKILL_REFERENCES_ADMIN_CAPABILITY ${id}`)
  const canonicalMap = new Map(canonical.map((item) => [item.id, item]))
  for (const [channel, items] of Object.entries({ web, cli, skill })) {
    const itemMap = new Map(items.map((item) => [item.id, item]))
    for (const id of canonicalMap.keys()) if (!itemMap.has(id)) errors.add(`${label[channel]}_MISSING_CAPABILITY ${id}`)
    for (const id of itemMap.keys()) if (!canonicalMap.has(id) && !id.startsWith('admin.')) errors.add(`${label[channel]}_UNKNOWN_CAPABILITY ${id}`)
    for (const [id, expected] of canonicalMap) {
      const actual = itemMap.get(id); if (!actual) continue
      for (const field of fields) {
        const left = JSON.stringify(field === 'roles' ? [...expected[field]].sort() : expected[field])
        const right = JSON.stringify(field === 'roles' ? [...actual[field]].sort() : actual[field])
        if (left !== right) errors.add(`${field === 'confirmation' ? 'CONFIRMATION_LEVEL' : field.toUpperCase()}_MISMATCH ${id}`)
      }
    }
  }
  return [...errors].sort()
}

const commandJson = (command, args) => {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8', env: process.env })
  if (result.error) throw new Error(`${command} ${args.join(' ')} failed to start\n${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr}`)
  try { return JSON.parse(result.stdout) } catch { throw new Error(`Invalid JSON from ${command} ${args.join(' ')}\n${result.stdout}`) }
}

export const npmInvocation = ({ execPath = process.execPath, npmExecPath = process.env.npm_execpath } = {}) => {
  if (!npmExecPath) throw new Error('npm_execpath is required; run parity through npm run test:parity')
  return [execPath, [npmExecPath, 'run', 'capabilities:json', '-w', '@panshi/web', '--silent']]
}

export const loadRepositoryParityInputs = async () => {
  const { learnerCapabilities } = await import('../packages/contracts/dist/index.js')
  const canonical = learnerCapabilities.map(({ id, roles, phase, effect, confirmation }) => ({ id, roles, phase, effect, confirmation }))
  const [npmCommand, npmArgs] = npmInvocation()
  const web = commandJson(npmCommand, npmArgs)
  const cli = commandJson(process.execPath, ['apps/cli/dist/main.js', '--json', 'internal', 'capabilities'])
  const skill = JSON.parse(await readFile(new URL('../skills/panshi-camp/capabilities.json', import.meta.url), 'utf8'))
  return { canonical, web, cli, skill }
}

const main = async () => {
  const errors = checkParity(await loadRepositoryParityInputs())
  if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; return }
  process.stdout.write('web-cli-skill parity ok\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) await main()
