import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { Readable } from 'node:stream'
import { deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileStorageError,
  createLocalFileStorage,
  preparePrivateDirectory,
} from '../src/modules/files/local-file-storage.js'
import {
  buildContentDisposition,
  DOCX_MIME,
  validateOriginalFileName,
  validateStoredFileContent,
} from '../src/modules/files/file-validation.js'

const buildPdf = (version: '1.7' | '2.0' = '1.7', eol: '\n' | '\r' | '\r\n' = '\n') => {
  const header = Buffer.from(`%PDF-${version}${eol}%\u00e2\u00e3\u00cf\u00d3${eol}`)
  const objects = [
    Buffer.from(`1 0 obj${eol}<< /Type /Catalog /Pages 2 0 R >>${eol}endobj${eol}`),
    Buffer.from(`2 0 obj${eol}<< /Type /Pages /Kids [] /Count 0 >>${eol}endobj${eol}`),
  ]
  const offsets: number[] = []
  let cursor = header.length
  for (const object of objects) {
    offsets.push(cursor)
    cursor += object.length
  }
  const xrefOffset = cursor
  const xref = Buffer.from(
    `xref${eol}0 3${eol}0000000000 65535 f ${eol}${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join(eol)}${eol}`
    + `trailer${eol}<< /Size 3 /Root 1 0 R >>${eol}startxref${eol}${xrefOffset}${eol}%%EOF${eol}`,
  )
  return Buffer.concat([header, ...objects, xref])
}

