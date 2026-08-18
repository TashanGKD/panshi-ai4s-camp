import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runApplicationSubmit } from './application.js'
import { runAuthLogin } from './auth.js'
import { runFileDelete, runFileUpload } from './files.js'

const id = () => crypto.randomUUID()
const prepared = (confirmation: 'single' | 'double' = 'single') => ({ apiVersion: 'v1' as const, data: {
  confirmationId: id(), expiresAt: '2026-09-01T00:00:00.000Z', preview: { action: '操作', fileId: id() },
  payloadSha256: 'a'.repeat(64), confirmation,
} })

const context = (client: object, args: string[] = [], overrides: Record<string, unknown> = {}) => ({
  client, args, json: false, profileName: 'local', phoneHint: '+8613800000000',
  credentials: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }, workspaceRoot: '/tmp/work', homeDirectory: '/tmp/home',
  stdin: async () => '', promptText: async () => '', readSecret: async () => '',
  readSecrets: async () => ({ password: 'safe-password' }), confirm: async () => true,
  ...overrides,
}) as never

describe('confirmed mutation commands', () => {
  it('prepares application submission without execution in JSON mode', async () => {
    const submit = vi.fn(); const prepare = vi.fn(async () => prepared())
    const client = { application: { getMine: vi.fn(async () => ({ data: { application: { revision: 4 } } })), submit }, confirmations: { prepare } }
    const error = await runApplicationSubmit(context(client, [], { json: true })).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'CONFIRMATION_REQUIRED' }); expect(prepare).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled()
  })

  it('executes a second submission invocation only with its complete context', async () => {
    const confirmationId = id(); const idempotencyKey = id(); const clientBinding = 'b'.repeat(64)
    const submit = vi.fn(async () => ({ apiVersion: 'v1', data: { status: 'submitted' } }))
    const client = { application: { getMine: vi.fn(async () => ({ data: { application: { revision: 4 } } })), submit }, confirmations: { prepare: vi.fn() } }
    await runApplicationSubmit(context(client, ['--confirmation-id', confirmationId, '--client-binding', clientBinding, '--idempotency-key', idempotencyKey], { json: true }))
    expect(submit).toHaveBeenCalledWith(4, { confirmationId, clientBinding, idempotencyKey })
  })

  it('requires the exact file identifier for destructive confirmation and rejects bypass flags', async () => {
    const fileId = id(); const remove = vi.fn(async () => ({ apiVersion: 'v1', data: {} })); const preview = prepared('double')
    preview.data.preview.fileId = fileId
    const confirm = vi.fn(async (_preview, mode, target) => mode === 'double' && target === fileId)
    const client = { confirmations: { prepare: vi.fn(async () => preview) }, files: { delete: remove } }
    await runFileDelete(context(client, [fileId], { confirm })); expect(remove).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledWith(expect.anything(), 'double', fileId)
    await expect(runFileDelete(context(client, [fileId, '--yes']))).rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })

  it('rejects symlink and oversized uploads before preparing a confirmation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-upload-')); const real = join(root, 'real.pdf'); const link = join(root, 'link.pdf'); const large = join(root, 'large.pdf')
    await writeFile(real, '%PDF-1.4'); await symlink(real, link); await writeFile(large, Buffer.alloc(5 * 1024 * 1024 + 1))
    const prepare = vi.fn(); const client = { confirmations: { prepare }, files: { upload: vi.fn() } }; const slot = id()
    await expect(runFileUpload(context(client, [link, '--slot', slot]))).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    await expect(runFileUpload(context(client, [large, '--slot', slot]))).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('never accepts a plaintext password argument for login', async () => {
    const client = { confirmations: { prepare: vi.fn() }, auth: { loginCli: vi.fn() } }
    await expect(runAuthLogin(context(client, ['plaintext-password']))).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    expect(client.confirmations.prepare).not.toHaveBeenCalled()
  })
})
