import assert from 'node:assert/strict'
import { checkParity } from './check-web-cli-parity.mjs'

const capability = (id, effect = 'read', confirmation = 'none') => ({ id, roles: ['user'], phase: 'learner-v1', effect, confirmation })
const canonical = [
  capability('public.schedule.list'), capability('application.submit', 'write', 'single'),
  capability('file.delete', 'delete', 'double'), capability('resource.download'),
]
const clone = (value) => JSON.parse(JSON.stringify(value))
const complete = () => ({ canonical: clone(canonical), web: clone(canonical), cli: clone(canonical), skill: clone(canonical) })
const expectError = (mutate, expected) => {
  const fixture = complete(); mutate(fixture)
  const errors = checkParity(fixture)
  assert(errors.includes(expected), `${expected}\nreceived: ${errors.join('\n')}`)
  console.log(`caught ${expected}`)
}

expectError((fixture) => { fixture.cli = fixture.cli.filter(({ id }) => id !== 'public.schedule.list') }, 'CLI_MISSING_CAPABILITY public.schedule.list')
expectError((fixture) => { fixture.skill = fixture.skill.filter(({ id }) => id !== 'application.submit') }, 'SKILL_MISSING_CAPABILITY application.submit')
expectError((fixture) => { fixture.skill.push(capability('admin.application.review', 'write', 'single')) }, 'LEARNER_SKILL_REFERENCES_ADMIN_CAPABILITY admin.application.review')
expectError((fixture) => { fixture.cli.find(({ id }) => id === 'file.delete').confirmation = 'single' }, 'CONFIRMATION_LEVEL_MISMATCH file.delete')
expectError((fixture) => { fixture.web.find(({ id }) => id === 'application.submit').roles = ['anonymous'] }, 'ROLES_MISMATCH application.submit')
expectError((fixture) => { fixture.skill.push(capability('resource.download')) }, 'DUPLICATE_CAPABILITY_ID resource.download')
assert.deepEqual(checkParity(complete()), [])
console.log('parity self-test ok')
