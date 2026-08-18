import { learnerCapabilities } from '@panshi/contracts'
import { learnerCommands } from './registry.js'

export const exportCliCapabilities = () => learnerCommands.map(({ capabilityId, path }) => {
  const capability = learnerCapabilities.find(({ id }) => id === capabilityId)
  if (!capability) throw new Error(`CLI capability is not registered: ${capabilityId}`)
  const { id, roles, phase, effect, confirmation } = capability
  return { id, roles, phase, effect, confirmation, command: path.join(' ') }
})