const incrementalPdf = () => {
  const base = buildPdf()
  const previousXref = Number(/startxref\s+(\d+)/u.exec(base.toString('latin1'))?.[1])
  const updateObject = Buffer.from('3 0 obj\n<< /Producer (test) >>\nendobj\n')
  const updateOffset = base.length
  const xrefOffset = updateOffset + updateObject.length
  const update = Buffer.from(
    `xref\n3 1\n${String(updateOffset).padStart(10, '0')} 00000 n \n`
    + `trailer\n<< /Size 4 /Root 1 0 R /Prev ${previousXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )
  return Buffer.concat([base, updateObject, update])
}

const PDF = buildPdf()
const STORAGE_MARKER = '.panshi-storage-root'
const STORAGE_MARKER_CONTENT = 'panshi-ai4s-camp:file-storage:v1\n'
const PDF_2_0 = buildPdf('2.0')
// Generated with qpdf 12.3.2: qpdf --empty --object-streams=generate -
const QPDF_XREF_STREAM = Buffer.from(
  'JVBERi0xLjUKJb/3ov4KMSAwIG9iago8PCAvVHlwZSAvT2JqU3RtIC9MZW5ndGggNzIgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL04gMiAvRmlyc3QgOSA+PgpzdHJlYW0KeJwzUjBQMFYwNuGysVHQD0hMTy0Gcg0UghT0QyoLUhX0nRNLEnPy0xXs7MAqnPNL80qA8vremSnFCtEKsTB1EK1AVQBGDhWcZW5kc3RyZWFtCmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9YUmVmIC9MZW5ndGggMjcgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0RlY29kZVBhcm1zIDw8IC9Db2x1bW5zIDMgL1ByZWRpY3RvciAxMiA+PiAvVyBbIDEgMSAxIF0gL1Jvb3QgMiAwIFIgL1NpemUgNSAvSUQgWzw2MGJmZTE0ZjlkMmQ4MDUyNDI0OTRmYTM2M2IxNzI2Mz48NjBiZmUxNGY5ZDJkODA1MjQyNDk0ZmEzNjNiMTcyNjM+XSA+PgpzdHJlYW0KeJxjYmBgYGLkB+JPDEwMDIxM/3f8BwAQXQPFCmVuZHN0cmVhbQplbmRvYmoKc3RhcnR4cmVmCjE4NQolJUVPRgo=',
  'base64',
)

const pseudoXrefStream147 = () => {
  const prefix = '%PDF-1.5\n1 0 obj\n<< /Type /XRef /Size 2 /Root 1 0 R /W [1 1 1] >>\nstream\nx\nendstream\nendobj\nstartxref\n9\n'
  const suffix = '%%EOF\n'
  return Buffer.from(`${prefix}${' '.repeat(147 - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`)
}

const crc32 = (input: Buffer) => {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const storedZip = (entries: Array<[string, string | Buffer]>, method: 0 | 8 = 0) => {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [nameText, valueText] of entries) {
    const name = Buffer.from(nameText)
    const value = Buffer.isBuffer(valueText) ? valueText : Buffer.from(valueText)
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

const validDocx = () => storedZip([
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
  ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
  ['word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>'],
])

const pseudoOpenXml = () => storedZip([
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
  return nested.flat().filter((path) => !path.endsWith(`/${STORAGE_MARKER}`))
}

describe('local protected file storage', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const storage = async (maxBytes = 1024) => {
    const parent = await mkdtemp(join(tmpdir(), 'panshi-files-'))
    roots.push(parent)
    const root = join(parent, 'uploads')
    return { root, storage: createLocalFileStorage({ root, maxBytes }) }
  }

  it('streams a validated PDF to a random layered key and returns its digest', async () => {
    const { root, storage: local } = await storage()
    const result = await local.put(Readable.from(PDF), { mime: 'application/pdf', size: PDF.length })

    expect(result.storageKey).toMatch(/^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9-]{36}$/u)
    expect(result.storageKey).not.toContain('resume')
    expect(result.sha256).toBe('1ac8bd87c0db4bebbb88b5bd18845c4b94adfce032e9ce5879806929b9132d9c')
    const opened = await local.open(result.storageKey)
    const chunks: Buffer[] = []
    for await (const chunk of opened) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(PDF)
    expect(await readFile(join(root, result.storageKey))).toEqual(PDF)
    expect(await listFiles(root)).toEqual([join(root, result.storageKey)])
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

  it('rejects structurally invalid PDFs without leaving final or temporary files', async () => {
    const { root, storage: local } = await storage()
    const pseudoPdf = Buffer.from('%PDF-1.7\n%%EOF\n')
    await expect(local.put(Readable.from(pseudoPdf), { mime: 'application/pdf', size: pseudoPdf.length }))
      .rejects.toMatchObject({ code: 'FILE_CONTENT_INVALID' })
    expect(await listFiles(root)).toEqual([])
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

  it('creates a marked private root and enforces ownership modes on internal paths', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'panshi-files-mode-'))
    roots.push(parent)
    const root = join(parent, 'uploads')
    const local = createLocalFileStorage({ root, maxBytes: 1024 })
    const stored = await local.put(Readable.from(PDF), { mime: 'application/pdf', size: PDF.length })
    const [first, second] = stored.storageKey.split('/')
    const mode = async (path: string) => (await lstat(path)).mode & 0o777
    const owner = async (path: string) => (await lstat(path)).uid
    expect(await mode(root)).toBe(0o700)
    expect(await mode(join(root, STORAGE_MARKER))).toBe(0o600)
    expect(await readFile(join(root, STORAGE_MARKER), 'utf8')).toBe(STORAGE_MARKER_CONTENT)
    expect(await mode(join(root, '.tmp'))).toBe(0o700)
    expect(await mode(join(root, first!))).toBe(0o700)
    expect(await mode(join(root, first!, second!))).toBe(0o700)
    expect(await mode(join(root, stored.storageKey))).toBe(0o600)
    for (const path of [root, join(root, '.tmp'), join(root, first!), join(root, first!, second!), join(root, stored.storageKey)]) {
      expect(await owner(path)).toBe(process.getuid?.())
    }
  })

  it('never chmods an existing root and requires a valid private marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-files-existing-'))
    roots.push(root)
    await chmod(root, 0o755)
    expect(() => createLocalFileStorage({ root, maxBytes: 1_024 }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_ROOT_UNSAFE' }))
    expect((await lstat(root)).mode & 0o777).toBe(0o755)

    await chmod(root, 0o700)
    expect(() => createLocalFileStorage({ root, maxBytes: 1_024 }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_MARKER_INVALID' }))
    await writeFile(join(root, STORAGE_MARKER), 'wrong-version\n', { mode: 0o600 })
    expect(() => createLocalFileStorage({ root, maxBytes: 1_024 }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_MARKER_INVALID' }))
    await writeFile(join(root, STORAGE_MARKER), STORAGE_MARKER_CONTENT, { mode: 0o600 })
    await chmod(join(root, STORAGE_MARKER), 0o644)
    expect(() => createLocalFileStorage({ root, maxBytes: 1_024 }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_MARKER_INVALID' }))
    await chmod(join(root, STORAGE_MARKER), 0o600)
    expect(() => createLocalFileStorage({ root, maxBytes: 1_024 })).not.toThrow()
  })

  it('rejects a symlink storage root without writing outside it', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'panshi-files-outside-'))
    const parent = await mkdtemp(join(tmpdir(), 'panshi-files-link-parent-'))
    roots.push(outside, parent)
    const linkedRoot = join(parent, 'uploads')
    await symlink(outside, linkedRoot, 'dir')
    expect(() => createLocalFileStorage({ root: linkedRoot, maxBytes: 1024 }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_ROOT_UNSAFE' }))
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects a temporary storage directory replaced by a symlink', async () => {
    const { root, storage: local } = await storage()
    const outside = await mkdtemp(join(tmpdir(), 'panshi-files-temp-outside-'))
    roots.push(outside)
    await rm(join(root, '.tmp'), { recursive: true })
    await symlink(outside, join(root, '.tmp'), 'dir')
    await expect(local.put(Readable.from(PDF), { mime: 'application/pdf', size: PDF.length }))
      .rejects.toMatchObject({ code: 'FILE_STORAGE_SYMLINK_REJECTED' })
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects broad roots and a root reached through a symlink component', async () => {
    expect(() => preparePrivateDirectory('/', { rejectBroad: true }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_ROOT_UNSAFE' }))
    expect(() => preparePrivateDirectory(homedir(), { rejectBroad: true }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_ROOT_UNSAFE' }))
    expect(() => preparePrivateDirectory(resolve(process.cwd(), '../..'), { rejectBroad: true }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_ROOT_UNSAFE' }))
    expect(() => preparePrivateDirectory(resolve(tmpdir()), { rejectBroad: true }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_ROOT_UNSAFE' }))

    const outside = await mkdtemp(join(tmpdir(), 'panshi-files-component-outside-'))
    const parent = await mkdtemp(join(tmpdir(), 'panshi-files-component-parent-'))
    roots.push(outside, parent)
    await symlink(outside, join(parent, 'linked'), 'dir')
    expect(() => createLocalFileStorage({ root: join(parent, 'linked', 'uploads'), maxBytes: 1_024 }))
      .toThrowError(expect.objectContaining({ code: 'FILE_STORAGE_ROOT_UNSAFE' }))
  })

  it('bounds synchronous validation work to the five MiB policy', async () => {
    const maximum = 5 * 1_024 * 1_024
    const malicious = Buffer.alloc(maximum, 0x20)
    malicious.write('%PDF-1.7\n', 0, 'latin1')
    malicious.write('%%EOF\n', malicious.length - 6, 'latin1')
    const delay = monitorEventLoopDelay({ resolution: 10 })
    delay.enable()
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    const started = performance.now()
    expect(() => validateStoredFileContent(malicious, 'application/pdf', maximum))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
    const elapsed = performance.now() - started
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    delay.disable()
    expect(elapsed).toBeLessThan(1_000)
    expect(delay.max / 1_000_000).toBeLessThan(1_000)
  })

  it('rejects shard and final-file symlink escapes for open and remove', async () => {
    const { root, storage: local } = await storage()
    const outside = await mkdtemp(join(tmpdir(), 'panshi-files-escape-'))
    roots.push(outside)
    const stored = await local.put(Readable.from(PDF), { mime: 'application/pdf', size: PDF.length })
    const [first, second, id] = stored.storageKey.split('/')
    const target = join(root, stored.storageKey)
    const outsideFile = join(outside, 'outside.pdf')
    await writeFile(outsideFile, PDF, { mode: 0o600 })

    await rm(target)
    await symlink(outsideFile, target)
    await expect(local.open(stored.storageKey)).rejects.toMatchObject({ code: 'FILE_STORAGE_SYMLINK_REJECTED' })
    await expect(local.remove(stored.storageKey)).rejects.toMatchObject({ code: 'FILE_STORAGE_SYMLINK_REJECTED' })
    expect(await readFile(outsideFile)).toEqual(PDF)

    await rm(join(root, first!), { recursive: true })
    await mkdir(join(outside, second!), { mode: 0o700 })
    await writeFile(join(outside, second!, id!), PDF, { mode: 0o600 })
    await symlink(outside, join(root, first!), 'dir')
    await expect(local.open(stored.storageKey)).rejects.toMatchObject({ code: 'FILE_STORAGE_SYMLINK_REJECTED' })
    await expect(local.remove(stored.storageKey)).rejects.toMatchObject({ code: 'FILE_STORAGE_SYMLINK_REJECTED' })
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
    const valid = validDocx()
    expect(() => validateStoredFileContent(valid, DOCX_MIME, 1_048_576)).not.toThrow()
    const compressed = storedZip([
      ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>'],
    ], 8)
    expect(() => validateStoredFileContent(compressed, DOCX_MIME, 1_048_576)).not.toThrow()
    expect(() => validateStoredFileContent(pseudoOpenXml(), DOCX_MIME, 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
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
    const document = corrupted.indexOf(Buffer.from('<w:document'))
    corrupted[document] = corrupted[document]! ^ 0xff
    expect(() => validateStoredFileContent(corrupted, DOCX_MIME, 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
  })

  it('accepts PDF 2.0 under the supported policy and rejects unsupported versions', () => {
    expect(() => validateStoredFileContent(PDF_2_0, 'application/pdf', 1_048_576)).not.toThrow()
    expect(() => validateStoredFileContent(Buffer.from(PDF_2_0.toString('latin1').replace('%PDF-2.0', '%PDF-2.1')), 'application/pdf', 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
  })

  it('accepts legal CR-only xref tables and incremental updates without weakening structural checks', () => {
    expect(() => validateStoredFileContent(buildPdf('1.7', '\r'), 'application/pdf', 1_048_576)).not.toThrow()
    expect(() => validateStoredFileContent(incrementalPdf(), 'application/pdf', 1_048_576)).not.toThrow()
    const truncated = PDF.subarray(0, PDF.indexOf(Buffer.from('trailer')))
    expect(() => validateStoredFileContent(truncated, 'application/pdf', 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
  })

  it('accepts a qpdf-generated xref-stream fixture', () => {
    expect(() => validateStoredFileContent(QPDF_XREF_STREAM, 'application/pdf', 1_048_576)).not.toThrow()
  })

  it('rejects the 147-byte xref-stream forgery', () => {
    const pseudo = pseudoXrefStream147()
    expect(pseudo).toHaveLength(147)
    expect(() => validateStoredFileContent(pseudo, 'application/pdf', 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
  })

  it.each([
    ['Length', (value: string) => value.replace('/Length 27', '/Length 99')],
    ['Index', (value: string) => value.replace('/Size 5 ', '/Index [ 0 4 ] /Size 5 ')],
    ['W', (value: string) => value.replace('/W [ 1 1 1 ]', '/W [ 1 2 1 ]')],
    ['Filter', (value: string) => value.replace('/FlateDecode', '/ASCIIHexDecode')],
    ['Root mapping', (value: string) => value.replace('/Root 2 0 R', '/Root 3 0 R')],
  ])('rejects an xref stream with invalid %s', (_field, mutate) => {
    const qpdfText = QPDF_XREF_STREAM.toString('latin1')
    const invalid = mutate(qpdfText)
    expect(invalid).not.toBe(qpdfText)
    expect(() => validateStoredFileContent(Buffer.from(invalid, 'latin1'), 'application/pdf', 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
  })

  it('rejects external, escaping and entity-bearing OpenXML relationships', () => {
    const documentRelationships = (relationship: string) => storedZip([
      ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'],
      ['word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`],
    ], 8)
    expect(() => validateStoredFileContent(documentRelationships(
      '<Relationship Id="rId2" Type="https://example.invalid/link" Target="https://evil.invalid" TargetMode="External"/>',
    ), DOCX_MIME, 16_384)).toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
    expect(() => validateStoredFileContent(documentRelationships(
      '<Relationship Id="rId2" Type="https://example.invalid/data" Target="../../../outside.bin"/>',
    ), DOCX_MIME, 16_384)).toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))

    const xxe = storedZip([
      ['[Content_Types].xml', '<?xml version="1.0"?><!DOCTYPE Types [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'],
    ])
    expect(() => validateStoredFileContent(xxe, DOCX_MIME, 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
  })

  it('binds each DOCX entry and the total expansion to maxBytes', () => {
    const bomb = storedZip([
      ...([['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
        ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
        ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>']] as Array<[string, string]>),
      ['word/media/repeated.bin', 'A'.repeat(1_048_576)],
    ], 8)
    expect(bomb.length).toBeLessThan(4 * 1_024)
    expect(() => validateStoredFileContent(bomb, DOCX_MIME, 4 * 1_024))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))

    const ratioBomb = storedZip([
      ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'],
      ['word/media/repeated.bin', 'A'.repeat(1_048_576)],
    ], 8)
    expect(() => validateStoredFileContent(ratioBomb, DOCX_MIME, 2 * 1_048_576))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))

    const tooManyEntries = storedZip([
      ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'],
      ...Array.from({ length: 20 }, (_, index) => [`word/media/${index}.bin`, 'x'] as [string, string]),
    ], 8)
    expect(() => validateStoredFileContent(tooManyEntries, DOCX_MIME, 8 * 1_024))
      .toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_INVALID' }))
    expect(() => validateStoredFileContent(storedZip([
      ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'],
    ], 8), DOCX_MIME, 4 * 1_024)).not.toThrow()
  })
})
