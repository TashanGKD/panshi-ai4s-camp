import type { Request, RequestHandler } from 'express'
import { HttpError } from './error-handler.js'
import { AuthenticationError, SESSION_COOKIE_NAME, type AuthenticatedSessionUser, type SessionService } from '../modules/identity/session.service.js'

export type AuthenticatedLocals = {
  authenticatedUser: AuthenticatedSessionUser
}

const readSessionCookie = (cookies: unknown): string | undefined => {
  if (typeof cookies !== 'object' || cookies === null || !(SESSION_COOKIE_NAME in cookies)) return undefined
  const value = (cookies as Record<string, unknown>)[SESSION_COOKIE_NAME]
  return typeof value === 'string' ? value : undefined
}

export const getSessionToken = (cookies: unknown) => readSessionCookie(cookies)

export type RequestSessionCredential = { token: string, source: 'cookie' | 'bearer' }

export const getRequestSessionCredential = (request: Pick<Request, 'cookies' | 'get'>): RequestSessionCredential | undefined => {
  const cookieToken = readSessionCookie(request.cookies)
  const authorization = request.get('Authorization')
  if (cookieToken && authorization !== undefined) {
    throw new HttpError(400, 'AUTH_CREDENTIALS_AMBIGUOUS', '请求不能同时使用 Cookie 和 Bearer 凭据')
  }
  if (authorization !== undefined) {
    const match = /^Bearer ([a-f0-9]{64})$/u.exec(authorization)
    if (!match) throw new HttpError(401, 'UNAUTHORIZED', 'Bearer 凭据无效')
    return { token: match[1]!, source: 'bearer' }
  }
  return cookieToken ? { token: cookieToken, source: 'cookie' } : undefined
}

export const createRequireUser = (
  sessions: SessionService,
  options: { unauthenticatedStatus?: 401 | 403 } = {},
): RequestHandler => async (request, response, next) => {
  try {
    const credential = getRequestSessionCredential(request)
    response.locals.authenticatedUser = await sessions.resolve(
      credential?.token,
      credential?.source === 'bearer' ? ['cli', 'admin_cli'] : ['web', 'admin_web'],
    )
    next()
  } catch (error) {
    if (error instanceof AuthenticationError && error.kind === 'account_disabled') {
      response.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      next(new HttpError(403, 'ACCOUNT_DISABLED', '账号已停用'))
      return
    }
    if (error instanceof AuthenticationError && error.kind === 'unauthorized') {
      if (readSessionCookie(request.cookies)) response.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      const status = options.unauthenticatedStatus ?? 401
      next(new HttpError(status, status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED', status === 403 ? '需要管理员会话' : '未登录或会话已失效'))
      return
    }
    next(error)
  }
}
