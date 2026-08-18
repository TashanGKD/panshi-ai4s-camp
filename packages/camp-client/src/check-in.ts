import { StudentCheckInResponseSchema } from '@panshi/contracts'
import type { CampTransport } from './http.js'

export const createCheckInApi = (transport: CampTransport) => ({
  show: () => transport.json('check_in.show', '/api/v1/me/check-in', { schema: StudentCheckInResponseSchema }),
})
