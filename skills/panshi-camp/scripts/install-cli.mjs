#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import path, { join, posix, relative, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const PACKAGE_NAME = 'panshi-camp-cli'
const BIN_NAME = 'panshi-camp'
const PRODUCTION_URL = 'https://panshi-ai4s.tashan.chat'
const MAX_ASSET_BYTES = 100 * 1024 * 1024
const RELEASE_REPOSITORY_PATH = '/TashanGKD/panshi-ai4s-camp'
const RELEASE_ASSET_HOSTS = new Set([
  'github.com',
  'github-releases.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])
const MANIFEST_FIELDS = Object.freeze([
  'assetName',
  'packageName',
  'schemaVersion',
  'sha256',
  'sizeBytes',
  'url',
  'version',
].sort())
const MARKER_NAME = '.panshi-camp-install.json'
const MAX_REDIRECTS = 5
const execFileAsync = promisify(execFileCallback)

class InstallerError extends Error {
  constructor(code, message = code) {
    super(`${code}: ${message}`)
    this.name = 'InstallerError'
    this.code = code
  }
}

const fail = (code, message) => { throw new InstallerError(code, message) }

export const parseInstallerArgv = (argv) => {
  if (argv.length === 0) return 'preview'
  if (argv.length === 1 && argv[0] === '--yes') return 'install'
  return fail('INSTALLER_ARGUMENTS_INVALID', '仅支持无参数预览，或使用精确的 --yes 执行安装')
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

export const validateManifest = (value) => {
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(MANIFEST_FIELDS)) {
    return fail('INSTALLER_MANIFEST_INVALID', 'manifest 字段不符合固定 schema')
  }
  if (value.schemaVersion !== 1 || value.packageName !== PACKAGE_NAME) return fail('INSTALLER_MANIFEST_INVALID', 'manifest 标识无效')
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value.version)) return fail('INSTALLER_MANIFEST_INVALID', '版本必须是稳定语义版本')
  const expectedAsset = `${PACKAGE_NAME}-${value.version}.tgz`
  if (value.assetName !== expectedAsset || posix.basename(value.assetName) !== value.assetName || win32.basename(value.assetName) !== value.assetName) {
    return fail('INSTALLER_MANIFEST_INVALID', '附件名必须是与版本精确匹配的 basename')
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) return fail('INSTALLER_MANIFEST_INVALID', 'sha256 必须是 64 位小写十六进制')
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > MAX_ASSET_BYTES) return fail('INSTALLER_MANIFEST_INVALID', '附件大小超出允许范围')
  if (typeof value.url !== 'string') return fail('INSTALLER_MANIFEST_INVALID', '下载地址无效')
  let parsed
  try { parsed = new URL(value.url) } catch { return fail('INSTALLER_MANIFEST_INVALID', '下载地址无效') }
  const expectedPath = `${RELEASE_REPOSITORY_PATH}/releases/download/cli-v${value.version}/${value.assetName}`
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.pathname !== expectedPath || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return fail('INSTALLER_MANIFEST_INVALID', '下载地址必须是固定 GitHub HTTPS Release 附件')
  }
  return Object.freeze({ ...value })
}

const isAllowedReleaseHost = (hostname) => RELEASE_ASSET_HOSTS.has(hostname)

export const resolveLayout = ({ platform = process.platform, homeDirectory = homedir(), localAppData, xdgConfigHome }) => {
  if (platform === 'win32') {
    if (typeof localAppData !== 'string' || !win32.isAbsolute(localAppData)) return fail('INSTALLER_LOCALAPPDATA_REQUIRED', 'Windows 安装需要绝对 LOCALAPPDATA 路径')
    if (!win32.isAbsolute(homeDirectory)) return fail('INSTALLER_HOME_INVALID', 'Windows HOME 必须是绝对路径')
    const installRoot = win32.join(localAppData, 'panshi-camp-cli')
    return Object.freeze({
      platform,
      installRoot,
      binDirectory: win32.join(installRoot, 'bin'),
      stableEntry: win32.join(installRoot, 'bin', 'panshi-camp.cmd'),
      configDirectory: win32.join(homeDirectory, '.config', 'panshi-camp'),
      configPath: win32.join(homeDirectory, '.config', 'panshi-camp', 'config.json'),
      pathApi: win32,
    })
  }
  if (!path.isAbsolute(homeDirectory)) return fail('INSTALLER_HOME_INVALID', 'HOME 必须是绝对路径')
  const configBase = xdgConfigHome ?? join(homeDirectory, '.config')
  if (!path.isAbsolute(configBase)) return fail('INSTALLER_CONFIG_PATH_INVALID', '配置根目录必须是绝对路径')
  return Object.freeze({
    platform,
    installRoot: join(homeDirectory, '.local', 'share', 'panshi-camp-cli'),
    binDirectory: join(homeDirectory, '.local', 'bin'),
    stableEntry: join(homeDirectory, '.local', 'bin', 'panshi-camp'),
    configDirectory: join(configBase, 'panshi-camp'),
    configPath: join(configBase, 'panshi-camp', 'config.json'),
    pathApi: path,
  })
}

