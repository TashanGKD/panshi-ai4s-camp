import { extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

export const PDF_MIME = 'application/pdf'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type AllowedFileExtension = 'pdf' | 'docx'

export class FileValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

const allowedByExtension: Record<AllowedFileExtension, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
}

export const validateOriginalFileName = (input: string): {
  originalName: string
  extension: AllowedFileExtension
  mime: string
} => {
  const name = input.normalize('NFC')
  const hasControlCharacter = [...name].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })
  if (
    name.length === 0
    || Buffer.byteLength(name, 'utf8') > 255
    || hasControlCharacter
    || /[\\/]/u.test(name)
    || name === '.'
    || name === '..'
    || name.startsWith('..')
  ) {
    throw new FileValidationError('FILE_NAME_INVALID', '文件名不安全')
  }

  const extension = extname(name).slice(1).toLowerCase()
  if (!(extension in allowedByExtension)) {
    throw new FileValidationError('FILE_EXTENSION_NOT_ALLOWED', '仅支持 PDF 或 DOCX 文件')
  }

  return {
    originalName: name,
    extension: extension as AllowedFileExtension,
    mime: allowedByExtension[extension as AllowedFileExtension],
  }
}

const encodeRfc5987 = (value: string) => encodeURIComponent(value)
  .replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

const asciiFallback = (name: string) => {
  const extension = extname(name).toLowerCase().replace(/[^a-z0-9.]/gu, '')
  const stem = name.slice(0, Math.max(0, name.length - extname(name).length))
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/gu, '')
    .replace(/[^A-Za-z0-9._ -]/gu, '_')
    .replace(/[ ]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^[._-]+|[._-]+$/gu, '')
  return `${stem || 'download'}${extension || ''}`.slice(0, 120)
}

