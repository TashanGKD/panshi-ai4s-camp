import {
  AdminLoginRequestSchema,
  serializeLoginResponse,
  serializeProfileResponse,
} from '@panshi/contracts'
import { Router, type CookieOptions, type Response } from 'express'
import { HttpError } from '../../middleware/error-handler.js'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser, getSessionToken, type AuthenticatedLocals } from '../../middleware/require-user.js'
import { AuthenticationError, SESSION_COOKIE_NAME, type SessionService } from './session.service.js'

const authenticationHttpError = (error: AuthenticationError) => {
  if (error.kind === 'invalid_credentials') {
    return new HttpError(401, 'INVALID_CREDENTIALS', '手机号或密码错误')
  }
  if (error.kind === 'forbidden') {
    return new HttpError(403, 'FORBIDDEN', '无权访问管理后台')
  }
  return new HttpError(401, 'UNAUTHORIZED', '未登录或会话已失效')
}

const handleAuthenticationError = (error: unknown): never => {
  if (error instanceof AuthenticationError) throw authenticationHttpError(error)
  throw error
}

const cookieOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure,
})

export const createAuthRouter = (
  sessions: SessionService,
  options: { secureCookies: boolean, sessionTtlSeconds: number },
) => {
  const router = Router()
  const requireUser = createRequireUser(sessions)

  router.post('/auth/admin/login', async (request, response) => {
    const input = AdminLoginRequestSchema.safeParse(request.body)
    if (!input.success) throw new HttpError(400, 'INVALID_REQUEST', '登录请求格式错误')

    try {
      const result = await sessions.loginAdmin(input.data.phone, input.data.password)
      response.cookie(SESSION_COOKIE_NAME, result.token, {
        ...cookieOptions(options.secureCookies),
        maxAge: options.sessionTtlSeconds * 1_000,
        expires: result.expiresAt,
      })
      response.json(serializeLoginResponse({ apiVersion: 'v1', data: { user: result.user } }))
    } catch (error) {
      handleAuthenticationError(error)
    }
  })

  router.post('/auth/admin/logout', requireUser, async (request, response) => {
    try {
      await sessions.logout(getSessionToken(request.cookies))
      response.clearCookie(SESSION_COOKIE_NAME, cookieOptions(options.secureCookies))
      response.status(204).send()
    } catch (error) {
      handleAuthenticationError(error)
    }
  })

  router.get('/me/profile', requireUser, requireAdmin, (_request, response: Response<unknown, AuthenticatedLocals>) => {
    const user = response.locals.authenticatedUser
    response.json(serializeProfileResponse({
      apiVersion: 'v1',
      data: {
        user: {
          id: user.id,
          displayName: user.displayName,
          phoneNormalized: user.phoneNormalized,
          role: user.role,
        },
      },
    }))
  })

  return router
}
