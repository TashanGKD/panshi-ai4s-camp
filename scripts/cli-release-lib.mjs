import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { gunzipSync } from 'node:zlib'

export const MAX_RELEASE_BYTES = 100 * 1024 * 1024

const readString = (buffer, start, length) => buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '')
const readNumber = (buffer, start, length) => {
  const field = buffer.subarray(start, start + length)
  if ((field[0] & 0x80) !== 0) throw new Error('CLI_RELEASE_TAR_INVALID: base-256 tar numbers are not supported')
  const source = field.toString('ascii').replace(/\0.*$/su, '').trim()
  if (!/^[0-7]*$/u.test(source)) throw new Error('CLI_RELEASE_TAR_INVALID: malformed tar number')
  return source === '' ? 0 : Number.parseInt(source, 8)
}

const parsePax = (data) => {
  const result = {}
  let offset = 0
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset)
    if (space < 0) throw new Error('CLI_RELEASE_TAR_INVALID: malformed PAX record')
    const length = Number.parseInt(data.subarray(offset, space).toString('ascii'), 10)
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > data.length) throw new Error('CLI_RELEASE_TAR_INVALID: malformed PAX length')
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8')
    const equals = record.indexOf('=')
    if (equals <= 0) throw new Error('CLI_RELEASE_TAR_INVALID: malformed PAX field')
    result[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  return result
}

export const assertSafeArchivePath = (candidate) => {
  if (typeof candidate !== 'string' || candidate === '' || candidate.includes('\\') || candidate.includes('\0')) throw new Error('CLI_RELEASE_PATH_UNSAFE: invalid archive path')
  if (candidate.startsWith('/') || /^[A-Za-z]:/u.test(candidate)) throw new Error(`CLI_RELEASE_PATH_UNSAFE: absolute path ${candidate}`)
  const segments = candidate.split('/')
  if (segments.includes('..') || segments.includes('') || posix.normalize(candidate) !== candidate) throw new Error(`CLI_RELEASE_PATH_UNSAFE: traversal path ${candidate}`)
  return candidate
}

export const parseTarGz = (archive) => {
  if (archive.length <= 0 || archive.length > MAX_RELEASE_BYTES) throw new Error('CLI_RELEASE_SIZE_INVALID: archive size is outside the release limit')
  const tar = gunzipSync(archive, { maxOutputLength: MAX_RELEASE_BYTES })
  const entries = []
  let offset = 0
  let localPax = {}
  let globalPax = {}
  let longPath
  let longLink
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const storedChecksum = readNumber(header, 148, 8)
    const checksumHeader = Buffer.from(header)
    checksumHeader.fill(0x20, 148, 156)
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0)
    if (storedChecksum !== actualChecksum) throw new Error('CLI_RELEASE_TAR_INVALID: header checksum mismatch')
    const size = readNumber(header, 124, 12)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('CLI_RELEASE_TAR_INVALID: entry size exceeds archive')
    const type = String.fromCharCode(header[156] || 0)
    const prefix = readString(header, 345, 155)
    const headerPath = [prefix, readString(header, 0, 100)].filter(Boolean).join('/')
    const data = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512

    if (type === 'x' || type === 'g') {
      const parsed = parsePax(data)
      if (type === 'x') localPax = parsed
      else globalPax = { ...globalPax, ...parsed }
      continue
    }
    if (type === 'L' || type === 'K') {
      const value = data.toString('utf8').replace(/\0.*$/su, '')
      if (type === 'L') longPath = value
      else longLink = value
      continue
    }
    const pax = { ...globalPax, ...localPax }
    const path = assertSafeArchivePath(pax.path ?? longPath ?? headerPath)
    const linkPath = pax.linkpath ?? longLink ?? readString(header, 157, 100)
    entries.push({ path, type: type === '\0' ? '0' : type, size, linkPath, data: Buffer.from(data) })
    localPax = {}
    longPath = undefined
    longLink = undefined
  }
  if (entries.length === 0) throw new Error('CLI_RELEASE_TAR_INVALID: archive has no entries')
  return entries
}

export const extractPackageEntries = async (entries, destination) => {
  for (const entry of entries) {
    if (entry.type === '1' || entry.type === '2') throw new Error(`CLI_RELEASE_LINK_UNSAFE: ${entry.path}`)
    if (!['0', '5'].includes(entry.type)) throw new Error(`CLI_RELEASE_NODE_UNSAFE: ${entry.path} has type ${entry.type}`)
    const output = join(destination, ...entry.path.split('/'))
    if (entry.type === '5') await mkdir(output, { recursive: true })
    else {
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, entry.data, { mode: entry.path.endsWith('/dist/main.js') ? 0o755 : 0o644 })
    }
  }
}

export const sha256 = (contents) => createHash('sha256').update(contents).digest('hex')