const inspectPath = async (candidate) => {
  try {
    const metadata = await lstat(candidate)
    return { exists: true, reparsePoint: metadata.isSymbolicLink() }
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, reparsePoint: false }
    throw error
  }
}

const pathAncestors = (candidate, pathApi) => {
  const parsed = pathApi.parse(candidate)
  const result = []
  let current = parsed.root
  for (const segment of candidate.slice(parsed.root.length).split(pathApi.sep).filter(Boolean)) {
    current = pathApi.join(current, segment)
    result.push(current)
  }
  return result
}

export const assertWindowsPathSafe = async (paths, { inspect = inspectPath } = {}) => {
  const checked = new Set()
  for (const candidate of paths) {
    if (!win32.isAbsolute(candidate)) return fail('INSTALLER_PATH_UNSAFE', 'Windows 路径必须是绝对路径')
    for (const ancestor of pathAncestors(candidate, win32)) {
      const key = ancestor.toLocaleLowerCase('en-US')
      if (checked.has(key)) continue
      checked.add(key)
      const state = await inspect(ancestor)
      if (state?.exists && state.reparsePoint) return fail('INSTALLER_WINDOWS_REPARSE_POINT', `拒绝 Windows reparse point：${ancestor}`)
    }
  }
}

const isInside = (parent, child, pathApi) => {
  const delta = pathApi.relative(parent, child)
  return delta !== '' && delta !== '..' && !delta.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(delta)
}

const assertLayoutBoundaries = ({ layout, homeDirectory, localAppData, workspaceRoot }) => {
  const pathApi = layout.pathApi
  const protectedPaths = [pathApi.parse(layout.installRoot).root, homeDirectory, workspaceRoot, ...(localAppData ? [localAppData] : [])].filter(Boolean)
  for (const target of [layout.installRoot, layout.binDirectory, layout.configDirectory]) {
    if (!pathApi.isAbsolute(target) || protectedPaths.some((protectedPath) => pathApi.normalize(target) === pathApi.normalize(protectedPath))) {
      return fail('INSTALLER_PATH_UNSAFE', `拒绝受保护安装目标：${target}`)
    }
  }
  if (!isInside(homeDirectory, layout.configDirectory, pathApi)) return fail('INSTALLER_PATH_UNSAFE', '配置目录必须位于 HOME 内')
  if (layout.platform === 'win32') {
    if (!isInside(localAppData, layout.installRoot, pathApi)) return fail('INSTALLER_PATH_UNSAFE', '安装目录必须位于 LOCALAPPDATA 内')
  } else if (!isInside(homeDirectory, layout.installRoot, pathApi) || !isInside(homeDirectory, layout.binDirectory, pathApi)) {
    return fail('INSTALLER_PATH_UNSAFE', '安装目录必须位于 HOME 内')
  }
}

const assertPosixPathSafe = async (homeDirectory, targets, currentUid) => {
  const homeMetadata = await lstat(homeDirectory).catch(() => null)
  if (!homeMetadata?.isDirectory() || homeMetadata.isSymbolicLink()) return fail('INSTALLER_PATH_UNSAFE', 'HOME 必须是现有真实目录')
  if (currentUid !== undefined && homeMetadata.uid !== currentUid) return fail('INSTALLER_PATH_NOT_OWNED', 'HOME 必须由当前 uid 所有')
  for (const target of targets) {
    if (!isInside(homeDirectory, target, path) && resolve(target) !== resolve(homeDirectory)) return fail('INSTALLER_PATH_UNSAFE', `路径逃逸 HOME：${target}`)
    const delta = relative(homeDirectory, target)
    let candidate = homeDirectory
    for (const segment of ['', ...delta.split(path.sep).filter(Boolean)]) {
      if (segment) candidate = join(candidate, segment)
      const metadata = await lstat(candidate).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (metadata?.isSymbolicLink()) return fail('INSTALLER_PATH_UNSAFE', `拒绝符号链接路径：${candidate}`)
      if (metadata && currentUid !== undefined && metadata.uid !== currentUid) return fail('INSTALLER_PATH_NOT_OWNED', `路径必须由当前 uid 所有：${candidate}`)
    }
  }
}

