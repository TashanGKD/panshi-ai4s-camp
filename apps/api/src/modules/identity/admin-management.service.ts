import { normalizeMainlandChinaMobile } from '@panshi/contracts'
import type { IdentityUser } from './identity.repository.js'
import { hashPassword, verifyPassword } from './password.js'
import type { AdminManagementRepository, AuditQuery, AuditRecord } from './admin-management.repository.js'
import { sanitizeAuditMetadata, sensitiveAuditText } from '../audit/audit-policy.js'
export { sanitizeAuditMetadata } from '../audit/audit-policy.js'

export class AdminManagementError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'AdminManagementError' }
}

const present = (record: { id: string, displayName: string, phone: string, disabledAt: Date | null, createdAt: Date }) => ({ ...record, disabledAt: record.disabledAt?.toISOString() ?? null, createdAt: record.createdAt.toISOString() })
const presentForActor = (record: Parameters<typeof present>[0], actorId: string | undefined) => ({ ...present(record), isCurrent: record.id === actorId })
const safeAuditText = (value: string, maxLength = 200) => sensitiveAuditText(value) ? '已隐藏' : value.slice(0, maxLength)
const presentAudit = (row: AuditRecord) => ({
  id: row.id,
  actor: row.actorId ? { id: row.actorId, displayName: row.actorDisplayName ? safeAuditText(row.actorDisplayName, 100) : null } : null,
  action: safeAuditText(row.action, 100),
  entityType: safeAuditText(row.entityType, 100),
  entityId: row.entityId ? safeAuditText(row.entityId) : null,
  metadata: sanitizeAuditMetadata(row.metadata),
  createdAt: row.createdAt.toISOString(),
})
const validateAdminPassword = (password: string) => {
  const bytes = new TextEncoder().encode(password).byteLength
  const groups = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u].filter((pattern) => pattern.test(password)).length
  if (bytes < 12 || bytes > 72 || groups < 3) throw new AdminManagementError(422, 'ADMIN_PASSWORD_WEAK', '管理员密码须为12至72字节，并包含至少三类字符')
  return password
}

export const createAdminManagementService = (repository: AdminManagementRepository, now = () => new Date()) => {
  const reauthenticate = async (actor: IdentityUser, currentPassword: string) => {
    if (!await verifyPassword(currentPassword, actor.passwordHash)) throw new AdminManagementError(403, 'CURRENT_PASSWORD_INVALID', '当前管理员密码错误')
  }
  const ensureActor = <T>(result: T | 'actor_invalid'): T => {
    if (result === 'actor_invalid') throw new AdminManagementError(403, 'ADMIN_SESSION_INVALID', '当前管理员账号已失效')
    return result as T
  }
  return {
    list: async (actor?: IdentityUser) => ({ apiVersion: 'v1' as const, data: { administrators: (await repository.listAdmins()).map((record) => presentForActor(record, actor?.id)) } }),
    create: async (actor: IdentityUser, input: { displayName: string, phone: string, password: string, currentPassword: string }) => {
      await reauthenticate(actor, input.currentPassword)
      const displayName = input.displayName.trim()
      if (!displayName || displayName.length > 100) throw new AdminManagementError(422, 'ADMIN_NAME_INVALID', '管理员名称无效')
      let phone: string
      try { phone = normalizeMainlandChinaMobile(input.phone) } catch { throw new AdminManagementError(422, 'ADMIN_PHONE_INVALID', '管理员手机号格式无效') }
      const result = ensureActor(await repository.createAdmin({ displayName, phone, passwordHash: await hashPassword(validateAdminPassword(input.password)), actorId: actor.id }))
      if (result === 'name_conflict') throw new AdminManagementError(409, 'ADMIN_NAME_CONFLICT', '管理员名称已存在')
      if (result === 'phone_conflict') throw new AdminManagementError(409, 'ADMIN_PHONE_CONFLICT', '该手机号已存在')
      return { apiVersion: 'v1' as const, data: { administrator: presentForActor(result, actor.id) } }
    },
    disable: async (actor: IdentityUser, targetId: string, input: { currentPassword: string }) => {
      await reauthenticate(actor, input.currentPassword)
      if (targetId === actor.id) throw new AdminManagementError(409, 'CANNOT_DISABLE_SELF', '不能禁用当前登录的管理员账号')
      const result = ensureActor(await repository.disableAdmin({ targetId, actorId: actor.id, disabledAt: now() }))
      if (result === 'not_found') throw new AdminManagementError(404, 'ADMIN_NOT_FOUND', '管理员不存在')
      if (result === 'last_active') throw new AdminManagementError(409, 'LAST_ACTIVE_ADMIN', '不能禁用最后一名有效管理员')
      return { apiVersion: 'v1' as const, data: { administrator: presentForActor(result, actor.id) } }
    },
    resetPassword: async (actor: IdentityUser, targetId: string, input: { currentPassword: string, newPassword: string }) => {
      await reauthenticate(actor, input.currentPassword)
      const result = ensureActor(await repository.resetAdminPassword({ targetId, actorId: actor.id, passwordHash: await hashPassword(validateAdminPassword(input.newPassword)), changedAt: now() }))
      if (result === 'not_found') throw new AdminManagementError(404, 'ADMIN_NOT_FOUND', '有效管理员不存在')
      return { apiVersion: 'v1' as const, data: { administrator: presentForActor(result, actor.id) } }
    },
    auditLogs: async (query: AuditQuery) => {
      const result = await repository.listAuditLogs(query)
      return { apiVersion: 'v1' as const, data: { items: result.rows.map(presentAudit), total: result.total, page: query.page, pageSize: query.pageSize } }
    },
    auditLog: async (id: string) => {
      const record = await repository.getAuditLog(id)
      if (!record) throw new AdminManagementError(404, 'AUDIT_LOG_NOT_FOUND', '操作日志不存在')
      return { apiVersion: 'v1' as const, data: { item: presentAudit(record) } }
    },
  }
}

export type AdminManagementService = ReturnType<typeof createAdminManagementService>
