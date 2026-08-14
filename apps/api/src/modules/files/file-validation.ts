import { extname, posix } from 'node:path'
import { inflateRawSync, inflateSync } from 'node:zlib'

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

const PDF_VERSION_PATTERN = /^(?:1\.[0-7]|2\.0)$/u

const pdfInvalid = (message = 'PDF 文件结构无效'): never => {
  throw new FileValidationError('FILE_CONTENT_INVALID', message)
}

const pdfDictionaryValue = (dictionary: string, name: string, pattern: string) => {
  const match = new RegExp(`/${name}\\s+${pattern}`, 'u').exec(dictionary)
  return match?.[1]
}

const parsePdfDictionary = (dictionary: string) => {
  const size = Number(pdfDictionaryValue(dictionary, 'Size', '(\\d+)'))
  const rootMatch = new RegExp('/Root\\s+(\\d+)\\s+(\\d+)\\s+R', 'u').exec(dictionary)
  const previous = Number(pdfDictionaryValue(dictionary, 'Prev', '(\\d+)'))
  if (!Number.isSafeInteger(size) || size < 1) pdfInvalid()
  return {
    size,
    root: rootMatch ? { object: Number(rootMatch[1]), generation: Number(rootMatch[2]) } : undefined,
    previous: Number.isSafeInteger(previous) && previous >= 0 ? previous : undefined,
  }
}

const findPdfDictionaryEnd = (text: string, start: number) => {
  if (!text.startsWith('<<', start)) return -1
  let depth = 0
  for (let cursor = start; cursor < text.length - 1; cursor += 1) {
    if (text.startsWith('<<', cursor)) {
      depth += 1
      cursor += 1
    } else if (text.startsWith('>>', cursor)) {
      depth -= 1
      if (depth === 0) return cursor + 2
      cursor += 1
    }
  }
  return -1
}

type PdfXrefEntry =
  | { kind: 'free', nextFree: number, generation: number }
  | { kind: 'direct', offset: number, generation: number }
  | { kind: 'compressed', objectStream: number, index: number }
type PdfXrefSection = {
  entries: Map<number, PdfXrefEntry>
  root?: { object: number, generation: number }
  previous?: number
  size: number
  stream: boolean
}

const readPdfInteger = (dictionary: string, name: string) => {
  const direct = new RegExp(`/${name}\\s+(\\d+)(?!\\d)(?!\\s+\\d+\\s+R)`, 'u').exec(dictionary)
  const value = direct ? Number(direct[1]) : NaN
  if (!Number.isSafeInteger(value) || value < 0) pdfInvalid()
  return value
}

const readPdfArray = (dictionary: string, name: string) => {
  const marker = new RegExp(`/${name}\\b`, 'u').exec(dictionary)
  if (!marker) return undefined
  const value = new RegExp(`/${name}\\s*\\[([^\\]]*)\\]`, 'u').exec(dictionary)
  if (!value || !/^(?:\s*\d+\s*)*$/u.test(value[1]!)) pdfInvalid()
  const arrayValue = value![1]!
  return arrayValue.trim() === '' ? [] : arrayValue.trim().split(/\s+/u).map(Number)
}

const pdfStreamBytes = (content: Buffer, dictionary: string, dictionaryEnd: number) => {
  const length = readPdfInteger(dictionary, 'Length')
  const marker = /^[\t\f\r\n ]*stream(?:\r\n|\n|\r)/u.exec(content.toString('latin1', dictionaryEnd))
  if (!marker) pdfInvalid('PDF stream 结构无效')
  const start = dictionaryEnd + marker![0].length
  const end = start + length
  if (end > content.length || !/^(?:\r\n|\n|\r)?endstream\b/u.test(content.toString('latin1', end))) {
    pdfInvalid('PDF stream 长度无效')
  }
  return content.subarray(start, end)
}

