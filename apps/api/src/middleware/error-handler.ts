import { randomUUID } from 'node:crypto'
import { ApiErrorSchema } from '@panshi/contracts'
import type { ErrorRequestHandler, RequestHandler } from 'express'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage)
    this.name = 'HttpError'
  }
}

const isPayloadTooLarge = (error: unknown): boolean => (
  typeof error === 'object'
  && error !== null
  && 'status' in error
  && error.status === 413
)

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new HttpError(404, 'NOT_FOUND', '请求的接口不存在'))
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  void next
  const requestId = typeof response.locals.requestId === 'string'
    ? response.locals.requestId
    : randomUUID()

  let status = 500
  let code = 'INTERNAL_ERROR'
  let message = '服务器内部错误'

  if (error instanceof HttpError) {
    status = error.status
    code = error.code
    message = error.publicMessage
  } else if (isPayloadTooLarge(error)) {
    status = 413
    code = 'PAYLOAD_TOO_LARGE'
    message = '请求体过大'
  }

  response.setHeader('X-Request-Id', requestId)
  response.status(status).json(ApiErrorSchema.parse({
    error: { code, message, requestId },
  }))
}
