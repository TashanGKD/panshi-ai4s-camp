import {
  AdminLoginRequestSchema,
  PasswordResetRequestSchema,
  SendVerificationCodeRequestSchema,
  StudentLoginRequestSchema,
  StudentRegistrationRequestSchema,
  serializeLoginResponse,
  serializeRegistrationResponse,
  serializeProfileResponse,
} from '@panshi/contracts'
import { Router, type CookieOptions, type Response } from 'express'
import { HttpError } from '../../middleware/error-handler.js'
import { createRequireUser, getSessionToken, type AuthenticatedLocals } from '../../middleware/require-user.js'
import { AuthenticationError, SESSION_COOKIE_NAME, type SessionService } from './session.service.js'
import { VerificationError, type VerificationService } from './verification.service.js'
import { loginRateLimitActor, type RateLimiter, type RateLimitPolicy } from '../../middleware/rate-limit.js'

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
  options: { secureCookies: boolean, sessionTtlSeconds: number, verificationService?: VerificationService, rateLimiter: RateLimiter, loginFailurePolicy: RateLimitPolicy },
) => {
  const router = Router()
  const requireUser = createRequireUser(sessions)

  const setSessionCookie = (response: Response, result: { token: string, expiresAt: Date }) => {
    response.cookie(SESSION_COOKIE_NAME, result.token, {
      ...cookieOptions(options.secureCookies),
      maxAge: options.sessionTtlSeconds * 1_000,
      expires: result.expiresAt,
    })
  }

  const requireVerification = () => {
    if (!options.verificationService) {
      throw new HttpError(503, 'VERIFICATION_UNAVAILABLE', '验证码服务暂不可用')
    }
    return options.verificationService
  }

  const loginWithLimit = async (request: Parameters<Parameters<typeof router.post>[1]>[0], response: Response, phone: string, attempt: () => ReturnType<SessionService['loginStudent']>) => {
    const actor = loginRateLimitActor(request.ip, phone)
    const limit = options.rateLimiter.consume('login_failure', actor, options.loginFailurePolicy)
    if (!limit.allowed) {
      response.setHeader('Retry-After', String(limit.retryAfterSeconds))
      throw new HttpError(429, 'LOGIN_RATE_LIMITED', '登录失败次数过多，请稍后重试')
    }
    try {
      const result = await attempt()
      options.rateLimiter.reset('login_failure', actor)
      return result
    } catch (error) {
      return handleAuthenticationError(error)
    }
  }

  const handleVerificationError = (error: unknown): never => {
    if (!(error instanceof VerificationError)) throw error
    if (error.kind === 'unavailable') throw new HttpError(503, 'VERIFICATION_UNAVAILABLE', '验证码服务暂不可用')
    if (error.kind === 'rate_limited') throw new HttpError(429, 'VERIFICATION_RATE_LIMITED', '验证码发送过于频繁，请稍后重试')
    if (error.kind === 'conflict') throw new HttpError(409, 'ACCOUNT_EXISTS', '该手机号已注册')
    if (error.kind === 'password_reset_failed') throw new HttpError(400, 'PASSWORD_RESET_FAILED', '无法重置密码，请核对信息后重试')
    throw new HttpError(400, 'VERIFICATION_INVALID', '验证码无效或已失效')
  }

  router.post('/auth/verification/send', async (request, response) => {
    const input = SendVerificationCodeRequestSchema.safeParse(request.body)
    if (!input.success) throw new HttpError(400, 'INVALID_REQUEST', '验证码请求格式错误')
    try {
      await requireVerification().sendCode(input.data.phone, input.data.purpose)
      response.status(204).send()
    } catch (error) {
      handleVerificationError(error)
    }
  })

  router.post('/auth/register', async (request, response) => {
    const input = StudentRegistrationRequestSchema.safeParse(request.body)
    if (!input.success) throw new HttpError(400, 'INVALID_REQUEST', '注册请求格式错误')
    try {
      const user = await requireVerification().register(input.data.phone, input.data.code, input.data.password)
      response.status(201).json(serializeRegistrationResponse({ apiVersion: 'v1', data: { user } }))
    } catch (error) {
      handleVerificationError(error)
    }
  })

  router.post('/auth/login', async (request, response) => {
    const input = StudentLoginRequestSchema.safeParse(request.body)
    if (!input.success) throw new HttpError(400, 'INVALID_REQUEST', '登录请求格式错误')
    try {
      const result = await loginWithLimit(request, response, input.data.phone, () => sessions.loginStudent(input.data.phone, input.data.password))
      setSessionCookie(response, result)
      response.json(serializeLoginResponse({ apiVersion: 'v1', data: { user: result.user } }))
    } catch (error) {
      handleAuthenticationError(error)
    }
  })

  router.post('/auth/password/reset', async (request, response) => {
    const input = PasswordResetRequestSchema.safeParse(request.body)
    if (!input.success) throw new HttpError(400, 'INVALID_REQUEST', '密码重置请求格式错误')
    try {
      await requireVerification().resetPassword(input.data.phone, input.data.code, input.data.newPassword)
      response.status(204).send()
    } catch (error) {
      handleVerificationError(error)
    }
  })

  router.post('/auth/admin/login', async (request, response) => {
    const input = AdminLoginRequestSchema.safeParse(request.body)
    if (!input.success) throw new HttpError(400, 'INVALID_REQUEST', '登录请求格式错误')

    try {
      const result = await loginWithLimit(request, response, input.data.phone, () => sessions.loginAdmin(input.data.phone, input.data.password))
      setSessionCookie(response, result)
      response.json(serializeLoginResponse({ apiVersion: 'v1', data: { user: result.user } }))
    } catch (error) {
      handleAuthenticationError(error)
    }
  })

  router.post('/auth/admin/logout', async (request, response) => {
    try {
      await sessions.logout(getSessionToken(request.cookies))
      response.clearCookie(SESSION_COOKIE_NAME, cookieOptions(options.secureCookies))
      response.status(204).send()
    } catch (error) {
      handleAuthenticationError(error)
    }
  })

  router.post('/auth/logout', async (request, response) => {
    try {
      await sessions.logout(getSessionToken(request.cookies))
      response.clearCookie(SESSION_COOKIE_NAME, cookieOptions(options.secureCookies))
      response.status(204).send()
    } catch (error) {
      handleAuthenticationError(error)
    }
  })

  router.get('/me/profile', requireUser, (_request, response: Response<unknown, AuthenticatedLocals>) => {
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