const paeth = (left: number, above: number, upperLeft: number) => {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

const undoPngPrediction = (input: Buffer, rowBytes: number, predictor: number) => {
  if (rowBytes < 1 || input.length % (rowBytes + 1) !== 0) pdfInvalid('PDF stream 预测器数据无效')
  const rows = input.length / (rowBytes + 1)
  const output = Buffer.alloc(rows * rowBytes)
  for (let row = 0; row < rows; row += 1) {
    const filter = input[row * (rowBytes + 1)]!
    if (filter > 4 || (predictor !== 15 && filter !== predictor - 10)) pdfInvalid('PDF stream 预测器无效')
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = input[row * (rowBytes + 1) + column + 1]!
      const outputOffset = row * rowBytes + column
      const left = column > 0 ? output[outputOffset - 1]! : 0
      const above = row > 0 ? output[outputOffset - rowBytes]! : 0
      const upperLeft = row > 0 && column > 0 ? output[outputOffset - rowBytes - 1]! : 0
      const predictor = filter === 1 ? left
        : filter === 2 ? above
          : filter === 3 ? Math.floor((left + above) / 2)
            : filter === 4 ? paeth(left, above, upperLeft)
              : 0
      output[outputOffset] = (encoded + predictor) & 0xff
    }
  }
  return output
}

const decodePdfStream = (encoded: Buffer, dictionary: string, maxDecodedBytes: number) => {
  const filterMarker = /\/Filter\b/u.test(dictionary)
  const directFilter = /\/Filter\s+\/([A-Za-z0-9]+)\b/u.exec(dictionary)?.[1]
  const arrayFilter = /\/Filter\s*\[\s*\/([A-Za-z0-9]+)\s*\]/u.exec(dictionary)?.[1]
  if (filterMarker && !directFilter && !arrayFilter) pdfInvalid('PDF stream 过滤器无效')
  const filter = directFilter ?? arrayFilter
  if (filter !== undefined && filter !== 'FlateDecode' && filter !== 'Fl') pdfInvalid('PDF stream 过滤器不受支持')

  let decoded: Buffer
  try {
    decoded = filter === undefined ? encoded : inflateSync(encoded, { maxOutputLength: maxDecodedBytes + 1 })
  } catch {
    pdfInvalid('PDF stream 解码失败')
  }
  if (decoded!.length > maxDecodedBytes) pdfInvalid('PDF stream 展开大小异常')

  const decodeParmsMarker = /\/DecodeParms\b/u.exec(dictionary)
  if (!decodeParmsMarker) return decoded!
  if (filter === undefined) pdfInvalid('PDF stream 解码参数无效')
  const parametersStart = dictionary.indexOf('<<', decodeParmsMarker.index)
  const parametersEnd = parametersStart < 0 ? -1 : findPdfDictionaryEnd(dictionary, parametersStart)
  if (parametersStart < 0 || parametersEnd < 0) pdfInvalid('PDF stream 解码参数无效')
  const parameters = dictionary.slice(parametersStart, parametersEnd)
  const predictor = /\/Predictor\b/u.test(parameters) ? readPdfInteger(parameters, 'Predictor') : 1
  if (predictor === 1) return decoded!
  if (predictor < 10 || predictor > 15) pdfInvalid('PDF stream 预测器不受支持')
  const colors = /\/Colors\b/u.test(parameters) ? readPdfInteger(parameters, 'Colors') : 1
  const bits = /\/BitsPerComponent\b/u.test(parameters) ? readPdfInteger(parameters, 'BitsPerComponent') : 8
  const columns = /\/Columns\b/u.test(parameters) ? readPdfInteger(parameters, 'Columns') : 1
  if (colors !== 1 || bits !== 8 || columns < 1 || columns > maxDecodedBytes) pdfInvalid('PDF stream 预测器参数无效')
  return undoPngPrediction(decoded!, columns, predictor)
}

const readPdfField = (input: Buffer, offset: number, width: number) => {
  if (width < 0 || width > 8 || offset < 0 || offset + width > input.length) pdfInvalid()
  let value = 0
  for (let index = 0; index < width; index += 1) {
    value = value * 256 + input[offset + index]!
    if (!Number.isSafeInteger(value)) pdfInvalid('PDF 交叉引用数值溢出')
  }
  return value
}