export const buildContentDisposition = (unsafeName: string): string => {
  const { originalName } = validateOriginalFileName(unsafeName)
  const fallback = asciiFallback(originalName).replace(/["\\]/gu, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(originalName)}`
}

const validatePdf = (content: Buffer) => {
  if (content.length < 12 || !content.subarray(0, 8).toString('ascii').match(/^%PDF-1\.[0-9]/u)) {
    throw new FileValidationError('FILE_CONTENT_INVALID', 'PDF 文件签名无效')
  }
  const tail = content.subarray(Math.max(0, content.length - 1_024)).toString('latin1')
  if (!/%%EOF[\t\n\f\r ]*$/u.test(tail)) {
    throw new FileValidationError('FILE_CONTENT_INVALID', 'PDF 文件不完整')
  }
}

const findEndOfCentralDirectory = (content: Buffer): number => {
  const minimum = Math.max(0, content.length - 65_557)
  for (let offset = content.length - 22; offset >= minimum; offset -= 1) {
    if (content.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

const validateZipEntryName = (name: string) => {
  if (
    name.length === 0
    || Buffer.byteLength(name, 'utf8') > 512
    || name.includes('\0')
    || name.includes('\\')
    || name.startsWith('/')
    || /^[A-Za-z]:/u.test(name)
    || name.split('/').some((part) => part === '..')
  ) {
    throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 包含不安全条目')
  }
}

const crc32 = (input: Buffer) => {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const validateDocx = (content: Buffer, compressedLimit: number) => {
  if (content.length < 22 || content.readUInt32LE(0) !== 0x04034b50) {
    throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX ZIP 签名无效')
  }
  const eocd = findEndOfCentralDirectory(content)
  if (eocd < 0 || eocd + 22 > content.length) {
    throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 中央目录缺失')
  }
  const disk = content.readUInt16LE(eocd + 4)
  const centralDisk = content.readUInt16LE(eocd + 6)
  const entriesOnDisk = content.readUInt16LE(eocd + 8)
  const totalEntries = content.readUInt16LE(eocd + 10)
  const centralSize = content.readUInt32LE(eocd + 12)
  const centralOffset = content.readUInt32LE(eocd + 16)
  const commentLength = content.readUInt16LE(eocd + 20)
  if (
    disk !== 0
    || centralDisk !== 0
    || entriesOnDisk !== totalEntries
    || totalEntries < 3
    || totalEntries > 1_000
    || eocd + 22 + commentLength !== content.length
    || centralOffset + centralSize !== eocd
  ) {
    throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX ZIP 结构无效')
  }

  const names = new Set<string>()
  let cursor = centralOffset
  let totalUncompressed = 0
  const uncompressedLimit = Math.min(100 * 1_024 * 1_024, Math.max(16 * 1_024 * 1_024, compressedLimit * 20))
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocd || content.readUInt32LE(cursor) !== 0x02014b50) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 中央目录损坏')
    }
    const versionMadeBy = content.readUInt16LE(cursor + 4)
    const flags = content.readUInt16LE(cursor + 8)
    const method = content.readUInt16LE(cursor + 10)
    const expectedCrc = content.readUInt32LE(cursor + 16)
    const compressedSize = content.readUInt32LE(cursor + 20)
    const uncompressedSize = content.readUInt32LE(cursor + 24)
    const nameLength = content.readUInt16LE(cursor + 28)
    const extraLength = content.readUInt16LE(cursor + 30)
    const entryCommentLength = content.readUInt16LE(cursor + 32)
    const externalAttributes = content.readUInt32LE(cursor + 38)
    const localOffset = content.readUInt32LE(cursor + 42)
    const next = cursor + 46 + nameLength + extraLength + entryCommentLength
    const unixFileType = (externalAttributes >>> 16) & 0xf000
    if (
      next > eocd
      || (flags & 0x0001) !== 0
      || ![0, 8].includes(method)
      || ((versionMadeBy >>> 8) === 3 && unixFileType === 0xa000)
    ) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 包含不支持的 ZIP 条目')
    }
    const name = content.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    validateZipEntryName(name)
    const lowerName = name.toLowerCase()
    if (
      lowerName === 'word/vbaproject.bin'
      || lowerName.startsWith('word/activex/')
      || lowerName.startsWith('word/embeddings/')
    ) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 包含不允许的活动内容')
    }
    if (names.has(name)) throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 包含重复条目')
    names.add(name)
    totalUncompressed += uncompressedSize
    if (
      uncompressedSize > uncompressedLimit
      || totalUncompressed > uncompressedLimit
      || (uncompressedSize > 1_048_576 && (compressedSize === 0 || uncompressedSize / compressedSize > 100))
    ) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 压缩比例或展开大小异常')
    }
    if (localOffset + 30 > centralOffset || content.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 本地文件头损坏')
    }
    const localFlags = content.readUInt16LE(localOffset + 6)
    const localMethod = content.readUInt16LE(localOffset + 8)
    const localCrc = content.readUInt32LE(localOffset + 14)
    const localCompressedSize = content.readUInt32LE(localOffset + 18)
    const localUncompressedSize = content.readUInt32LE(localOffset + 22)
    if (
      localFlags !== flags
      || localMethod !== method
      || ((flags & 0x0008) === 0 && (
        localCrc !== expectedCrc
        || localCompressedSize !== compressedSize
        || localUncompressedSize !== uncompressedSize
      ))
    ) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 本地文件头与中央目录不一致')
    }
    const localNameLength = content.readUInt16LE(localOffset + 26)
    const localExtraLength = content.readUInt16LE(localOffset + 28)
    const localNameEnd = localOffset + 30 + localNameLength
    const dataEnd = localNameEnd + localExtraLength + compressedSize
    if (
      dataEnd > centralOffset
      || content.subarray(localOffset + 30, localNameEnd).toString('utf8') !== name
    ) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 条目偏移无效')
    }
    const compressed = content.subarray(localNameEnd + localExtraLength, dataEnd)
    let uncompressed: Buffer
    try {
      uncompressed = method === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: uncompressedLimit })
    } catch {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 条目解压失败')
    }
    if (uncompressed.length !== uncompressedSize || crc32(uncompressed) !== expectedCrc) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 条目校验失败')
    }
    cursor = next
  }
  if (cursor !== eocd) throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 中央目录长度无效')
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    if (!names.has(required)) throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 缺少必要的 OpenXML 条目')
  }
}

export const validateStoredFileContent = (content: Buffer, mime: string, maxBytes: number): void => {
  if (mime === PDF_MIME) {
    validatePdf(content)
    return
  }
  if (mime === DOCX_MIME) {
    validateDocx(content, maxBytes)
    return
  }
  throw new FileValidationError('FILE_MIME_NOT_ALLOWED', '仅支持 PDF 或 DOCX 文件')
}
