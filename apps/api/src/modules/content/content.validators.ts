import {
  ContentValidationDetailsSchema,
  PublicContentPayloadSchemas,
  type ContentModuleKey,
  type ContentValidationDetails,
  type JsonObject,
} from '@panshi/contracts'
import { isDeepStrictEqual } from 'node:util'
import { sanitizeContentPayload } from './content-sanitizer.js'

export type ContentValidationRepository = {
  findPublishedPayload: (key: ContentModuleKey) => Promise<JsonObject | null>
}

type FieldIssue = ContentValidationDetails['fields'][number]

export class ContentValidationError extends Error {
  readonly details: ContentValidationDetails

  constructor(fields: readonly FieldIssue[]) {
    super('Content validation failed')
    this.name = 'ContentValidationError'
    this.details = ContentValidationDetailsSchema.parse({ fields })
  }
}

const fieldPath = (path: readonly PropertyKey[]) => path.map(String).join('.') || 'payload'
const realIsoDate = /^\d{4}-\d{2}-\d{2}$/u
const timePattern = /^(?<hour>\d{2}):(?<minute>\d{2})$/u

const isRealDate = (value: string) => {
  if (!realIsoDate.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

const minuteOfDay = (value: string): number | null => {
  const match = timePattern.exec(value)
  if (!match?.groups) return null
  const hour = Number(match.groups.hour)
  const minute = Number(match.groups.minute)
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null
}

const schemaIssues = (key: ContentModuleKey, payload: JsonObject): FieldIssue[] => {
  const result = PublicContentPayloadSchemas[key].safeParse(payload)
  if (result.success) return []
  return result.error.issues.map((issue) => ({
    path: fieldPath(issue.path),
    code: 'INVALID_FIELD',
    message: '字段格式不正确',
  }))
}

type ImportantDateItem = { value: string, machineKey?: 'registrationOpen' | 'registrationDeadline' | 'campStart' | 'campEnd' }
type ImportantDatesPayload = { items: ImportantDateItem[] }

const validateImportantDates = (
  payload: ImportantDatesPayload,
  basic: JsonObject | null,
): FieldIssue[] => {
  const issues: FieldIssue[] = []
  const indexed = new Map<string, { item: ImportantDateItem, index: number }>()

  payload.items.forEach((item, index) => {
    if (!item.machineKey) return
    if (indexed.has(item.machineKey)) {
      issues.push({ path: `items.${index}.machineKey`, code: 'DUPLICATE_MACHINE_KEY', message: '机器日期键不能重复' })
      return
    }
    indexed.set(item.machineKey, { item, index })
    if (!isRealDate(item.value)) {
      issues.push({ path: `items.${index}.value`, code: 'INVALID_MACHINE_DATE', message: '机器日期必须使用有效的 YYYY-MM-DD' })
    }
  })

  for (const machineKey of ['registrationOpen', 'registrationDeadline', 'campStart', 'campEnd'] as const) {
    if (!indexed.has(machineKey)) {
      issues.push({ path: `items.${machineKey}`, code: 'MACHINE_DATE_REQUIRED', message: '发布时必须提供完整的机器日期' })
    }
  }

  const registrationOpen = indexed.get('registrationOpen')
  const registrationDeadline = indexed.get('registrationDeadline')
  if (
    registrationOpen && registrationDeadline
    && isRealDate(registrationOpen.item.value) && isRealDate(registrationDeadline.item.value)
    && registrationOpen.item.value >= registrationDeadline.item.value
  ) {
    issues.push({
      path: `items.${registrationDeadline.index}.value`,
      code: 'INVALID_REGISTRATION_WINDOW',
      message: '报名截止时间必须晚于报名开放时间',
    })
  }

  const campStart = indexed.get('campStart')
  const campEnd = indexed.get('campEnd')
  if (
    campStart && campEnd
    && isRealDate(campStart.item.value) && isRealDate(campEnd.item.value)
    && campStart.item.value > campEnd.item.value
  ) {
    issues.push({
      path: `items.${campEnd.index}.value`,
      code: 'INVALID_CAMP_WINDOW',
      message: '实训结束日期不能早于开始日期',
    })
  }

  const basicDates = basic && typeof basic.dates === 'object' && basic.dates !== null && !Array.isArray(basic.dates)
    ? basic.dates as Record<string, unknown>
    : undefined
  for (const [machineKey, basicKey] of [['campStart', 'start'], ['campEnd', 'end']] as const) {
    const date = indexed.get(machineKey)
    const expected = basicDates?.[basicKey]
    if (date && isRealDate(date.item.value) && typeof expected === 'string' && date.item.value !== expected) {
      issues.push({ path: `items.${date.index}.value`, code: 'CAMP_DATE_MISMATCH', message: '实训日期必须与基本信息一致' })
    }
  }
  return issues
}

type SchedulePayload = {
  speakers?: { id: string }[]
  days: { sessions: { time?: string, timeRange?: { start: string, end: string }, instructors?: string[], speakerIds?: string[] }[] }[]
}

const validateSchedule = (payload: SchedulePayload): FieldIssue[] => {
  const issues: FieldIssue[] = []
  const speakerIds = new Set<string>()
  payload.speakers?.forEach((speaker, index) => {
    if (speakerIds.has(speaker.id)) {
      issues.push({ path: `speakers.${index}.id`, code: 'DUPLICATE_SPEAKER_ID', message: '讲师 ID 不能重复' })
    }
    speakerIds.add(speaker.id)
  })

  payload.days.forEach((day, dayIndex) => day.sessions.forEach((session, sessionIndex) => {
    const base = `days.${dayIndex}.sessions.${sessionIndex}`
    if (!session.timeRange) {
      issues.push({ path: `${base}.timeRange`, code: 'TIME_RANGE_REQUIRED', message: '新发布日程必须提供机器可读时间范围' })
    }
    if (session.timeRange) {
      const start = minuteOfDay(session.timeRange.start)
      const end = minuteOfDay(session.timeRange.end)
      if (start === null) issues.push({ path: `${base}.timeRange.start`, code: 'INVALID_TIME', message: '时间必须使用有效的 HH:mm' })
      if (end === null) issues.push({ path: `${base}.timeRange.end`, code: 'INVALID_TIME', message: '时间必须使用有效的 HH:mm' })
      else if (start !== null && start >= end) {
        issues.push({ path: `${base}.timeRange.end`, code: 'INVALID_TIME_RANGE', message: '结束时间必须晚于开始时间' })
      }
    }

    if (session.instructors?.length) {
      issues.push({ path: `${base}.instructors`, code: 'LEGACY_INSTRUCTORS_FORBIDDEN', message: '新发布日程不能使用旧讲师文本' })
    }
    const seen = new Set<string>()
    session.speakerIds?.forEach((speakerId, speakerIndex) => {
      if (seen.has(speakerId)) {
        issues.push({ path: `${base}.speakerIds.${speakerIndex}`, code: 'DUPLICATE_SPEAKER_REFERENCE', message: '同一课程不能重复引用讲师' })
      } else if (!speakerIds.has(speakerId)) {
        issues.push({ path: `${base}.speakerIds.${speakerIndex}`, code: 'UNKNOWN_SPEAKER', message: '引用的讲师不存在' })
      }
      seen.add(speakerId)
    })
  }))
  return issues
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const safePhone = (value: string) => /^\+?[0-9][0-9(). -]*$/u.test(value) && value.replace(/\D/gu, '').length >= 3
const safeEmail = (value: string) => zEmailPattern.test(value)
const zEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

const validateContacts = (payload: JsonObject): FieldIssue[] => {
  const issues: FieldIssue[] = []
  const items = Array.isArray(payload.items) ? payload.items : []
  if (items.length === 0) {
    issues.push({ path: 'items', code: 'CONTACT_REQUIRED', message: '发布时至少需要一位结构化联系人' })
    return issues
  }
  items.forEach((item, itemIndex) => {
    const record = isRecord(item) ? item : {}
    if (!nonEmpty(record.name)) issues.push({ path: `items.${itemIndex}.name`, code: 'CONTACT_NAME_REQUIRED', message: '联系人姓名不能为空' })
    if (!nonEmpty(record.responsibility)) issues.push({ path: `items.${itemIndex}.responsibility`, code: 'CONTACT_RESPONSIBILITY_REQUIRED', message: '联系人职责不能为空' })
    const methods = Array.isArray(record.methods) ? record.methods : []
    if (methods.length === 0) {
      issues.push({ path: `items.${itemIndex}.methods`, code: 'CONTACT_METHOD_REQUIRED', message: '至少提供一个电话或邮箱' })
    }
    methods.forEach((method, methodIndex) => {
      const methodRecord = isRecord(method) ? method : {}
      const type = methodRecord.type
      const value = methodRecord.value
      if (type !== 'phone' && type !== 'email') {
        issues.push({ path: `items.${itemIndex}.methods.${methodIndex}.type`, code: 'INVALID_CONTACT_METHOD_TYPE', message: '联系方式类型必须是电话或邮箱' })
      } else if (!nonEmpty(value) || (type === 'phone' ? !safePhone(value) : !safeEmail(value))) {
        issues.push({ path: `items.${itemIndex}.methods.${methodIndex}.value`, code: 'INVALID_CONTACT_METHOD', message: '联系方式格式不安全或不完整' })
      }
    })
    if (record.consultationNote !== undefined && !nonEmpty(record.consultationNote)) {
      issues.push({ path: `items.${itemIndex}.consultationNote`, code: 'INVALID_CONSULTATION_NOTE', message: '咨询说明不能为空' })
    }
  })
  return issues
}

export const validateContentForPublication = async (
  key: ContentModuleKey,
  payload: JsonObject,
  repository: ContentValidationRepository,
): Promise<void> => {
  const issues = schemaIssues(key, payload)
  const parsed = PublicContentPayloadSchemas[key].safeParse(payload)

  if (!isDeepStrictEqual(sanitizeContentPayload(key, payload), payload)) {
    issues.push({ path: 'payload', code: 'UNSAFE_HTML', message: '富文本包含不允许的标签、属性或链接' })
  }

  if (parsed.success && key === 'importantDates') {
    issues.push(...validateImportantDates(parsed.data as ImportantDatesPayload, await repository.findPublishedPayload('basic')))
  }
  if (parsed.success && key === 'schedule') issues.push(...validateSchedule(parsed.data as SchedulePayload))
  if (key === 'contacts') issues.push(...validateContacts(payload))

  // Resource file completeness belongs to the resource visibility boundary,
  // so unrelated content modules are never coupled to pending resource uploads here.

  if (issues.length > 0) throw new ContentValidationError(issues)
}