const validatePdfXrefStream = (content: Buffer, offset: number, text: string): PdfXrefSection => {
  const objectHeaderMatch = /^(\d+)\s+(\d+)\s+obj\b/u.exec(text.slice(offset))
  if (!objectHeaderMatch) pdfInvalid()
  const objectHeader = objectHeaderMatch!
  const dictionaryStart = text.indexOf('<<', offset + objectHeader[0].length)
  const dictionaryEnd = dictionaryStart < 0 ? -1 : findPdfDictionaryEnd(text, dictionaryStart)
  if (dictionaryStart < 0 || dictionaryEnd < 0) pdfInvalid()
  const dictionary = text.slice(dictionaryStart, dictionaryEnd)
  if (!/\/Type\s+\/XRef(?:\s|\/|>)/u.test(dictionary)) pdfInvalid()
  const parsed = parsePdfDictionary(dictionary)
  const widthsResult = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/u.exec(dictionary)
  if (!widthsResult) pdfInvalid()
  const widthsMatch = widthsResult!
  const widths = widthsMatch.slice(1).map(Number)
  const recordWidth = widths.reduce((sum, width) => sum + width, 0)
  if (recordWidth < 1 || widths.some((width) => !Number.isInteger(width) || width < 0 || width > 8)) pdfInvalid()
  const indexValues = readPdfArray(dictionary, 'Index') ?? [0, parsed.size]
  if (indexValues.length === 0 || indexValues.length % 2 !== 0) pdfInvalid('PDF 交叉引用 Index 无效')
  let entryCount = 0
  let previousEnd = 0
  for (let index = 0; index < indexValues.length; index += 2) {
    const first = indexValues[index]!
    const count = indexValues[index + 1]!
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count < 1 || first < previousEnd || first + count > parsed.size) {
      pdfInvalid('PDF 交叉引用 Index 无效')
    }
    previousEnd = first + count
    entryCount += count
  }
  const expectedBytes = entryCount * recordWidth
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > Math.max(65_536, content.length * 4)) {
    pdfInvalid('PDF 交叉引用流过大')
  }
  const encoded = pdfStreamBytes(content, dictionary, dictionaryEnd)
  const decoded = decodePdfStream(encoded, dictionary, expectedBytes + entryCount)
  if (decoded.length !== expectedBytes) pdfInvalid('PDF 交叉引用流长度无效')

  const entries = new Map<number, PdfXrefEntry>()
  let cursor = 0
  for (let range = 0; range < indexValues.length; range += 2) {
    const first = indexValues[range]!
    const count = indexValues[range + 1]!
    for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
      const object = first + entryIndex
      const type = widths[0] === 0 ? 1 : readPdfField(decoded, cursor, widths[0]!)
      const fieldTwo = readPdfField(decoded, cursor + widths[0]!, widths[1]!)
      const fieldThree = readPdfField(decoded, cursor + widths[0]! + widths[1]!, widths[2]!)
      cursor += recordWidth
      if (type === 0) {
        if (fieldTwo >= parsed.size || fieldThree > 65_535) pdfInvalid('PDF 空闲对象记录无效')
        entries.set(object, { kind: 'free', nextFree: fieldTwo, generation: fieldThree })
      } else if (type === 1) {
        if (fieldTwo < 1 || fieldTwo >= content.length || fieldThree > 65_535) pdfInvalid('PDF 对象偏移无效')
        if (!new RegExp(`^${object}\\s+${fieldThree}\\s+obj\\b`, 'u').test(text.slice(fieldTwo))) pdfInvalid('PDF 对象偏移无效')
        entries.set(object, { kind: 'direct', offset: fieldTwo, generation: fieldThree })
      } else if (type === 2) {
        if (object < 1 || fieldTwo < 1 || fieldTwo >= parsed.size || fieldThree >= parsed.size) pdfInvalid('PDF 对象流记录无效')
        entries.set(object, { kind: 'compressed', objectStream: fieldTwo, index: fieldThree })
      } else {
        pdfInvalid('PDF 交叉引用类型无效')
      }
    }
  }
  return { entries, ...parsed, stream: true }
}

const readPdfLine = (text: string, start: number): { line: string, next: number } | undefined => {
  let cursor = start
  while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') cursor += 1
  if (cursor >= text.length) return undefined
  const line = text.slice(start, cursor)
  if (text[cursor] === '\r' && text[cursor + 1] === '\n') cursor += 2
  else cursor += 1
  return { line, next: cursor }
}

