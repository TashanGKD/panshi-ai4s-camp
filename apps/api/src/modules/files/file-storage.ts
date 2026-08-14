import type { Readable } from 'node:stream'

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
  put(input: Readable, metadata: FileWriteMetadata): Promise<StoredFile>
  open(storageKey: string): Promise<Readable>
  remove(storageKey: string): Promise<void>
}