const assertSafePaths = async ({ layout, homeDirectory, windowsPathInspector, currentUid, targets }) => {
  if (layout.platform === 'win32') return assertWindowsPathSafe(targets, { inspect: windowsPathInspector ?? inspectPath })
  return assertPosixPathSafe(homeDirectory, targets, currentUid)
}

const ensureDirectory = async ({ directory, mode, preserveExistingMode = false, layout, homeDirectory, windowsPathInspector, currentUid }) => {
  await assertSafePaths({ layout, homeDirectory, windowsPathInspector, currentUid, targets: [directory] })
  const existed = await lstat(directory).then(() => true).catch((error) => error.code === 'ENOENT' ? false : Promise.reject(error))
  await mkdir(directory, { recursive: true, mode })
  await assertSafePaths({ layout, homeDirectory, windowsPathInspector, currentUid, targets: [directory] })
  const metadata = await lstat(directory)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return fail('INSTALLER_PATH_UNSAFE', `目录不安全：${directory}`)
  if (layout.platform !== 'win32' && (!existed || !preserveExistingMode)) await chmod(directory, mode)
}

const secretKeys = new Set(['password', 'passwd', 'token', 'cookie', 'verificationcode', 'code', 'secret'])
const normalizedKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/gu, '')
const hasSecretKey = (value) => {
  if (Array.isArray(value)) return value.some(hasSecretKey)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) => secretKeys.has(normalizedKey(key)) || hasSecretKey(child))
}
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const normalizeBaseUrl = (value) => {
  if (typeof value !== 'string') return fail('INSTALLER_CONFIG_INVALID', 'profile baseUrl 无效')
  let url
  try { url = new URL(value.trim()) } catch { return fail('INSTALLER_CONFIG_INVALID', 'profile baseUrl 无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname))) {
    return fail('INSTALLER_CONFIG_INVALID', 'profile baseUrl 无效')
  }
  const normalizedPath = url.pathname.replace(/\/+$/u, '')
  return `${url.origin}${normalizedPath}`
}

const validateConfig = (value) => {
  if (hasSecretKey(value)) return fail('INSTALLER_CONFIG_SECRET_FORBIDDEN', '配置中禁止保存 secret 类字段')
  if (!isPlainObject(value)) return fail('INSTALLER_CONFIG_INVALID', '配置顶层字段无效')
  if (!isPlainObject(value.profiles)) return fail('INSTALLER_CONFIG_INVALID', 'profiles 无效')
  const profiles = {}
  for (const [name, entry] of Object.entries(value.profiles)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/u.test(name) || !isPlainObject(entry) || Object.keys(entry).some((key) => !['baseUrl', 'phoneHint'].includes(key))) {
      return fail('INSTALLER_CONFIG_INVALID', 'profile schema 无效')
    }
    if (typeof entry.baseUrl !== 'string' || (entry.phoneHint !== undefined && typeof entry.phoneHint !== 'string')) return fail('INSTALLER_CONFIG_INVALID', 'profile 字段无效')
    profiles[name] = { ...entry, baseUrl: normalizeBaseUrl(entry.baseUrl) }
  }
  return { ...value, profiles }
}

export const mergePanshiProfile = (config) => {
  const safe = validateConfig(config)
  const existing = safe.profiles.panshi
  if (existing && normalizeBaseUrl(existing.baseUrl) !== PRODUCTION_URL) return fail('INSTALLER_PROFILE_CONFLICT', 'panshi profile 已指向其他地址，拒绝覆盖')
  return { ...safe, profiles: { ...safe.profiles, panshi: { ...(existing ?? {}), baseUrl: PRODUCTION_URL } } }
}

