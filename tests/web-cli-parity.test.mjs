import assert from 'node:assert/strict'
import test from 'node:test'
import { checkParity, loadRepositoryParityInputs } from '../scripts/check-web-cli-parity.mjs'

test('checked-in Web CLI and learner Skill cover the canonical learner registry', async () => {
  assert.deepEqual(checkParity(await loadRepositoryParityInputs()), [])
})
