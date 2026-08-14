import { describe, expect, it } from 'vitest'
import { AdminSummaryResponseSchema } from './admin-summary.js'

const emptySummary = {
  apiVersion: 'v1',
  data: {
    applications: { total: 0, pendingReview: 0, byStatus: { draft: 0, submitted: 0, reviewing: 0, needs_supplement: 0, admitted: 0, waitlisted: 0, rejected: 0 } },
    upcomingDates: [], unpublishedDrafts: [], recentOperations: [],
  },
}

describe('administrator summary contract', () => {
  it('requires every application status and accepts truthful empty state', () => {
    expect(AdminSummaryResponseSchema.parse(emptySummary)).toEqual(emptySummary)
    const missingStatus = structuredClone(emptySummary)
    delete (missingStatus.data.applications.byStatus as Partial<typeof emptySummary.data.applications.byStatus>).rejected
    expect(AdminSummaryResponseSchema.safeParse(missingStatus).success).toBe(false)
  })

  it('rejects audit metadata and malformed dates at the public contract boundary', () => {
    expect(AdminSummaryResponseSchema.safeParse({
      ...emptySummary,
      data: { ...emptySummary.data, recentOperations: [{ id: '1', action: 'x', actorDisplayName: null, createdAt: '2026-08-14T00:00:00Z', metadata: { secret: true } }] },
    }).success).toBe(false)
    expect(AdminSummaryResponseSchema.safeParse({
      ...emptySummary,
      data: { ...emptySummary.data, upcomingDates: [{ machineKey: 'campStart', label: '开始', date: '明天' }] },
    }).success).toBe(false)
  })
})
