import request from 'supertest'
import { InstitutionDirectoryResponseSchema, type InstitutionDirectoryResponse } from '@panshi/contracts'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

const directory: InstitutionDirectoryResponse = {
  apiVersion: 'v1',
  data: {
    version: 'moe-2025-06-20_ucas-2026-08-18',
    sources: [
      { label: '教育部全国普通高等学校名单', href: 'https://hudong.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202506/t20250627_1195683.html', asOf: '2025-06-20' },
      { label: '中国科学院大学培养单位', href: 'https://www.ucas.ac.cn/zzjg/pydw/index.htm', asOf: '2026-08-18' },
    ],
    universities: [{ name: '中国科学院大学', province: '北京市', level: '本科' }],
    ucasTrainingUnits: [{ name: '中国科学院物理研究所', type: 'institute' }],
  },
}

describe('public institution directory', () => {
  it('returns the versioned university and UCAS training-unit directory', async () => {
    const app = createApp({
      checkDatabase: async () => undefined,
      institutionDirectoryService: { getDirectory: () => directory },
      config: { allowedOrigins: [], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
    })

    const response = await request(app).get('/api/v1/public/institutions')

    expect(response.status).toBe(200)
    expect(InstitutionDirectoryResponseSchema.parse(response.body)).toEqual(directory)
    expect(response.headers['cache-control']).toContain('public')
  })
})