const validatePdfTraditionalXref = (content: Buffer, offset: number, text: string): PdfXrefSection => {
  if (!text.startsWith('xref', offset)) pdfInvalid()
  let cursor = offset + 4
  const offsets = new Map<number, PdfXrefEntry>()
  let subsectionCount = 0
  const skipWhitespace = () => {
    while (/[\t\n\f\r ]/u.test(text[cursor] ?? '')) cursor += 1
  }
  const readLine = () => {
    const result = readPdfLine(text, cursor)
    if (result) cursor = result.next
    return result?.line
  }
  while (true) {
    skipWhitespace()
    if (text.startsWith('trailer', cursor)) break
    const header = readLine()
    const match = header ? /^(\d+)\s+(\d+)$/u.exec(header) : null
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 1_000_000) pdfInvalid('PDF 交叉引用表无效')
    const firstObject = Number(match![1])
    const count = Number(match![2])
    subsectionCount += 1
    if (subsectionCount > 1000) pdfInvalid('PDF 交叉引用表无效')
    for (let index = 0; index < count; index += 1) {
      const entry = readLine()
      const entryMatch = entry ? /^(\d{10})\s+(\d{5})\s+([fn])(?:\s*)$/u.exec(entry) : null
      if (!entryMatch) pdfInvalid('PDF 交叉引用条目无效')
      const object = firstObject + index
      const fieldTwo = Number(entryMatch![1])
      const generation = Number(entryMatch![2])
      offsets.set(object, entryMatch![3] === 'n'
        ? { kind: 'direct', offset: fieldTwo, generation }
        : { kind: 'free', nextFree: fieldTwo, generation })
    }
  }
  const trailerStart = cursor
  const dictionaryStart = text.indexOf('<<', trailerStart + 'trailer'.length)
  const dictionaryEnd = dictionaryStart < 0 ? -1 : findPdfDictionaryEnd(text, dictionaryStart)
  if (dictionaryStart < 0 || dictionaryEnd < 0) pdfInvalid('PDF trailer 缺失')
  const parsed = parsePdfDictionary(text.slice(dictionaryStart, dictionaryEnd))
  if ([...offsets.keys()].some((object) => object >= parsed.size)) pdfInvalid('PDF 交叉引用范围无效')
  return { entries: offsets, ...parsed, stream: false }
}

const validateCompressedPdfRoot = (
  content: Buffer,
  text: string,
  rootObject: number,
  rootEntry: Extract<PdfXrefEntry, { kind: 'compressed' }>,
  entries: Map<number, PdfXrefEntry>,
) => {
  const container = entries.get(rootEntry.objectStream)
  if (!container || container.kind !== 'direct' || container.generation !== 0) pdfInvalid('PDF 根对象流缺失')
  const directContainer = container! as Extract<PdfXrefEntry, { kind: 'direct' }>
  const objectHeader = new RegExp(`^${rootEntry.objectStream}\\s+0\\s+obj\\b`, 'u').exec(text.slice(directContainer.offset))
  if (!objectHeader) pdfInvalid('PDF 根对象流无效')
  const dictionaryStart = text.indexOf('<<', directContainer.offset + objectHeader![0].length)
  const dictionaryEnd = dictionaryStart < 0 ? -1 : findPdfDictionaryEnd(text, dictionaryStart)
  if (dictionaryStart < 0 || dictionaryEnd < 0) pdfInvalid('PDF 根对象流无效')
  const dictionary = text.slice(dictionaryStart, dictionaryEnd)
  if (!/\/Type\s+\/ObjStm(?:\s|\/|>)/u.test(dictionary)) pdfInvalid('PDF 根对象流无效')
  const objectCount = readPdfInteger(dictionary, 'N')
  const firstOffset = readPdfInteger(dictionary, 'First')
  if (objectCount < 1 || objectCount > 100_000 || rootEntry.index >= objectCount) pdfInvalid('PDF 根对象流索引无效')
  const encoded = pdfStreamBytes(content, dictionary, dictionaryEnd)
  const maxDecoded = Math.min(32 * 1_024 * 1_024, Math.max(65_536, content.length * 20))
  const decoded = decodePdfStream(encoded, dictionary, maxDecoded)
  if (firstOffset > decoded.length) pdfInvalid('PDF 根对象流头无效')
  const header = decoded.subarray(0, firstOffset).toString('latin1').trim()
  if (!/^(?:\d+\s+\d+\s*)+$/u.test(header)) pdfInvalid('PDF 根对象流头无效')
  const pairs = header.split(/\s+/u).map(Number)
  if (pairs.length !== objectCount * 2) pdfInvalid('PDF 根对象流头无效')
  const objects = Array.from({ length: objectCount }, (_, index) => ({
    object: pairs[index * 2]!,
    offset: pairs[index * 2 + 1]!,
  }))
  if (objects.some((entry, index) => (
    !Number.isSafeInteger(entry.object)
    || !Number.isSafeInteger(entry.offset)
    || entry.object < 1
    || entry.offset < 0
    || firstOffset + entry.offset > decoded.length
    || (index > 0 && entry.offset <= objects[index - 1]!.offset)
  ))) pdfInvalid('PDF 根对象流头无效')
  const mapped = objects[rootEntry.index]!
  if (mapped.object !== rootObject) pdfInvalid('PDF Root 映射无效')
  const bodyStart = firstOffset + mapped.offset
  const bodyEnd = rootEntry.index + 1 < objects.length
    ? firstOffset + objects[rootEntry.index + 1]!.offset
    : decoded.length
  if (!/\/Type\s+\/Catalog(?:\s|\/|>)/u.test(decoded.subarray(bodyStart, bodyEnd).toString('latin1'))) {
    pdfInvalid('PDF 根对象无效')
  }
}

