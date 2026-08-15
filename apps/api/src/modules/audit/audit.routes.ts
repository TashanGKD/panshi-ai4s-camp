import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser } from '../../middleware/require-user.js'
import { HttpError } from '../../middleware/error-handler.js'
import type { SessionService } from '../identity/session.service.js'
import { AdminManagementError, type AdminManagementService } from '../identity/admin-management.service.js'

const BusinessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T00:00:00+08:00`)
  return !Number.isNaN(instant.getTime()) && new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant) === value
}, '日期无效')
const shanghaiDayStart = (value: string) => new Date(`${value}T00:00:00+08:00`)
const Query = z.object({ actorId: z.string().uuid().optional(), action: z.string().trim().min(1).max(100).optional(), entityType: z.string().trim().min(1).max(100).optional(), entityId: z.string().trim().min(1).max(200).optional(), from: BusinessDate.optional(), to: BusinessDate.optional(), page: z.coerce.number().int().min(1).max(100_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict().superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) context.addIssue({ code: 'custom', message: '开始时间不能晚于结束时间' })
  if (value.from && value.to && shanghaiDayStart(value.to).getTime() - shanghaiDayStart(value.from).getTime() > 366 * 86_400_000) context.addIssue({ code: 'custom', message: '查询时间跨度不能超过366天' })
}).transform(({ from, to, ...value }) => ({
  ...value,
  ...(from ? { from: shanghaiDayStart(from) } : {}),
  ...(to ? { toExclusive: new Date(shanghaiDayStart(to).getTime() + 86_400_000) } : {}),
}))
const Id = z.string().uuid()
const http = (error: unknown) => error instanceof AdminManagementError ? new HttpError(error.status, error.code, error.message) : error
export const createAuditRouter = (sessions: SessionService, service: Pick<AdminManagementService, 'auditLogs' | 'auditLog'>) => {
  const router = Router(); router.use(createRequireUser(sessions, { unauthenticatedStatus: 403 }), requireAdmin)
  router.get('/', async (request, response, next) => { const parsed = Query.safeParse(request.query); if (!parsed.success) { next(new HttpError(422, 'AUDIT_QUERY_INVALID', '日志筛选条件无效')); return } try { response.json(await service.auditLogs(parsed.data)) } catch (error) { next(error) } })
  router.get('/:id', async (request, response, next) => { const parsed = Id.safeParse(request.params.id); if (!parsed.success) { next(new HttpError(422, 'AUDIT_LOG_ID_INVALID', '日志编号无效')); return } try { response.json(await service.auditLog(parsed.data)) } catch (error) { next(http(error)) } })
  return router
}
