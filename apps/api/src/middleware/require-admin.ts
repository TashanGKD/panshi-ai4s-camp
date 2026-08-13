import type { RequestHandler } from 'express'
import { HttpError } from './error-handler.js'
import type { AuthenticatedLocals } from './require-user.js'

export const requireAdmin: RequestHandler = (_request, response, next) => {
  const user = (response.locals as Partial<AuthenticatedLocals>).authenticatedUser
  if (!user || user.role !== 'admin' || user.disabledAt !== null) {
    next(new HttpError(403, 'FORBIDDEN', '无权访问管理后台'))
    return
  }
  next()
}
