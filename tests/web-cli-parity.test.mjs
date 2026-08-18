import assert from 'node:assert/strict'
import test from 'node:test'
import { checkParity, loadRepositoryParityInputs, npmInvocation } from '../scripts/check-web-cli-parity.mjs'

test('npm subprocess uses the current Node executable and npm JavaScript entry point', () => {
  assert.deepEqual(
    npmInvocation({ execPath: 'C:\\Program Files\\nodejs\\node.exe', npmExecPath: 'C:\\npm\\npm-cli.js' }),
    ['C:\\Program Files\\nodejs\\node.exe', ['C:\\npm\\npm-cli.js', 'run', 'capabilities:json', '-w', '@panshi/web', '--silent']],
  )
  assert.throws(() => npmInvocation({ execPath: '/usr/bin/node', npmExecPath: '' }), /npm_execpath is required/)
})

test('checked-in Web CLI and learner Skill cover the canonical learner registry', async () => {
  assert.deepEqual(checkParity(await loadRepositoryParityInputs()), [])
})
