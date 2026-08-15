import type { RequestHandler } from 'express'
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

export const createRequireUser = (
  sessions: SessionService,
  options: { unauthenticatedStatus?: 401 | 403 } = {},
): RequestHandler => async (request, response, next) => {
  try {
    response.locals.authenticatedUser = await sessions.resolve(readSessionCookie(request.cookies))
    next()
  } catch (error) {
    if (error instanceof AuthenticationError && error.kind === 'unauthorized') {
      if (readSessionCookie(request.cookies)) response.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      const status = options.unauthenticatedStatus ?? 401
      next(new HttpError(status, status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED', status === 403 ? '需要管理员会话' : '未登录或会话已失效'))
      return
    }
    next(error)
  }
}