const validateCompressedPdfMappings = (text: string, entries: Map<number, PdfXrefEntry>) => {
  const objectStreamSizes = new Map<number, number>()
  for (const entry of entries.values()) {
    if (entry.kind !== 'compressed') continue
    let objectCount = objectStreamSizes.get(entry.objectStream)
    if (objectCount === undefined) {
      const container = entries.get(entry.objectStream)
      if (!container || container.kind !== 'direct' || container.generation !== 0) pdfInvalid('PDF 对象流映射无效')
      const directContainer = container! as Extract<PdfXrefEntry, { kind: 'direct' }>
      const objectHeader = new RegExp(`^${entry.objectStream}\\s+0\\s+obj\\b`, 'u').exec(text.slice(directContainer.offset))
      if (!objectHeader) pdfInvalid('PDF 对象流映射无效')
      const dictionaryStart = text.indexOf('<<', directContainer.offset + objectHeader![0].length)
      const dictionaryEnd = dictionaryStart < 0 ? -1 : findPdfDictionaryEnd(text, dictionaryStart)
      if (dictionaryStart < 0 || dictionaryEnd < 0) pdfInvalid('PDF 对象流映射无效')
      const dictionary = text.slice(dictionaryStart, dictionaryEnd)
      if (!/\/Type\s+\/ObjStm(?:\s|\/|>)/u.test(dictionary)) pdfInvalid('PDF 对象流映射无效')
      objectCount = readPdfInteger(dictionary, 'N')
      if (objectCount < 1 || objectCount > 100_000) pdfInvalid('PDF 对象流映射无效')
      objectStreamSizes.set(entry.objectStream, objectCount)
    }
    if (entry.index >= objectCount) pdfInvalid('PDF 对象流索引无效')
  }
}

