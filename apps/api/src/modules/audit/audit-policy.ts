import type { JsonObject } from '@panshi/contracts'

const allowedKeys = new Set(['result', 'revision', 'version', 'sourceVersion', 'count', 'successCount', 'failureCount', 'requestedCount', 'answerCount', 'attachmentCount', 'retiredAnswerCount', 'questionCount', 'activeQuestionCount', 'activeAttachmentCount', 'fromStatus', 'toStatus', 'targetStatus', 'accessScope', 'sortOrder', 'authenticationMethod', 'revokedSessions', 'revokedSessionCount', 'purpose', 'visibility', 'mimeType', 'sizeBytes', 'attachmentSlot', 'failureCode', 'moduleKey', 'formVersionId', 'editableFieldCount', 'editableAttachmentCount', 'publishedVersion', 'shape', 'status', 'organization', 'identityType', 'educationStage', 'submittedFrom', 'submittedTo', 'searchProvided', 'filters', 'columns', 'before', 'after', 'summary', 'fieldCount', 'valueTypes', 'array', 'object', 'string', 'number', 'boolean', 'null'])

export const sensitiveAuditText = (value: string) => /password|passwd|secret|token|cookie|verification|验证码|密码|手机号|(?:\+?86)?1[3-9]\d{9}|\$2[aby]\$|(?:^|\s)\/(?:Users|private|home|var)\//iu.test(value)

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sensitiveAuditText(value) ? undefined : value.slice(0, 200)
  if (depth >= 4) return undefined
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined)
  if (!value || typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (!allowedKeys.has(key)) return []
    const sanitized = sanitizeValue(child, depth + 1)
    return sanitized === undefined ? [] : [[key, sanitized] as const]
  }))
}

export const sanitizeAuditMetadata = (metadata: unknown): JsonObject => {
  const sanitized = sanitizeValue(metadata, 0)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized as JsonObject : {}
}
