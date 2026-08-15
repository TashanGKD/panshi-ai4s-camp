import type { StatisticsRepository } from './statistics.repository.js'

export const createStatisticsService = (repository: StatisticsRepository) => ({
  readPublic: async () => {
    const result = await repository.readPublicCount()
    if (!result.visible) return { visible: false as const }
    return { visible: true as const, submittedCount: result.count, updatedAt: result.updatedAt.toISOString() }
  },
})

export type StatisticsService = ReturnType<typeof createStatisticsService>
