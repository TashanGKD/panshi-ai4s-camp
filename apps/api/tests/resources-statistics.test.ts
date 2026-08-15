import { describe, expect, it, vi } from 'vitest'
import { createResourceService } from '../src/modules/resources/resource.service.js'
import { createStatisticsService } from '../src/modules/statistics/statistics.service.js'
import type { ResourceRepository } from '../src/modules/resources/resource.repository.js'

describe('resource access', () => {
  const records = [
    { id: '10000000-0000-4000-8000-000000000001', key: 'public', title: '公开资料', description: null, fileId: '20000000-0000-4000-8000-000000000001', accessScope: 'public' as const, sortOrder: 0 },
    { id: '10000000-0000-4000-8000-000000000002', key: 'auth', title: '学员资料', description: '登录后查看', fileId: '20000000-0000-4000-8000-000000000002', accessScope: 'authenticated' as const, sortOrder: 1 },
    { id: '10000000-0000-4000-8000-000000000003', key: 'admitted', title: '录取资料', description: null, fileId: '20000000-0000-4000-8000-000000000003', accessScope: 'admitted' as const, sortOrder: 2 },
  ]

  it('returns only public metadata to anonymous visitors', async () => {
    const service = createResourceService({ listAvailable: vi.fn().mockResolvedValue(records), findAvailableById: vi.fn(), isAdmitted: vi.fn() } as unknown as ResourceRepository, { openPublishedResource: vi.fn() } as never)
    expect((await service.list(null)).map((item) => item.key)).toEqual(['public'])
  })

  it('returns authenticated resources to active students and admitted resources only after admission', async () => {
    const repository = { listAvailable: vi.fn().mockResolvedValue(records), findAvailableById: vi.fn(), isAdmitted: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) }
    const service = createResourceService(repository as unknown as ResourceRepository, { openPublishedResource: vi.fn() } as never)
    const user = { id: '30000000-0000-4000-8000-000000000001', role: 'user' as const, disabledAt: null, displayName: '学员', phoneNormalized: '+8613800000000', passwordHash: '', createdAt: new Date() }
    expect((await service.list(user)).map((item) => item.key)).toEqual(['public', 'auth'])
    expect((await service.list(user)).map((item) => item.key)).toEqual(['public', 'auth', 'admitted'])
  })

  it('does not reveal a restricted resource through download errors', async () => {
    const service = createResourceService({ listAvailable: vi.fn(), findAvailableById: vi.fn().mockResolvedValue(records[2]), isAdmitted: vi.fn().mockResolvedValue(false) } as unknown as ResourceRepository, { openPublishedResource: vi.fn() } as never)
    await expect(service.open(records[2]!.id, null)).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_AVAILABLE' })
  })

  it('separates published downloads from an active administrator preview', async () => {
    const draft = { ...records[2]!, active: false }
    const openPublishedResource = vi.fn().mockResolvedValue({ record: { id: draft.fileId }, stream: 'stream' })
    const repository = {
      listAvailable: vi.fn(), findAvailableById: vi.fn(), findManageableById: vi.fn().mockResolvedValue(draft), isAdmitted: vi.fn(),
    }
    const service = createResourceService(repository as unknown as ResourceRepository, { openPublishedResource } as never)
    const admin = { id: '30000000-0000-4000-8000-000000000009', role: 'admin' as const, disabledAt: null, displayName: '管理员', phoneNormalized: '+8613900000000', passwordHash: '', createdAt: new Date() }
    await expect(service.open(draft.id, admin)).rejects.toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
    await expect(service.preview(draft.id, admin)).resolves.toMatchObject({
      record: { id: draft.fileId }, isPublished: false, isAdminPreview: true, anonymousPublic: false,
    })
    expect(repository.findManageableById).toHaveBeenCalledWith(draft.id)
  })

  it('marks only an anonymous published public download as shared-cacheable', async () => {
    const openPublishedResource = vi.fn().mockResolvedValue({ record: { id: records[0]!.fileId }, stream: 'stream' })
    const repository = { findAvailableById: vi.fn().mockResolvedValue(records[0]), isAdmitted: vi.fn() }
    const service = createResourceService(repository as unknown as ResourceRepository, { openPublishedResource } as never)
    const user = { id: '30000000-0000-4000-8000-000000000001', role: 'user' as const, disabledAt: null, displayName: '学员', phoneNormalized: '+8613800000000', passwordHash: '', createdAt: new Date() }
    await expect(service.open(records[0]!.id, null)).resolves.toMatchObject({ isPublished: true, isAdminPreview: false, anonymousPublic: true })
    await expect(service.open(records[0]!.id, user)).resolves.toMatchObject({ isPublished: true, isAdminPreview: false, anonymousPublic: false })
  })
})

describe('submitted application statistics', () => {
  it('returns no count side channel while the published display switch is off', async () => {
    const repository = { readPublishedVisibility: vi.fn().mockResolvedValue(false), countSubmitted: vi.fn() }
    expect(await createStatisticsService(repository).readPublic()).toEqual({ visible: false })
    expect(repository.countSubmitted).not.toHaveBeenCalled()
  })

  it('returns the real count and ISO update time while enabled', async () => {
    const repository = { readPublishedVisibility: vi.fn().mockResolvedValue(true), countSubmitted: vi.fn().mockResolvedValue({ count: 6, updatedAt: new Date('2026-08-15T12:00:00.000Z') }) }
    expect(await createStatisticsService(repository).readPublic()).toEqual({ visible: true, submittedCount: 6, updatedAt: '2026-08-15T12:00:00.000Z' })
  })
})
