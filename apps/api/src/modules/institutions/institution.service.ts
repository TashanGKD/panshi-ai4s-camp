import { readFileSync } from 'node:fs'
import {
  InstitutionDirectoryResponseSchema,
  type InstitutionDirectoryResponse,
  type UcasTrainingUnit,
  type UniversityEntry,
} from '@panshi/contracts'

export type InstitutionDirectoryService = {
  getDirectory: () => InstitutionDirectoryResponse
  isUcasTrainingUnit: (name: string) => boolean
}

const readJson = <T>(relativePath: string): T => JSON.parse(
  readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
) as T

export const createInstitutionDirectoryService = (): InstitutionDirectoryService => {
  const universities = readJson<UniversityEntry[]>('../../data/institutions/universities-2025.json')
  const ucasTrainingUnits = readJson<UcasTrainingUnit[]>('../../data/institutions/ucas-training-units-2026.json')
  const directory = InstitutionDirectoryResponseSchema.parse({
    apiVersion: 'v1',
    data: {
      version: 'moe-2025-06-20_ucas-2026-08-18',
      sources: [
        {
          label: '教育部全国普通高等学校名单',
          href: 'https://hudong.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202506/t20250627_1195683.html',
          asOf: '2025-06-20',
        },
        {
          label: '中国科学院大学培养单位',
          href: 'https://www.ucas.ac.cn/zzjg/pydw/index.htm',
          asOf: '2026-08-18',
        },
        {
          label: '中国科学院大学招生培养单位联系信息',
          href: 'https://admission.ucas.ac.cn/Assistant/ContactInformation/b6230dd9-bc46-4bbf-ad1f-7c4c6ba6ae58',
          asOf: '2026-08-18',
        },
      ],
      universities,
      ucasTrainingUnits,
    },
  })
  const ucasNames = new Set(directory.data.ucasTrainingUnits.map(({ name }) => name))

  return {
    getDirectory: () => directory,
    isUcasTrainingUnit: (name) => ucasNames.has(name.trim()),
  }
}
