import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const viewports = ['1440x900', '1280x800', '390x844']
const pages = [
  'public-home', 'public-schedule', 'public-register', 'public-transport',
  'public-contact', 'public-resources', 'public-login', 'public-profile',
  'admin-login', 'admin-dashboard', 'admin-content', 'admin-applications',
  'admin-resources', 'admin-users', 'admin-audit', 'admin-system',
]
const expected = pages.flatMap((page) => viewports.map((viewport) => `${page}-${viewport}.png`)).sort()
const root = resolve('test-results/launch')

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  }))).flat()
}

const files = await walk(root).catch(() => [])
const screenshots = files.filter((path) => path.endsWith('.png')).sort()
const names = screenshots.map((path) => path.split('/').at(-1)).sort()
if (JSON.stringify(names) !== JSON.stringify(expected)) {
  throw new Error(`Expected exact launch screenshot manifest (${expected.length}); found ${names.length}: ${names.join(', ')}`)
}

const markers = files.filter((path) => path.endsWith('/launch-visual/current-run.json'))
if (markers.length !== 1) throw new Error(`Expected one current launch visual marker; found ${markers.length}`)
const marker = JSON.parse(await readFile(markers[0], 'utf8'))
if (JSON.stringify(marker.screenshots) !== JSON.stringify(expected)) throw new Error('Current launch marker manifest does not match expected screenshots')
const markerTime = (await stat(markers[0])).mtimeMs
const newestScreenshot = Math.max(...await Promise.all(screenshots.map(async (path) => (await stat(path)).mtimeMs)))
if (markerTime < newestScreenshot) throw new Error('Current launch marker predates a screenshot')
console.log(`launch visual evidence retained: ${screenshots.length} exact PNGs, marker=${marker.runId}`)
