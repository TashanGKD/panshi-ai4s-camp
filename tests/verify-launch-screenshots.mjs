import { Buffer } from 'node:buffer'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const viewports = ['1440x900', '1280x800', '390x844']
const pages = [
  'public-home', 'public-schedule', 'public-register', 'public-transport',
  'public-contact', 'public-resources', 'public-login', 'public-profile',
  'admin-login', 'admin-dashboard', 'admin-content', 'admin-applications',
  'admin-resources', 'admin-users', 'admin-audit', 'admin-system',
]
const expectedScreenshots = pages.flatMap((page) => viewports.map((viewport) => `${page}-${viewport}.png`)).sort()
const expectedEntries = [...expectedScreenshots, 'current-run.json'].sort()
const evidenceDirectory = resolve('test-results/launch/evidence/launch-visual')
const runToken = process.env.E2E_RUN_TOKEN
const startedAt = process.env.E2E_RUN_STARTED_AT
if (!/^[a-f0-9]{64}$/u.test(runToken ?? '')) throw new Error('E2E_RUN_TOKEN must be a cryptographically random 64-character hex token')
const startedAtMs = Date.parse(startedAt ?? '')
if (!Number.isFinite(startedAtMs)) throw new Error('E2E_RUN_STARTED_AT must be a valid timestamp')

const entries = (await readdir(evidenceDirectory)).sort()
if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
  throw new Error(`Expected exact launch evidence entries (${expectedEntries.length}); found ${entries.length}: ${entries.join(', ')}`)
}

const assertRegularFile = async (path) => {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Launch evidence must be a regular non-symlink file: ${path}`)
  return metadata
}
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
let newestScreenshot = 0
for (const filename of expectedScreenshots) {
  const path = resolve(evidenceDirectory, filename)
  const metadata = await assertRegularFile(path)
  const bytes = await readFile(path)
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`Invalid PNG signature or IHDR: ${filename}`)
  }
  const match = filename.match(/-(\d+)x(\d+)\.png$/u)
  if (!match) throw new Error(`Screenshot filename lacks viewport dimensions: ${filename}`)
  const expectedWidth = Number(match[1]); const expectedHeight = Number(match[2])
  if (bytes.readUInt32BE(16) !== expectedWidth || bytes.readUInt32BE(20) !== expectedHeight) {
    throw new Error(`Screenshot dimensions do not match ${expectedWidth}x${expectedHeight}: ${filename}`)
  }
  if (metadata.mtimeMs + 1_000 < startedAtMs) throw new Error(`Screenshot predates current E2E run: ${filename}`)
  newestScreenshot = Math.max(newestScreenshot, metadata.mtimeMs)
}

const markerPath = resolve(evidenceDirectory, 'current-run.json')
const markerMetadata = await assertRegularFile(markerPath)
const marker = JSON.parse(await readFile(markerPath, 'utf8'))
if (marker.runToken !== runToken || marker.startedAt !== startedAt) throw new Error('Launch marker token/time does not match the current E2E invocation')
if (!Number.isFinite(Date.parse(marker.completedAt ?? '')) || Date.parse(marker.completedAt) < startedAtMs) throw new Error('Launch marker completion time is invalid')
if (JSON.stringify(marker.screenshots) !== JSON.stringify(expectedScreenshots)) throw new Error('Launch marker manifest does not match expected screenshots')
if (markerMetadata.mtimeMs < newestScreenshot) throw new Error('Launch marker predates a screenshot')
console.log(`launch visual evidence retained: ${expectedScreenshots.length} exact PNGs at test-results/launch/evidence/launch-visual`)
