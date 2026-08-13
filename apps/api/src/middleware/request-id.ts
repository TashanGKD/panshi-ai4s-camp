import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'

const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u

export const requestId: RequestHandler = (request, response, next) => {
  const incomingId = request.get('X-Request-Id')
  const id = incomingId && safeRequestIdPattern.test(incomingId) ? incomingId : randomUUID()
  response.locals.requestId = id
  response.setHeader('X-Request-Id', id)
  next()
}
