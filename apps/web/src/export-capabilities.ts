import { learnerCapabilities } from '@panshi/contracts'
import { webCapabilities } from './capabilities.js'

const routesByCapability = new Map<string, string[]>()
for (const [route, capabilities] of Object.entries(webCapabilities)) {
  for (const id of capabilities) routesByCapability.set(id, [...(routesByCapability.get(id) ?? []), route])
}
const output = learnerCapabilities
  .filter(({ id }) => routesByCapability.has(id))
  .map(({ id, roles, phase, effect, confirmation }) => ({ id, roles, phase, effect, confirmation, routes: routesByCapability.get(id)!.sort() }))
process.stdout.write(`${JSON.stringify(output)}\n`)
