import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileStorageError,
  createLocalFileStorage,
} from '../src/modules/files/local-file-storage.js'
import {
  buildContentDisposition,
  DOCX_MIME,
  validateOriginalFileName,
  validateStoredFileContent,
} from '../src/modules/files/file-validation.js'

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')

const crc32 = (input: Buffer) => {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const storedZip = (entries: Array<[string, string]>, method: 0 | 8 = 0) => {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [nameText, valueText] of entries) {
    const name = Buffer.from(nameText)
    const value = Buffer.from(valueText)
    const encoded = method === 8 ? deflateRawSync(value) : value
    const checksum = crc32(value)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(encoded.length, 18)
    local.writeUInt32LE(value.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, encoded)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(encoded.length, 20)
    central.writeUInt32LE(value.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + encoded.length
  }
  const central = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, eocd])
}

const minimalDocx = () => storedZip([
  ['[Content_Types].xml', '<Types/>'],
  ['_rels/.rels', '<Relationships/>'],
  ['word/document.xml', '<document/>'],
])

const listFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  }))
  return nested.flat()
}

describe('local protected file storage', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const storage = async (maxBytes = 1024) => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-files-'))
    roots.push(root)
    return { root, storage: createLocalFileStorage({ root, maxBytes }) }
  }

  it('streams a validated PDF to a random layered key and returns its digest', async () => {
    const { root, storage: local } = await storage()
    const result = await local.put(Readable.from(PDF), { mime: 'application/pdf', size: PDF.length })

    expect(result.storageKey).toMatch(/^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9-]{36}$/u)
    expect(result.storageKey).not.toContain('resume')
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u)
    const opened = await local.open(result.storageKey)
    const chunks: Buffer[] = []
    for await (const chunk of opened) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(PDF)
    expect(await readFile(join(root, result.storageKey))).toEqual(PDF)
  })

  it('rejects oversize, truncated, MIME-mismatched and interrupted streams without residue', async () => {
    const cases: Array<{ stream: Readable, mime: string, size: number, code: string }> = [
      { stream: Readable.from(PDF), mime: 'application/pdf', size: PDF.length, code: 'FILE_TOO_LARGE' },
      { stream: Readable.from(Buffer.from('%PDF-1.7\ntruncated')), mime: 'application/pdf', size: 18, code: 'FILE_CONTENT_INVALID' },
      { stream: Readable.from(PDF), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: PDF.length, code: 'FILE_CONTENT_INVALID' },
      {
        stream: new Readable({ read() { this.destroy(new Error('client interrupted')) } }),
        mime: 'application/pdf',
        size: PDF.length,
        code: 'FILE_WRITE_INTERRUPTED',
      },
    ]

    for (const [index, item] of cases.entries()) {
      const { root, storage: local } = await storage(index === 0 ? PDF.length - 1 : 1024)
      await expect(local.put(item.stream, { mime: item.mime, size: item.size }))
        .rejects.toMatchObject({ code: item.code })
      expect(await listFiles(root)).toEqual([])
    }
  })

  it('rejects storage-key traversal and removes stored files idempotently', async () => {
    const { storage: local } = await storage()
    await expect(local.open('../../etc/passwd')).rejects.toBeInstanceOf(FileStorageError)
    await expect(local.open('/etc/passwd')).rejects.toMatchObject({ code: 'FILE_STORAGE_KEY_INVALID' })
    const stored = await local.put(Readable.from(PDF), { mime: 'application/pdf', size: PDF.length })
    await local.remove(stored.storageKey)
    await local.remove(stored.storageKey)
    await expect(local.open(stored.storageKey)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })
})

describe('safe file names and download headers', () => {
  it.each(['../resume.pdf', '..\\resume.pdf', 'resume\r\nX-Evil: yes.pdf', '/tmp/resume.pdf', 'resume\0.pdf'])(
    'rejects unsafe original name %j',
    (name) => expect(() => validateOriginalFileName(name)).toThrowError(expect.objectContaining({ code: 'FILE_NAME_INVALID' })),
  )

  it('accepts PDF/DOCX only and emits a CRLF-safe Unicode disposition with ASCII fallback', () => {
    expect(validateOriginalFileName('个人简历.PDF')).toMatchObject({ extension: 'pdf', mime: 'application/pdf' })
    expect(validateOriginalFileName('个人简历.docx')).toMatchObject({ extension: 'docx' })
    expect(() => validateOriginalFileName('个人简历.doc')).toThrowError(expect.objectContaining({ code: 'FILE_EXTENSION_NOT_ALLOWED' }))
    const disposition = buildContentDisposition('个人 简历（最终版）.pdf')
    expect(disposition).toContain('attachment; filename="download.pdf"')
    expect(disposition).toContain("filename*=UTF-8''")
    expect(disposition).not.toMatch(/[\r\n]/u)
  })

  it('accepts a bounded DOCX and rejects path traversal and corrupted entry data', () => {
    const valid = minimalDocx()
    expect(() => validateStoredFileContent(valid, DOCX_MIME, 1_048_576)).not.toThrow()
    const compressed = storedZip([
      ['[Content_Types].xml', '<Types/>'],
      ['_rels/.rels', '<Relationships/>'],
      ['word/document.xml', '<document/>'],
    ], 8)
    expect(() => validateStoredFileContent(compressed, DOCX_MIME, 1_048_576)).not.toThrow()
    const dangerous = storedZip([
      ['[Content_Types].xml', '<Types/>'],
      ['_rels/.rels', '<Relationships/>'],
      ['../word/document.xml', '<document/>'],
    ])
    expect(() => validateStoredFileContent(dangerous, DOCX_MIME, 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))

    const macroEnabled = storedZip([
      ['[Content_Types].xml', '<Types/>'],
      ['_rels/.rels', '<Relationships/>'],
      ['word/document.xml', '<document/>'],
      ['word/vbaProject.bin', 'macro payload'],
    ])
    expect(() => validateStoredFileContent(macroEnabled, DOCX_MIME, 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))

    const inconsistentHeader = Buffer.from(valid)
    inconsistentHeader.writeUInt16LE(8, 8)
    expect(() => validateStoredFileContent(inconsistentHeader, DOCX_MIME, 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))

    const symbolicLink = Buffer.from(valid)
    const centralHeader = symbolicLink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    symbolicLink.writeUInt16LE(0x0314, centralHeader + 4)
    symbolicLink.writeUInt32LE(0xa0000000, centralHeader + 38)
    expect(() => validateStoredFileContent(symbolicLink, DOCX_MIME, 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))

    const corrupted = Buffer.from(valid)
    const document = corrupted.indexOf(Buffer.from('<document/>'))
    corrupted[document] = corrupted[document]! ^ 0xff
    expect(() => validateStoredFileContent(corrupted, DOCX_MIME, 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
  })
})
