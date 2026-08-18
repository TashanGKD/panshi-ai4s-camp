import { describe, expect, it } from 'vitest'
import {
  AdminContentDraftResponseSchema,
  AdminContentHistoryResponseSchema,
  AdminContentPreviewResponseSchema,
  ContentPublishRequestSchema,
  ContentPublishResponseSchema,
  ContentRollbackRequestSchema,
  ContentSaveDraftRequestSchema,
  ContentValidationDetailsSchema,
  PublicContentPayloadSchemas,
} from './index.js'

const basicPayload = {
  title: '磐石 AI4S 实训营',
  dates: { start: '2026-08-23', end: '2026-08-27', label: '2026-08-23 至 2026-08-27' },
  venue: '中国科学院物理研究所',
  intro: ['正式简介'],
}

describe('administrator content contracts', () => {
  it('types draft save and publish requests with optimistic revisions', () => {
    expect(ContentSaveDraftRequestSchema.parse({ expectedRevision: 3, payload: basicPayload })).toEqual({
      expectedRevision: 3,
      payload: basicPayload,
    })
    expect(ContentPublishRequestSchema.parse({ expectedRevision: 4 })).toEqual({ expectedRevision: 4 })
  })

  it.each([
    { expectedRevision: -1, payload: basicPayload },
    { expectedRevision: 1.5, payload: basicPayload },
    { expectedRevision: 1, payload: { invalid: undefined } },
  ])('rejects malformed draft save request %#', (request) => {
    expect(ContentSaveDraftRequestSchema.safeParse(request).success).toBe(false)
  })

  it('provides forward-compatible draft and protected preview envelopes', () => {
    const draft = AdminContentDraftResponseSchema.parse({
      apiVersion: 'v1',
      futureTopLevel: true,
      data: { key: 'basic', revision: 4, payload: basicPayload, publishedVersion: 2, futureData: true },
    })
    const preview = AdminContentPreviewResponseSchema.parse({
      apiVersion: 'v1',
      data: { key: 'basic', revision: 4, payload: basicPayload },
    })

    expect(draft.data).toEqual({ key: 'basic', revision: 4, payload: basicPayload, publishedVersion: 2 })
    expect(preview.data).toEqual({ key: 'basic', revision: 4, payload: basicPayload })
  })

  it('types immutable version history and rollback-as-new-version responses', () => {
    expect(AdminContentHistoryResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        key: 'basic',
        publishedVersion: 3,
        versions: [{ version: 3, payload: basicPayload, createdBy: 'admin-1', createdAt: '2026-08-14T00:00:00.000Z' }],
      },
    }).data.versions[0]?.version).toBe(3)
    expect(ContentRollbackRequestSchema.parse({ version: 1 })).toEqual({ version: 1 })
    expect(ContentPublishResponseSchema.parse({
      apiVersion: 'v1',
      data: { key: 'basic', version: 4, revision: 4, sourceVersion: 1 },
    }).data.sourceVersion).toBe(1)
  })

  it('types stable field-level validation details', () => {
    expect(ContentValidationDetailsSchema.parse({
      fields: [{ path: 'days.0.sessions.0.timeRange.end', code: 'INVALID_TIME_RANGE', message: '结束时间必须晚于开始时间' }],
    })).toEqual({
      fields: [{ path: 'days.0.sessions.0.timeRange.end', code: 'INVALID_TIME_RANGE', message: '结束时间必须晚于开始时间' }],
    })
  })

  it('adds optional machine date keys without invalidating legacy important dates', () => {
    expect(PublicContentPayloadSchemas.importantDates.parse({
      items: [{ label: '实训时间', value: '2026-08-23 至 2026-08-27' }],
    })).toBeTruthy()
    expect(PublicContentPayloadSchemas.importantDates.parse({
      items: [{ label: '报名时间', value: '2026年8月18日—9月1日' }],
      machineDates: { registrationOpen: '2026-08-18', registrationDeadline: '2026-09-01', campStart: '2026-09-04', campEnd: '2026-09-08' },
    })).toBeTruthy()
    expect(PublicContentPayloadSchemas.importantDates.parse({
      items: [
        { label: '报名开放', value: '2026-08-01', machineKey: 'registrationOpen' },
        { label: '报名截止', value: '2026-08-20', machineKey: 'registrationDeadline' },
      ],
    })).toBeTruthy()
  })

  it('adds machine-readable schedule ranges and stable speaker references', () => {
    expect(PublicContentPayloadSchemas.schedule.parse({
      speakers: [{ id: 'speaker-zhang', name: '张老师' }],
      days: [{
        date: '2026-08-23', label: '第一天', theme: '科研智能体',
        sessions: [{
          title: '智能体构建实践',
          timeRange: { start: '09:00', end: '10:30' },
          speakerIds: ['speaker-zhang'],
        }],
      }],
    })).toBeTruthy()
  })

  it('keeps legacy instructor strings parseable for already-published display compatibility', () => {
    expect(PublicContentPayloadSchemas.schedule.parse({
      days: [{
        date: '2026-08-23', label: '第一天', theme: '科研智能体',
        sessions: [{ title: '历史课程', time: '上午', instructors: ['历史讲师'] }],
      }],
    })).toBeTruthy()
  })

  it('validates a stable duplicate-free home section order', () => {
    expect(PublicContentPayloadSchemas.display.parse({
      series: '磐石科学智能实训营', footer: '实训营', homeSectionOrder: ['target', 'intro', 'features'],
    }).homeSectionOrder).toEqual(['target', 'intro', 'features'])
    expect(PublicContentPayloadSchemas.display.safeParse({
      series: '磐石科学智能实训营', footer: '实训营', homeSectionOrder: ['intro', 'intro'],
    }).success).toBe(false)
    expect(PublicContentPayloadSchemas.display.safeParse({
      series: '磐石科学智能实训营', footer: '实训营', homeSectionOrder: ['intro', 'unknown'],
    }).success).toBe(false)
  })
})
