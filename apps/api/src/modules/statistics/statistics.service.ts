import type { StatisticsRepository } from './statistics.repository.js'

export const createStatisticsService = (repository: StatisticsRepository) => ({
  readPublic: async () => {
    if (!await repository.readPublishedVisibility()) return { visible: false as const }
    const result = await repository.countSubmitted()
    return { visible: true as const, submittedCount: result.count, updatedAt: result.updatedAt.toISOString() }
  },
})

export type StatisticsService = ReturnType<typeof createStatisticsService>