const validatePdf = (content: Buffer) => {
  const text = content.toString('latin1')
  const headerMatch = /^%PDF-(\d\.\d)(?:\r\n|\n|\r)/u.exec(text)
  if (!headerMatch || !PDF_VERSION_PATTERN.test(headerMatch[1]!)) pdfInvalid('PDF 版本不受支持')
  const header = headerMatch!
  const eof = text.lastIndexOf('%%EOF')
  if (eof < 0 || !/^[\t\n\f\r ]*$/u.test(text.slice(eof + 5))) pdfInvalid('PDF 文件不完整')
  const startxrefPosition = text.lastIndexOf('startxref')
  if (startxrefPosition < 0) pdfInvalid('PDF 缺少 startxref')
  const startxrefMatch = /startxref\s+(\d+)/u.exec(text.slice(startxrefPosition))
  const offset = startxrefMatch ? Number(startxrefMatch[1]) : NaN
  if (!Number.isSafeInteger(offset) || offset < header[0].length || offset >= eof) pdfInvalid('PDF startxref 无效')
  const seen = new Set<number>()
  const entries = new Map<number, PdfXrefEntry>()
  let root: { object: number, generation: number } | undefined
  let largestSize = 0
  let hasXrefStream = false
  let current: number | undefined = offset
  for (let depth = 0; current !== undefined; depth += 1) {
    if (depth >= 32 || current < header[0].length || current >= eof || seen.has(current)) pdfInvalid('PDF 交叉引用链无效')
    seen.add(current)
    const section: PdfXrefSection = text.startsWith('xref', current)
      ? validatePdfTraditionalXref(content, current, text)
      : validatePdfXrefStream(content, current, text)
    hasXrefStream ||= section.stream
    root ??= section.root
    largestSize = Math.max(largestSize, section.size)
    for (const [object, entry] of section.entries) if (!entries.has(object)) entries.set(object, entry)
    current = section.previous
  }
  if (!root || root.object >= largestSize) pdfInvalid('PDF 根对象缺失')
  validateCompressedPdfMappings(text, entries)
  const documentRoot = root!
  const rootEntry = entries.get(documentRoot.object)
  if (!rootEntry || rootEntry.kind === 'free') pdfInvalid('PDF 根对象缺失')
  const mappedRoot = rootEntry! as Exclude<PdfXrefEntry, { kind: 'free' }>
  if (mappedRoot.kind === 'direct') {
    if (mappedRoot.generation !== documentRoot.generation || mappedRoot.offset >= content.length) pdfInvalid('PDF 根对象缺失')
    const endObject = text.indexOf('endobj', mappedRoot.offset)
    if (
      !new RegExp(`^${documentRoot.object}\\s+${documentRoot.generation}\\s+obj\\b`, 'u').test(text.slice(mappedRoot.offset))
      || endObject < 0
      || !/\/Type\s+\/Catalog(?:\s|\/|>)/u.test(text.slice(mappedRoot.offset, endObject))
    ) pdfInvalid('PDF 根对象无效')
  } else {
    if (!hasXrefStream || documentRoot.generation !== 0) pdfInvalid('PDF 根对象缺失')
    validateCompressedPdfRoot(content, text, documentRoot.object, mappedRoot, entries)
  }
}

type XmlNode = {
  name: string
  localName: string
  namespaceURI: string
  attributes: Map<string, string>
  children: XmlNode[]
}

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?/u

const xmlInvalid = (): never => {
  throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX XML 结构无效')
}

const decodeXmlAttribute = (value: string) => {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/iu.test(value)) xmlInvalid()
  return value.replace(/&(?:amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/giu, (entity, decimal, hexadecimal) => {
    if (entity === '&amp;') return '&'
    if (entity === '&lt;') return '<'
    if (entity === '&gt;') return '>'
    if (entity === '&quot;') return '"'
    if (entity === '&apos;') return "'"
    const codePoint = decimal ? Number(decimal) : Number.parseInt(hexadecimal, 16)
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : xmlInvalid()
  })
}

