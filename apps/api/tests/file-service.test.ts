import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createFileService } from '../src/modules/files/file.service.js'
import type { FileRecord, FileRepository } from '../src/modules/files/file.repository.js'
import type { FileStorage } from '../src/modules/files/file-storage.js'
import { FileStorageError } from '../src/modules/files/local-file-storage.js'

const actor = { id: '00000000-0000-4000-8000-000000000301', displayName: '学员', phoneNormalized: '+8613800138301', passwordHash: 'unused', role: 'user' as const, disabledAt: null }
const storageKey = 'aa/bb/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const activeRecord = {
  id: '00000000-0000-4000-8000-000000000302', storageKey, originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 10,
  sha256: 'a'.repeat(64), uploadedBy: actor.id, ownerUserId: actor.id, purpose: 'registration_attachment' as const,
  visibility: 'owner_admin' as const, attachmentSlot: 'resume', hiddenAt: null, deletedAt: null, lifecycleState: 'active' as const,
  deleteFailureCode: null, createdAt: new Date(),
}

describe('recoverable file lifecycle', () => {
  it('does not report deletion success when physical deletion fails and allows retry', async () => {
    let record: FileRecord = { ...activeRecord }
    let removeAttempts = 0
    const repository = {
      findById: async () => record,
      beginDeleteWithAudit: async () => {
        record = { ...record, lifecycleState: 'deleting' as const }
        return record
      },
      markDeleteFailedWithAudit: async (_id: string, _actorId: string, code: string) => {
        record = { ...record, lifecycleState: 'delete_failed' as const, deleteFailureCode: code }
        return record
      },
      markDeletedWithAudit: async () => {
        record = { ...record, lifecycleState: 'deleted' as const, deletedAt: new Date(), deleteFailureCode: null }
        return record
      },
      markDeletedWithAuditLegacy: async () => record,
    } as unknown as FileRepository
    const storage = {
      remove: async () => {
        removeAttempts += 1
        if (removeAttempts === 1) throw Object.assign(new Error('disk unavailable'), { code: 'EIO' })
      },
    } as unknown as FileStorage
    const service = createFileService(repository, storage)

    await expect(service.remove(record.id, actor)).rejects.toMatchObject({ status: 503, code: 'FILE_DELETE_FAILED' })
    expect(record).toMatchObject({ lifecycleState: 'delete_failed', deleteFailureCode: 'FILE_STORAGE_DELETE_FAILED', deletedAt: null })
    await expect(service.remove(record.id, actor)).resolves.toBeUndefined()
    expect(record.lifecycleState).toBe('deleted')
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(removeAttempts).toBe(2)
  })

  it('creates a recovery ledger before disk write and retains delete_failed when metadata and cleanup both fail', async () => {
    const events: string[] = []
    let recoveryState = ''
    const repository = {
      beginUploadRecovery: async () => {
        events.push('recovery_begin')
        recoveryState = 'pending'
        return { id: '00000000-0000-4000-8000-000000000303' }
      },
      finalizeUploadWithAudit: async () => {
        events.push('metadata_finalize')
        throw new Error('database insert failed')
      },
      clearUploadRecovery: async () => { recoveryState = 'cleared' },
      markUploadCleanupFailed: async () => { recoveryState = 'delete_failed' },
    } as unknown as FileRepository
    const storage = {
      createStorageKey: () => storageKey,
      put: async () => {
        events.push('storage_put')
        return { storageKey, sha256: 'a'.repeat(64), size: 10, mime: 'application/pdf' }
      },
      remove: async () => {
        events.push('storage_cleanup')
        throw new Error('cleanup failed')
      },
    } as unknown as FileStorage
    const service = createFileService(repository, storage)

    await expect(service.upload({
      stream: Readable.from(Buffer.alloc(10)), originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 10,
      purpose: 'registration_attachment', attachmentSlot: 'resume',
    }, actor)).rejects.toThrow('database insert failed')
    expect(events).toEqual(['recovery_begin', 'storage_put', 'metadata_finalize', 'storage_cleanup'])
    expect(recoveryState).toBe('delete_failed')
  })

  it('audits a storage escape rejection without recording a physical path', async () => {
    const audit: Array<{ recoveryId: string, code: string }> = []
    const repository = {
      beginUploadRecovery: async () => ({ id: '00000000-0000-4000-8000-000000000304' }),
      recordUploadStorageFailure: async (recoveryId: string, _actorId: string, code: string) => {
        audit.push({ recoveryId, code })
      },
      clearUploadRecovery: async () => undefined,
    } as unknown as FileRepository
    const storage = {
      createStorageKey: () => storageKey,
      put: async () => { throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝符号链接文件') },
    } as unknown as FileStorage

    await expect(createFileService(repository, storage).upload({
      stream: Readable.from(Buffer.alloc(10)), originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 10,
      purpose: 'registration_attachment', attachmentSlot: 'resume',
    }, actor)).rejects.toMatchObject({ code: 'FILE_STORAGE_SYMLINK_REJECTED' })
    expect(audit).toEqual([{
      recoveryId: '00000000-0000-4000-8000-000000000304',
      code: 'FILE_STORAGE_SYMLINK_REJECTED',
    }])
    expect(JSON.stringify(audit)).not.toMatch(/resume|uploads|\/tmp/iu)
  })

  it('retains reconciliation state when an escaped target cannot be safely cleaned', async () => {
    let cleared = false
    let recoveryFailure = ''
    const repository = {
      beginUploadRecovery: async () => ({ id: '00000000-0000-4000-8000-000000000305' }),
      recordUploadStorageFailure: async () => undefined,
      clearUploadRecovery: async () => { cleared = true },
      markUploadCleanupFailed: async (_id: string, _actorId: string, code: string) => { recoveryFailure = code },
    } as unknown as FileRepository
    const storage = {
      createStorageKey: () => storageKey,
      put: async () => {
        throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝符号链接文件', { recoveryRequired: true })
      },
    } as unknown as FileStorage

    await expect(createFileService(repository, storage).upload({
      stream: Readable.from(Buffer.alloc(10)), originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 10,
      purpose: 'registration_attachment', attachmentSlot: 'resume',
    }, actor)).rejects.toMatchObject({ code: 'FILE_STORAGE_SYMLINK_REJECTED' })
    expect(cleared).toBe(false)
    expect(recoveryFailure).toBe('FILE_STORAGE_TARGET_CLEANUP_FAILED')
  })

  it('does not clear recovery state when anomaly auditing fails', async () => {
    let cleared = false
    const repository = {
      beginUploadRecovery: async () => ({ id: '00000000-0000-4000-8000-000000000306' }),
      recordUploadStorageFailure: async () => { throw new Error('audit database unavailable') },
      clearUploadRecovery: async () => { cleared = true },
    } as unknown as FileRepository
    const storage = {
      createStorageKey: () => storageKey,
      put: async () => { throw new FileStorageError('FILE_STORAGE_SYMLINK_REJECTED', '拒绝符号链接文件') },
    } as unknown as FileStorage

    await expect(createFileService(repository, storage).upload({
      stream: Readable.from(Buffer.alloc(10)), originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 10,
      purpose: 'registration_attachment', attachmentSlot: 'resume',
    }, actor)).rejects.toMatchObject({ code: 'FILE_STORAGE_SYMLINK_REJECTED' })
    expect(cleared).toBe(false)
  })
})
