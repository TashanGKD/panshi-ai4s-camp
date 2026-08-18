import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliRuntimeError } from '../errors.js'
import { parseOptions, requiredString } from './options.js'

type Agent = 'codex' | 'claude-code'
type Entry = { path: string, sha256: string }

const defaultSource = resolve(fileURLToPath(new URL('../../../../skills/panshi-camp', import.meta.url)))
const targetFor = (home: string, agent: Agent) => join(home, agent === 'codex' ? '.codex/skills/panshi-camp' : '.claude/skills/panshi-camp')

const inventory = async (root: string, cursor = root): Promise<Entry[]> => {
  const metadata = await lstat(cursor).catch(() => { throw new CliRuntimeError('RESOURCE_NOT_FOUND', 'Skill 来源不存在') })
  if (metadata.isSymbolicLink()) throw new CliRuntimeError('INPUT_INVALID', 'Skill 目录不得包含符号链接')
  if (metadata.isFile()) return [{ path: relative(root, cursor), sha256: createHash('sha256').update(await readFile(cursor)).digest('hex') }]
  if (!metadata.isDirectory()) throw new CliRuntimeError('INPUT_INVALID', 'Skill 来源包含不支持的文件类型')
  const entries = await readdir(cursor, { withFileTypes: true }); const files: Entry[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) files.push(...await inventory(root, join(cursor, entry.name)))
  return files
}

const digestInventory = (entries: Entry[]) => createHash('sha256').update(JSON.stringify(entries)).digest('hex')

const assertSafeTarget = async (homeDirectory: string, target: string) => {
  const home = resolve(homeDirectory); const resolvedTarget = resolve(target)
  const homeRelation = relative(home, resolvedTarget)
  if (resolvedTarget === parse(resolvedTarget).root || homeRelation === '' || homeRelation.startsWith('..') || isAbsolute(homeRelation)) {
    throw new CliRuntimeError('INPUT_INVALID', 'Skill 安装目标过于宽泛')
  }
  let cursor = home
  for (const segment of relative(home, dirname(resolvedTarget)).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment)
    const metadata = await lstat(cursor).catch(() => null)
    if (metadata?.isSymbolicLink()) throw new CliRuntimeError('INPUT_INVALID', 'Skill 安装路径不得经过符号链接')
    if (metadata && !metadata.isDirectory()) throw new CliRuntimeError('INPUT_INVALID', 'Skill 安装路径无效')
  }
  const existing = await lstat(resolvedTarget).catch(() => null)
  if (existing?.isSymbolicLink()) throw new CliRuntimeError('INPUT_INVALID', 'Skill 安装目标不得为符号链接')
  if (existing && !existing.isDirectory()) throw new CliRuntimeError('OUTPUT_EXISTS', 'Skill 安装目标已存在且不是目录')
  return existing
}

export const runSkillCommand = async (args: string[], options: {
  homeDirectory: string
  sourceDirectory?: string
  onPreview?: (preview: unknown) => unknown
}) => {
  const source = resolve(options.sourceDirectory ?? defaultSource)
  if (source === parse(source).root || source === resolve(options.homeDirectory) || basename(source) !== 'panshi-camp') throw new CliRuntimeError('INPUT_INVALID', 'Skill 来源路径无效')
  if (args[0] === 'path' && args.length === 1) { await inventory(source); return { path: source } }
  if (args[0] !== 'install') throw new CliRuntimeError('INPUT_INVALID', 'skill 仅支持 path 或 install')
  const { positionals, values } = parseOptions(args.slice(1), { '--agent': 'string', '--confirm': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'skill install 参数无效')
  const agent = requiredString(values, 'agent')
  if (agent !== 'codex' && agent !== 'claude-code') throw new CliRuntimeError('INPUT_INVALID', '仅支持 codex 或 claude-code')
  const target = targetFor(resolve(options.homeDirectory), agent)
  const existing = await assertSafeTarget(options.homeDirectory, target)
  const sourceEntries = await inventory(source); const sourceDigest = digestInventory(sourceEntries)
  if (existing) {
    const targetEntries = await inventory(target)
    if (digestInventory(targetEntries) === sourceDigest) return { installed: false, alreadyCurrent: true, source, target }
    throw new CliRuntimeError('OUTPUT_EXISTS', 'Skill 安装目录已存在且内容不同，拒绝覆盖', { source, target })
  }
  const confirmationToken = createHash('sha256').update(JSON.stringify({ agent, source, target, sourceDigest })).digest('hex')
  const preview = { source, target, diff: { add: sourceEntries.map(({ path }) => path), change: [], remove: [] }, confirmationToken }
  if (values.confirm !== confirmationToken) {
    options.onPreview?.(preview)
    throw new CliRuntimeError('CONFIRMATION_REQUIRED', '请核对 Skill 安装预览后使用 confirmationToken 再次执行', preview)
  }
  const parent = dirname(target); await mkdir(parent, { recursive: true }); await assertSafeTarget(options.homeDirectory, target)
  const temporary = join(parent, `.panshi-camp.install-${randomUUID()}`)
  try {
    await cp(source, temporary, { recursive: true, errorOnExist: true, force: false })
    if (digestInventory(await inventory(temporary)) !== sourceDigest) throw new CliRuntimeError('REQUEST_FAILED', 'Skill 临时副本校验失败')
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
  return { installed: true, source, target, sha256: sourceDigest }
}
