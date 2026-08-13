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

const getParserErrorType = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    return undefined
  }
  return typeof error.type === 'string' ? error.type : undefined
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new HttpError(404, 'NOT_FOUND', '请求的接口不存在'))
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    const terminalError = new Error('Response terminated after headers were sent')
    next(terminalError)
    return
  }

  const requestId = typeof response.locals.requestId === 'string'
    ? response.locals.requestId
    : randomUUID()

  let status = 500
  let code = 'INTERNAL_ERROR'
  let message = '服务器内部错误'
  const parserErrorType = getParserErrorType(error)

  if (error instanceof HttpError) {
    status = error.status
    code = error.code
    message = error.publicMessage
  } else if (parserErrorType === 'entity.too.large') {
    status = 413
    code = 'PAYLOAD_TOO_LARGE'
    message = '请求体过大'
  } else if (parserErrorType === 'entity.parse.failed') {
    status = 400
    code = 'MALFORMED_JSON'
    message = 'JSON 请求体格式错误'
  } else if (
    parserErrorType === 'encoding.unsupported'
    || parserErrorType === 'charset.unsupported'
  ) {
    status = 415
    code = 'UNSUPPORTED_MEDIA_TYPE'
    message = '不支持的请求内容格式'
  }

  response.setHeader('X-Request-Id', requestId)
  response.status(status).json(ApiErrorSchema.parse({
    error: { code, message, requestId },
  }))
}
