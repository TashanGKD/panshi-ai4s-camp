export class CliRuntimeError extends Error {
  constructor(readonly code: string, message = code, readonly details?: unknown, readonly requestId = 'local') {
    super(message)
    this.name = 'CliRuntimeError'
  }
}

const publicCodes = new Set([
  'UNAUTHORIZED', 'FORBIDDEN', 'INPUT_INVALID', 'STATE_NOT_ALLOWED',
  'APPLICATION_REVISION_CONFLICT', 'CONFIRMATION_REQUIRED', 'CONFIRMATION_EXPIRED',
  'CONFIRMATION_MISMATCH', 'CONFIRMATION_ALREADY_USED',
  'CONFIRMATION_EXECUTION_INDETERMINATE', 'RESOURCE_NOT_FOUND',
  'SERVICE_UNAVAILABLE', 'AUTH_CREDENTIALS_AMBIGUOUS',
  'INTERACTIVE_INPUT_REQUIRED', 'KEYCHAIN_UNAVAILABLE', 'OUTPUT_EXISTS', 'REQUEST_FAILED',
])

export const safeError = (error: unknown) => {
  if (error instanceof CliRuntimeError) {
    if (publicCodes.has(error.code)) return error
    return new CliRuntimeError('INPUT_INVALID', error.message, { reason: error.code }, error.requestId)
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const candidate = error as { code?: unknown, message?: unknown, details?: unknown, requestId?: unknown }
    if (typeof candidate.code === 'string' && publicCodes.has(candidate.code)) {
      return new CliRuntimeError(
        candidate.code,
        typeof candidate.message === 'string' ? candidate.message : '请求失败',
        candidate.details,
        typeof candidate.requestId === 'string' && candidate.requestId ? candidate.requestId : 'local',
      )
    }
  }
  return new CliRuntimeError('REQUEST_FAILED', '命令执行失败')
}