const parseXml = (content: Buffer): XmlNode => {
  const source = content.toString('utf8').replace(/^\uFEFF/u, '')
  if (source.includes('\uFFFD') || /<!(?:DOCTYPE|ENTITY|\[CDATA\[)/iu.test(source)) xmlInvalid()
  let cursor = 0
  let nodeCount = 0
  let attributeCount = 0
  let root: XmlNode | undefined
  const stack: Array<{ node: XmlNode, namespaces: Map<string, string> }> = []
  const readName = () => {
    const match = XML_NAME.exec(source.slice(cursor))
    if (!match) xmlInvalid()
    cursor += match![0]!.length
    return match![0]!
  }
  const skipSpaces = () => {
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1
  }
  while (cursor < source.length) {
    if (source[cursor] !== '<') {
      const textEnd = source.indexOf('<', cursor)
      const text = source.slice(cursor, textEnd < 0 ? source.length : textEnd)
      if (!stack.length && text.trim() !== '') xmlInvalid()
      cursor = textEnd < 0 ? source.length : textEnd
      continue
    }
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4)
      if (end < 0) xmlInvalid()
      cursor = end + 3
      continue
    }
    if (source.startsWith('<?', cursor)) {
      const end = source.indexOf('?>', cursor + 2)
      if (end < 0) xmlInvalid()
      cursor = end + 2
      continue
    }
    if (source.startsWith('</', cursor)) {
      cursor += 2
      const name = readName()
      skipSpaces()
      if (source[cursor] !== '>') xmlInvalid()
      cursor += 1
      const current = stack.pop()
      if (!current || current.node.name !== name) xmlInvalid()
      continue
    }
    if (source.startsWith('<!', cursor)) xmlInvalid()
    cursor += 1
    const name = readName()
    const parentNamespaces = stack.at(-1)?.namespaces ?? new Map<string, string>()
    const namespaces = new Map(parentNamespaces)
    const attributes = new Map<string, string>()
    let selfClosing = false
    while (true) {
      skipSpaces()
      if (source.startsWith('/>', cursor)) {
        selfClosing = true
        cursor += 2
        break
      }
      if (source[cursor] === '>') {
        cursor += 1
        break
      }
      const attributeName = readName()
      attributeCount += 1
      if (attributeCount > 10_000) xmlInvalid()
      skipSpaces()
      if (source[cursor] !== '=') xmlInvalid()
      cursor += 1
      skipSpaces()
      const quote = source[cursor]
      if (quote !== '"' && quote !== "'") xmlInvalid()
      cursor += 1
      const valueStart = cursor
      const valueEnd = source.indexOf(quote!, valueStart)
      if (valueEnd < 0) xmlInvalid()
      cursor = valueEnd + 1
      const value = decodeXmlAttribute(source.slice(valueStart, valueEnd))
      if (attributes.has(attributeName)) xmlInvalid()
      if (attributeName === 'xmlns') namespaces.set('', value)
      else if (attributeName.startsWith('xmlns:')) namespaces.set(attributeName.slice(6), value)
      else attributes.set(attributeName, value)
    }
    const prefixEnd = name.indexOf(':')
    const prefix = prefixEnd < 0 ? '' : name.slice(0, prefixEnd)
    const localName = prefixEnd < 0 ? name : name.slice(prefixEnd + 1)
    const namespaceURI = namespaces.get(prefix) ?? ''
    if (prefix && !namespaceURI) xmlInvalid()
    const node: XmlNode = { name, localName, namespaceURI, attributes, children: [] }
    nodeCount += 1
    if (nodeCount > 10_000 || stack.length >= 128) xmlInvalid()
    if (stack.length) stack.at(-1)!.node.children.push(node)
    else if (root) xmlInvalid()
    else root = node
    if (!selfClosing) stack.push({ node, namespaces })
  }
  if (!root || stack.length) xmlInvalid()
  return root!
}

const attr = (node: XmlNode, name: string) => node.attributes.get(name)
const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types'
const relationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
const officeDocumentRelationshipTypes = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
])
const wordprocessingNamespaces = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
])

const relationshipSourcePart = (relationshipName: string) => {
  if (relationshipName === '_rels/.rels') return ''
  const match = /^(.*)\/_rels\/([^/]+)\.rels$/u.exec(relationshipName)
  return match ? `${match[1]}/${match[2]}` : undefined
}

const resolveRelationshipTarget = (sourcePart: string, targetValue: string) => {
  let decoded = ''
  try {
    decoded = decodeURIComponent(targetValue.split('#', 1)[0]!)
  } catch {
    xmlInvalid()
  }
  if (
    decoded.length === 0
    || decoded.includes('\\')
    || decoded.includes('\0')
    || decoded.startsWith('/')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(decoded)
  ) xmlInvalid()
  const base = sourcePart ? posix.dirname(sourcePart) : ''
  const resolved = posix.normalize(posix.join(base, decoded))
  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) xmlInvalid()
  return resolved
}

const validateRelationships = (name: string, content: Buffer) => {
  const sourcePart = relationshipSourcePart(name)
  if (sourcePart === undefined) xmlInvalid()
  const safeSourcePart = sourcePart!
  const relationships = parseXml(content)
  if (relationships.localName !== 'Relationships' || relationships.namespaceURI !== relationshipsNamespace) xmlInvalid()
  const ids = new Set<string>()
  for (const node of relationships.children) {
    if (node.localName !== 'Relationship' || node.namespaceURI !== relationshipsNamespace) xmlInvalid()
    const id = attr(node, 'Id')
    const type = attr(node, 'Type')
    const target = attr(node, 'Target')
    const mode = attr(node, 'TargetMode')
    if (!id || !type || !target || ids.has(id) || (mode !== undefined && mode.toLowerCase() !== 'internal')) xmlInvalid()
    ids.add(id!)
    resolveRelationshipTarget(safeSourcePart, target!)
  }
  return relationships
}

