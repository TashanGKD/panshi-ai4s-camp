import type { Readable } from 'node:stream'

export const FILE_UPLOAD_HARD_MAX_BYTES = 5 * 1_024 * 1_024

export type FileWriteMetadata = {
  mime: string
  size: number
}

export type StoredFile = {
  storageKey: string
  sha256: string
  size: number
  mime: string
}

export interface FileStorage {
  createStorageKey(): string
  put(input: Readable, metadata: FileWriteMetadata, storageKey?: string): Promise<StoredFile>
  open(storageKey: string): Promise<Readable>
  remove(storageKey: string): Promise<void>
}