const readConfigForMerge = async ({ layout, homeDirectory, windowsPathInspector, currentUid }) => {
  await assertSafePaths({ layout, homeDirectory, windowsPathInspector, currentUid, targets: [layout.configDirectory, layout.configPath] })
  const directory = await lstat(layout.configDirectory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) return fail('INSTALLER_PATH_UNSAFE', '配置目录不安全')
  if (directory && currentUid !== undefined && directory.uid !== currentUid) return fail('INSTALLER_PATH_NOT_OWNED', '配置目录必须由当前 uid 所有')
  if (directory && layout.platform !== 'win32' && (directory.mode & 0o077) !== 0) return fail('INSTALLER_CONFIG_PERMISSIONS_UNSAFE', '配置目录权限必须是 0700')
  const metadata = await lstat(layout.configPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!metadata) return mergePanshiProfile({ profiles: {} })
  if (!metadata.isFile() || metadata.isSymbolicLink()) return fail('INSTALLER_PATH_UNSAFE', '配置文件不安全')
  if (currentUid !== undefined && metadata.uid !== currentUid) return fail('INSTALLER_PATH_NOT_OWNED', '配置文件必须由当前 uid 所有')
  if (layout.platform !== 'win32' && (metadata.mode & 0o077) !== 0) return fail('INSTALLER_CONFIG_PERMISSIONS_UNSAFE', '配置文件权限必须是 0600')
  let parsed
  try { parsed = JSON.parse(await readFile(layout.configPath, 'utf8')) } catch { return fail('INSTALLER_CONFIG_INVALID', '配置不是有效 JSON') }
  return mergePanshiProfile(parsed)
}

const writeConfigAtomically = async ({ config, layout, homeDirectory, windowsPathInspector, currentUid, failpoint, checkAfterSwap }) => {
  await ensureDirectory({ directory: layout.configDirectory, mode: 0o700, layout, homeDirectory, windowsPathInspector, currentUid })
  await assertSafePaths({ layout, homeDirectory, windowsPathInspector, currentUid, targets: [layout.configDirectory, layout.configPath] })
  const temporary = `${layout.configPath}.tmp-${process.pid}-${Date.now()}`
  const backup = `${layout.configPath}.backup-${process.pid}-${Date.now()}`
  let backedUp = false
  let swapped = false
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    if (layout.platform !== 'win32') await chmod(temporary, 0o600)
    await assertSafePaths({ layout, homeDirectory, windowsPathInspector, currentUid, targets: [layout.configDirectory, layout.configPath, temporary] })
    await failpoint('config-before-swap')
    const existing = await lstat(layout.configPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (existing) { await rename(layout.configPath, backup); backedUp = true }
    await rename(temporary, layout.configPath)
    swapped = true
    await checkAfterSwap('config', [layout.configDirectory, layout.configPath])
    await failpoint('config-after-swap')
    return {
      commit: async () => { if (backedUp) await rm(backup, { force: true }) },
      rollback: async () => {
        if (swapped) await rm(layout.configPath, { force: true })
        if (backedUp) await rename(backup, layout.configPath)
      },
    }
  } catch (error) {
    if (swapped) await rm(layout.configPath, { force: true })
    if (backedUp) await rename(backup, layout.configPath)
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
}

const inventoryTree = async (root, { pathApi = path, currentUid } = {}) => {
  const entries = []
  const visit = async (directory, prefix = '') => {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name, 'en-US'))
    for (const child of children) {
      if (prefix === '' && child.name === MARKER_NAME) continue
      const absolute = pathApi.join(directory, child.name)
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name
      const metadata = await lstat(absolute)
      if (currentUid !== undefined && metadata.uid !== currentUid) return fail('INSTALLER_PATH_NOT_OWNED', `安装树必须由当前 uid 所有：${relativePath}`)
      if (metadata.isDirectory()) {
        entries.push({ path: relativePath, type: 'directory', mode: metadata.mode & 0o777 })
        await visit(absolute, relativePath)
      } else if (metadata.isFile()) {
        const contents = await readFile(absolute)
        entries.push({ path: relativePath, type: 'file', mode: metadata.mode & 0o777, size: metadata.size, sha256: createHash('sha256').update(contents).digest('hex') })
      } else if (metadata.isSymbolicLink()) {
        entries.push({ path: relativePath, type: 'symlink', target: await readlink(absolute) })
      } else {
        return fail('INSTALLER_PACKAGE_INVALID', `安装树包含不支持的节点：${relativePath}`)
      }
    }
  }
  await visit(root)
  const treeSha256 = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
  return { entries, treeSha256 }
}

