import { ApiErrorSchema } from '@panshi/contracts'

const result = ApiErrorSchema.parse({
  error: {
    code: 'SMOKE_TEST',
    message: 'package export is consumable',
    requestId: 'smoke-1',
  },
})

if (result.error.code !== 'SMOKE_TEST') {
  throw new Error('Package export returned an unexpected schema result')
}
