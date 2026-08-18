import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { saveDownload } from './download.js'

const stream = (chunks: string[], fail = false) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
    if (fail) controller.error(new Error('interrupted'))
    else controller.close()
  },
})

describe('safe downloads', () => {
  it('writes a new file with private permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-download-'))
    const target = join(root, 'resource.txt')
    await saveDownload({ outputPath: target, stream: stream(['hello']), headers: new Headers(), workspaceRoot: root, homeDirectory: homedir() })
    expect(await readFile(target, 'utf8')).toBe('hello')
  })

  it.each(['/', homedir(), '$HOME/file.pdf', '${HOME}/file.pdf', '%HOME%/file.pdf'])('rejects protected or unresolved target %s', async (outputPath) => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-download-reject-'))
    await expect(saveDownload({ outputPath, stream: stream(['x']), headers: new Headers(), workspaceRoot: root, homeDirectory: homedir() }))
      .rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })

  it('rejects an existing target, directory, workspace root, and symlinked parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-download-path-'))
    const existing = join(root, 'existing.txt'); await writeFile(existing, 'keep')
    await expect(saveDownload({ outputPath: existing, stream: stream(['x']), headers: new Headers(), workspaceRoot: root, homeDirectory: homedir() })).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' })
    await expect(saveDownload({ outputPath: root, stream: stream(['x']), headers: new Headers(), workspaceRoot: root, homeDirectory: homedir() })).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    const directory = join(root, 'directory'); await mkdir(directory)
    await expect(saveDownload({ outputPath: directory, stream: stream(['x']), headers: new Headers(), workspaceRoot: join(root, 'workspace'), homeDirectory: homedir() })).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' })
    const real = join(root, 'real'); await mkdir(real)
    const linked = join(root, 'linked'); await symlink(real, linked)
    await expect(saveDownload({ outputPath: join(linked, 'x.txt'), stream: stream(['x']), headers: new Headers(), workspaceRoot: join(root, 'workspace'), homeDirectory: homedir() })).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    expect(await readFile(existing, 'utf8')).toBe('keep')
  })

  it('rejects a traversal filename supplied by the server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-download-name-'))
    const headers = new Headers({ 'Content-Disposition': 'attachment; filename="../secret.txt"' })
    await expect(saveDownload({ outputPath: join(root, 'safe.txt'), stream: stream(['x']), headers, workspaceRoot: join(root, 'workspace'), homeDirectory: homedir() }))
      .rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })

  it('removes only its temporary file after an interrupted transfer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-download-clean-'))
    const keep = join(root, 'keep.txt'); await writeFile(keep, 'keep')
    const target = join(root, 'new.txt')
    await expect(saveDownload({ outputPath: target, stream: stream(['partial'], true), headers: new Headers(), workspaceRoot: join(root, 'workspace'), homeDirectory: homedir() })).rejects.toBeTruthy()
    expect(await readFile(keep, 'utf8')).toBe('keep')
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