const markerFor = (manifest, inventory) => ({
  schemaVersion: 2,
  packageName: manifest.packageName,
  version: manifest.version,
  sha256: manifest.sha256,
  treeSha256: inventory.treeSha256,
  entries: inventory.entries,
})

const verifyInstalledPackage = async (installationRoot, manifest, pathApi = path) => {
  const packageRoot = pathApi.join(installationRoot, 'node_modules', manifest.packageName)
  const packagePath = pathApi.join(packageRoot, 'package.json')
  const metadata = await lstat(packagePath).catch(() => null)
  if (!metadata?.isFile() || metadata.isSymbolicLink()) return fail('INSTALLER_PACKAGE_INVALID', '安装包 package.json 缺失或不安全')
  let packageJson
  try { packageJson = JSON.parse(await readFile(packagePath, 'utf8')) } catch { return fail('INSTALLER_PACKAGE_INVALID', '安装包 package.json 无效') }
  if (packageJson.name !== manifest.packageName || packageJson.version !== manifest.version || !isPlainObject(packageJson.bin) || Object.keys(packageJson.bin).length !== 1 || packageJson.bin[BIN_NAME] !== './dist/main.js') {
    return fail('INSTALLER_PACKAGE_INVALID', '安装包名称、版本或 bin 不匹配')
  }
  const binRelative = packageJson.bin[BIN_NAME]
  const binPath = pathApi.resolve(packageRoot, binRelative)
  if (!isInside(packageRoot, binPath, pathApi)) return fail('INSTALLER_PACKAGE_INVALID', 'bin 路径逃逸安装包')
  const binMetadata = await lstat(binPath).catch(() => null)
  if (!binMetadata?.isFile() || binMetadata.isSymbolicLink()) return fail('INSTALLER_PACKAGE_INVALID', 'bin 文件缺失或不安全')
  if (pathApi === path && (binMetadata.mode & 0o111) === 0) return fail('INSTALLER_PACKAGE_INVALID', 'bin 文件不可执行')
  return binPath
}

const inspectExistingVersion = async ({ versionRoot, manifest, layout, currentUid }) => {
  const metadata = await lstat(versionRoot).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!metadata) return false
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return fail('INSTALLER_PATH_UNSAFE', '目标版本路径不安全')
  if (currentUid !== undefined && metadata.uid !== currentUid) return fail('INSTALLER_PATH_NOT_OWNED', '目标版本目录必须由当前 uid 所有')
  let marker
  try { marker = JSON.parse(await readFile(layout.pathApi.join(versionRoot, MARKER_NAME), 'utf8')) } catch { return fail('INSTALLER_VERSION_CONFLICT', '同版本目录不是受管安装') }
  const markerMetadata = await lstat(layout.pathApi.join(versionRoot, MARKER_NAME)).catch(() => null)
  if (!markerMetadata?.isFile() || markerMetadata.isSymbolicLink() || (currentUid !== undefined && markerMetadata.uid !== currentUid)) return fail('INSTALLER_VERSION_CONFLICT', '同版本 marker 不安全')
  const inventory = await inventoryTree(versionRoot, { pathApi: layout.pathApi, currentUid }).catch((error) => {
    if (error instanceof InstallerError) throw error
    return fail('INSTALLER_VERSION_CONFLICT', '无法验证同版本安装树')
  })
  if (JSON.stringify(marker) !== JSON.stringify(markerFor(manifest, inventory))) return fail('INSTALLER_VERSION_CONFLICT', '同版本安装树清单或摘要冲突')
  try { await verifyInstalledPackage(versionRoot, manifest, layout.pathApi) } catch { return fail('INSTALLER_VERSION_CONFLICT', '同版本入口或 package metadata 冲突') }
  return true
}

const unixStableTarget = (version) => `../share/panshi-camp-cli/${version}/node_modules/${PACKAGE_NAME}/dist/main.js`
const windowsStableContents = (version) => `@echo off\r\n@node "%~dp0..\\${version}\\node_modules\\${PACKAGE_NAME}\\dist\\main.js" %*\r\n`

