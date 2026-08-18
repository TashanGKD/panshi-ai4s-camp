import { describe, expect, it } from 'vitest'
import { CliSuccessSchema, learnerCapabilities } from '@panshi/contracts'
import { learnerCommands } from './registry.js'

const expected = learnerCapabilities.map(({ id, cliCommand }) => [id, cliCommand.split(' ').filter((part) => !part.startsWith('<')).join(' ')])

describe('learner read command registry', () => {
  it('registers every approved command exactly once with its capability ID', () => {
    expect(learnerCommands.map(({ capabilityId, path }) => [capabilityId, path.join(' ')])).toEqual(expected)
    expect(new Set(learnerCommands.map(({ capabilityId }) => capabilityId)).size).toBe(expected.length)
  })

  it('uses the stable CLI success envelope', () => {
    for (const [capabilityId] of expected) {
      expect(CliSuccessSchema.safeParse({ ok: true, apiVersion: 'v1', capabilityId, data: {}, requestId: 'local' }).success).toBe(true)
    }
  })
})
