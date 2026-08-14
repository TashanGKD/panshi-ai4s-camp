import { AdminSummaryResponseSchema, ApplicationStatusSchema, type AdminSummaryResponse, type ContentModuleKey } from '@panshi/contracts'

export type ApplicationStatusCount = {
  status: (typeof ApplicationStatusSchema.options)[number]
  count: number
}

export type AdminSummaryRepository = {
  countApplicationsByStatus: () => Promise<readonly ApplicationStatusCount[]>
  listUpcomingDates: () => Promise<readonly { machineKey: 'registrationOpen' | 'registrationDeadline' | 'campStart' | 'campEnd', label: string, date: string }[]>
  listUnpublishedDrafts: () => Promise<readonly { key: ContentModuleKey, revision: number }[]>
  listRecentOperations: () => Promise<readonly { id: string, action: string, actorDisplayName: string | null, createdAt: Date }[]>
}

export const createAdminSummaryService = (repository: AdminSummaryRepository) => ({
  getSummary: async (): Promise<AdminSummaryResponse> => {
    const [statusRows, upcomingDates, unpublishedDrafts, recentOperations] = await Promise.all([
      repository.countApplicationsByStatus(),
      repository.listUpcomingDates(),
      repository.listUnpublishedDrafts(),
      repository.listRecentOperations(),
    ])
    const byStatus = Object.fromEntries(ApplicationStatusSchema.options.map((status) => [status, 0])) as Record<(typeof ApplicationStatusSchema.options)[number], number>
    for (const row of statusRows) byStatus[row.status] = row.count
    return AdminSummaryResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        applications: {
          total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
          pendingReview: byStatus.submitted + byStatus.reviewing,
          byStatus,
        },
        upcomingDates,
        unpublishedDrafts,
        recentOperations: recentOperations.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
      },
    })
  },
})

export type AdminSummaryService = ReturnType<typeof createAdminSummaryService>