const parseManagedStableEntry = async (layout, currentUid) => {
  const metadata = await lstat(layout.stableEntry).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!metadata) return null
  if (currentUid !== undefined && metadata.uid !== currentUid) return fail('INSTALLER_PATH_NOT_OWNED', '稳定入口必须由当前 uid 所有')
  if (layout.platform === 'win32') {
    if (!metadata.isFile() || metadata.isSymbolicLink()) return fail('INSTALLER_STABLE_ENTRY_UNMANAGED', '稳定入口不是受管 cmd 文件')
    const contents = await readFile(layout.stableEntry, 'utf8')
    const match = contents.match(/^@echo off\r?\n@node "%~dp0\.\.\\(\d+\.\d+\.\d+)\\node_modules\\panshi-camp-cli\\dist\\main\.js" %\*\r?\n$/u)
    if (!match || contents !== windowsStableContents(match[1])) return fail('INSTALLER_STABLE_ENTRY_UNMANAGED', '稳定入口不是受管 cmd 文件')
    return match[1]
  }
  if (!metadata.isSymbolicLink()) return fail('INSTALLER_STABLE_ENTRY_UNMANAGED', '稳定入口不是受管符号链接')
  const target = await readlink(layout.stableEntry)
  const match = target.match(/^\.\.\/share\/panshi-camp-cli\/(\d+\.\d+\.\d+)\/node_modules\/panshi-camp-cli\/dist\/main\.js$/u)
  if (!match || target !== unixStableTarget(match[1])) return fail('INSTALLER_STABLE_ENTRY_UNMANAGED', '稳定入口指向非受管目标')
  return match[1]
}

const compareVersions = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return Math.sign(a[index] - b[index])
  return 0
}

const preflightStableEntry = async (layout, targetVersion, currentUid) => {
  const currentVersion = await parseManagedStableEntry(layout, currentUid)
  if (currentVersion && compareVersions(currentVersion, targetVersion) > 0) return fail('INSTALLER_DOWNGRADE_FORBIDDEN', `拒绝从 ${currentVersion} 降级到 ${targetVersion}`)
  return currentVersion
}

const validateDownloadHop = (value) => {
  let url
  try { url = new URL(value) } catch { return fail('INSTALLER_DOWNLOAD_FAILED', '下载重定向地址无效') }
  if (url.protocol !== 'https:' || !isAllowedReleaseHost(url.hostname) || url.username || url.password) return fail('INSTALLER_DOWNLOAD_FAILED', '下载重定向离开可信无凭据 HTTPS 主机')
  return url
}

const downloadAsset = async ({ manifest, destination, fetchImplementation }) => {
  let currentUrl = validateDownloadHop(manifest.url)
  let response
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    response = await fetchImplementation(currentUrl.href, { redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response?.status)) break
    if (redirectCount === MAX_REDIRECTS) return fail('INSTALLER_DOWNLOAD_FAILED', '下载重定向次数超过上限')
    const location = response.headers?.get?.('location')
    if (!location) return fail('INSTALLER_DOWNLOAD_FAILED', '下载重定向缺少 Location')
    let next
    try { next = new URL(location, currentUrl) } catch { return fail('INSTALLER_DOWNLOAD_FAILED', '下载重定向地址无效') }
    currentUrl = validateDownloadHop(next.href)
  }
  if (!response?.ok || !response.body) return fail('INSTALLER_DOWNLOAD_FAILED', `下载失败：HTTP ${response?.status ?? 'unknown'}`)
  if (response.url && validateDownloadHop(response.url).href !== currentUrl.href) return fail('INSTALLER_DOWNLOAD_FAILED', 'fetch 返回了未经逐跳验证的最终地址')
  const declaredLength = response.headers?.get?.('content-length')
  if (declaredLength !== null && declaredLength !== undefined && Number(declaredLength) !== manifest.sizeBytes) return fail('INSTALLER_SIZE_MISMATCH', 'Content-Length 与 manifest 不一致')
  const handle = await open(destination, 'wx', 0o600)
  const hash = createHash('sha256')
  let size = 0
  try {
    for await (const rawChunk of response.body) {
      const chunk = Buffer.from(rawChunk)
      size += chunk.length
      if (size > manifest.sizeBytes || size > MAX_ASSET_BYTES) return fail('INSTALLER_SIZE_MISMATCH', '下载内容超过 manifest 大小')
      hash.update(chunk)
      await handle.write(chunk)
    }
  } finally {
    await handle.close()
  }
  if (size !== manifest.sizeBytes) return fail('INSTALLER_SIZE_MISMATCH', '下载内容大小与 manifest 不一致')
  if (hash.digest('hex') !== manifest.sha256) return fail('INSTALLER_SHA256_MISMATCH', '下载内容 SHA-256 与内嵌 manifest 不一致')
}