const validateDocxXml = (entries: Map<string, Buffer>) => {
  const contentTypes = parseXml(entries.get('[Content_Types].xml')!)
  if (contentTypes.localName !== 'Types' || contentTypes.namespaceURI !== contentTypesNamespace) xmlInvalid()
  const documentContentType = contentTypes.children.find((node) => (
    node.localName === 'Override'
      && node.namespaceURI === contentTypesNamespace
      && attr(node, 'PartName') === '/word/document.xml'
      && attr(node, 'ContentType') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  ))
  if (!documentContentType) throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 缺少文档内容声明')

  const relationships = validateRelationships('_rels/.rels', entries.get('_rels/.rels')!)
  const officeDocument = relationships.children.find((node) => (
    node.localName === 'Relationship'
      && node.namespaceURI === relationshipsNamespace
      && officeDocumentRelationshipTypes.has(attr(node, 'Type') ?? '')
      && resolveRelationshipTarget('', attr(node, 'Target') ?? '') === 'word/document.xml'
      && (attr(node, 'TargetMode') === undefined || attr(node, 'TargetMode')?.toLowerCase() === 'internal')
  ))
  if (!officeDocument || !attr(officeDocument, 'Id')) throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 缺少文档关系声明')

  const document = parseXml(entries.get('word/document.xml')!)
  if (document.localName !== 'document' || !wordprocessingNamespaces.has(document.namespaceURI)) xmlInvalid()
  const body = document.children.find((node) => node.localName === 'body' && node.namespaceURI === document.namespaceURI)
  if (!body) throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 文档主体无效')

  for (const [name, content] of entries) {
    if (name.endsWith('.rels') && name !== '_rels/.rels') validateRelationships(name, content)
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

const validateDocx = (content: Buffer, maxBytes: number) => {
  if (content.length > maxBytes) throw new FileValidationError('FILE_TOO_LARGE', '文件超过大小限制')
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
  const maxEntries = Math.min(1_000, Math.max(16, Math.floor(maxBytes / 512)))
  if (
    disk !== 0
    || centralDisk !== 0
    || entriesOnDisk !== totalEntries
    || totalEntries < 3
    || totalEntries > maxEntries
    || eocd + 22 + commentLength !== content.length
    || centralOffset + centralSize !== eocd
  ) {
    throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX ZIP 结构无效')
  }

  const names = new Set<string>()
  const requiredEntries = new Map<string, Buffer>()
  let cursor = centralOffset
  let totalUncompressed = 0
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
    if (uncompressedSize > maxBytes || totalUncompressed > maxBytes - uncompressedSize) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 压缩比例或展开大小异常')
    }
    if (uncompressedSize > 65_536 && (compressedSize === 0 || uncompressedSize / compressedSize > 100)) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 压缩比例或展开大小异常')
    }
    totalUncompressed += uncompressedSize
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
        : inflateRawSync(compressed, { maxOutputLength: Math.min(maxBytes + 1, uncompressedSize + 1) })
    } catch {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 条目解压失败')
    }
    if (uncompressed.length !== uncompressedSize || crc32(uncompressed) !== expectedCrc) {
      throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 条目校验失败')
    }
    if (['[Content_Types].xml', 'word/document.xml'].includes(name) || name.endsWith('.rels')) {
      requiredEntries.set(name, uncompressed)
    }
    cursor = next
  }
  if (cursor !== eocd) throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 中央目录长度无效')
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    if (!names.has(required)) throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX 缺少必要的 OpenXML 条目')
  }
  try {
    validateDocxXml(requiredEntries)
  } catch (error) {
    if (error instanceof FileValidationError) throw error
    throw new FileValidationError('FILE_CONTENT_INVALID', 'DOCX XML 结构无效')
  }
}

export const validateStoredFileContent = (content: Buffer, mime: string, maxBytes: number): void => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new FileValidationError('FILE_SIZE_INVALID', '文件大小限制无效')
  if (content.length > maxBytes) throw new FileValidationError('FILE_TOO_LARGE', '文件超过大小限制')
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