const switchStableEntry = async ({ layout, manifest, homeDirectory, windowsPathInspector, currentUid, failpoint, checkAfterSwap }) => {
  const temporary = `${layout.stableEntry}.tmp-${process.pid}-${Date.now()}`
  const backup = `${layout.stableEntry}.backup-${process.pid}-${Date.now()}`
  let backedUp = false
  let swapped = false
  try {
    if (layout.platform === 'win32') {
      await writeFile(temporary, windowsStableContents(manifest.version), { flag: 'wx', mode: 0o600 })
    } else {
      await symlink(unixStableTarget(manifest.version), temporary)
    }
    await assertSafePaths({ layout, homeDirectory, windowsPathInspector, currentUid, targets: [layout.binDirectory] })
    const existing = await lstat(layout.stableEntry).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (existing) { await rename(layout.stableEntry, backup); backedUp = true }
    await rename(temporary, layout.stableEntry)
    swapped = true
    await checkAfterSwap('stable-entry', [layout.binDirectory])
    await failpoint('stable-entry-after-swap')
    if (await parseManagedStableEntry(layout, currentUid) !== manifest.version) return fail('INSTALLER_STABLE_ENTRY_INVALID', '稳定入口最终目标无效')
    return {
      commit: async () => { if (backedUp) await rm(backup, { force: true }) },
      rollback: async () => {
        if (swapped) await rm(layout.stableEntry, { force: true })
        if (backedUp) await rename(backup, layout.stableEntry)
      },
    }
  } catch (error) {
    if (swapped) await rm(layout.stableEntry, { force: true })
    if (backedUp) await rename(backup, layout.stableEntry)
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
}

const previewFor = ({ manifest, layout }) => ({
  action: 'preview-only',
  requiredVersion: manifest.version,
  package: `${manifest.packageName}@${manifest.version}`,
  source: manifest.url,
  asset: manifest.assetName,
  installRoot: layout.pathApi.join(layout.installRoot, manifest.version),
  stableEntry: layout.stableEntry,
  configPath: layout.configPath,
  creates: [layout.pathApi.join(layout.installRoot, manifest.version), layout.stableEntry, layout.configPath],
  note: '未传入 --yes：不会联网，也不会写入文件。安装器不使用 sudo，也不修改 PATH。',
})

export const runInstaller = async ({ argv, manifest: rawManifest, dependencies = {} }) => {
  const mode = parseInstallerArgv(argv)
  const manifest = validateManifest(rawManifest)
  const platform = dependencies.platform ?? process.platform
  const homeDirectory = dependencies.homeDirectory ?? homedir()
  const localAppData = dependencies.localAppData ?? (platform === 'win32' ? process.env.LOCALAPPDATA : undefined)
  const xdgConfigHome = dependencies.xdgConfigHome ?? (platform === 'win32' ? undefined : process.env.XDG_CONFIG_HOME)
  const layout = resolveLayout({ platform, homeDirectory, localAppData, xdgConfigHome })
  const currentUid = platform === 'win32' ? undefined : (dependencies.currentUid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined))
  const failpoint = dependencies.failpoint ?? (async () => {})
  const checkAfterSwap = async (name, targets) => {
    await assertSafePaths({ layout, homeDirectory, windowsPathInspector: dependencies.windowsPathInspector, currentUid, targets })
    await (dependencies.afterSwapCheck ?? (async () => {}))(name)
    await assertSafePaths({ layout, homeDirectory, windowsPathInspector: dependencies.windowsPathInspector, currentUid, targets })
  }
  const versionRoot = layout.pathApi.join(layout.installRoot, manifest.version)
  const preview = previewFor({ manifest, layout })
  const stdout = dependencies.stdout ?? ((text) => process.stdout.write(text))
  stdout(`${JSON.stringify(preview, null, 2)}\n`)
  if (mode === 'preview') return { status: 'preview', preview }

  assertLayoutBoundaries({ layout, homeDirectory, localAppData, workspaceRoot: dependencies.workspaceRoot ?? process.cwd() })
  await assertSafePaths({
    layout,
    homeDirectory,
    windowsPathInspector: dependencies.windowsPathInspector,
    currentUid,
    targets: [layout.installRoot, layout.binDirectory, layout.configDirectory, layout.configPath, versionRoot],
  })
  const mergedConfig = await readConfigForMerge({ layout, homeDirectory, windowsPathInspector: dependencies.windowsPathInspector, currentUid })
  await preflightStableEntry(layout, manifest.version, currentUid)
  const alreadyInstalled = await inspectExistingVersion({ versionRoot, manifest, layout, currentUid })

  await ensureDirectory({ directory: layout.installRoot, mode: 0o700, layout, homeDirectory, windowsPathInspector: dependencies.windowsPathInspector, currentUid })
  const stagingRoot = alreadyInstalled ? null : await mkdtemp(layout.pathApi.join(layout.installRoot, '.install-'))
  const archivePath = stagingRoot ? layout.pathApi.join(stagingRoot, manifest.assetName) : null
  let installedFresh = false
  let entryTransaction = null
  let configTransaction = null
  try {
    if (!alreadyInstalled) {
      await downloadAsset({ manifest, destination: archivePath, fetchImplementation: dependencies.fetch ?? globalThis.fetch })
      const execute = dependencies.execFile ?? execFileAsync
      const npmCommand = platform === 'win32' ? 'npm.cmd' : 'npm'
      await execute(npmCommand, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', archivePath], {
        cwd: stagingRoot,
        windowsHide: true,
      })
      await verifyInstalledPackage(stagingRoot, manifest, layout.pathApi)
      await rm(archivePath, { force: true })
      const inventory = await inventoryTree(stagingRoot, { pathApi: layout.pathApi, currentUid })
      await writeFile(layout.pathApi.join(stagingRoot, MARKER_NAME), `${JSON.stringify(markerFor(manifest, inventory))}\n`, { flag: 'wx', mode: 0o600 })
      await assertSafePaths({ layout, homeDirectory, windowsPathInspector: dependencies.windowsPathInspector, currentUid, targets: [layout.installRoot, versionRoot] })
      await rename(stagingRoot, versionRoot)
      installedFresh = true
      await checkAfterSwap('version', [layout.installRoot, versionRoot])
      await inspectExistingVersion({ versionRoot, manifest, layout, currentUid })
    }
    await ensureDirectory({ directory: layout.binDirectory, mode: 0o755, preserveExistingMode: true, layout, homeDirectory, windowsPathInspector: dependencies.windowsPathInspector, currentUid })
    await failpoint('bin-ready')
    await preflightStableEntry(layout, manifest.version, currentUid)
    if (await parseManagedStableEntry(layout, currentUid) !== manifest.version) {
      entryTransaction = await switchStableEntry({ layout, manifest, homeDirectory, windowsPathInspector: dependencies.windowsPathInspector, currentUid, failpoint, checkAfterSwap })
    }
    await verifyInstalledPackage(versionRoot, manifest, layout.pathApi)
    configTransaction = await writeConfigAtomically({ config: mergedConfig, layout, homeDirectory, windowsPathInspector: dependencies.windowsPathInspector, currentUid, failpoint, checkAfterSwap })
    await configTransaction.commit()
    await entryTransaction?.commit()
    return { status: alreadyInstalled ? 'already-installed' : 'installed', version: manifest.version, stableEntry: layout.stableEntry }
  } catch (error) {
    await configTransaction?.rollback().catch(() => {})
    await entryTransaction?.rollback().catch(() => {})
    if (installedFresh) await rm(versionRoot, { recursive: true, force: true })
    throw error
  } finally {
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true })
  }
}

const readEmbeddedManifest = async () => {
  let source
  try { source = await readFile(new URL('../release-manifest.json', import.meta.url), 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return fail('INSTALLER_NOT_PUBLISHED', 'CLI 尚未发布：Skill 内嵌 release-manifest.json 不存在')
    throw error
  }
  try { return JSON.parse(source) } catch { return fail('INSTALLER_MANIFEST_INVALID', 'Skill 内嵌 manifest 不是有效 JSON') }
}

export const runEmbeddedInstaller = async ({ argv = process.argv.slice(2), dependencies = {} } = {}) => {
  let manifest
  try { manifest = await (dependencies.readManifest ?? readEmbeddedManifest)() } catch (error) {
    if (error.code === 'ENOENT') return fail('INSTALLER_NOT_PUBLISHED', 'CLI 尚未发布：Skill 内嵌 release-manifest.json 不存在')
    throw error
  }
  return runInstaller({ argv, manifest, dependencies })
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  runEmbeddedInstaller().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
