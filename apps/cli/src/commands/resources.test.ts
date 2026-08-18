import { CampClientError } from '@panshi/camp-client'
import { describe, expect, it, vi } from 'vitest'
import { runResourceDownload } from './resources.js'

const context = (client: object) => ({
  client, args: [crypto.randomUUID(), '--output', '/tmp/denied.pdf'], json: true,
  profileName: 'local', phoneHint: '+8613800000000',
  credentials: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  workspaceRoot: '/tmp/work', homeDirectory: '/tmp/home', stdin: async () => '',
  promptText: async () => '', readSecret: async () => '', readSecrets: async () => ({}),
  confirm: async () => true,
}) as never

describe('resource commands', () => {
  it('normalizes the concealed API denial to the stable CLI not-found code', async () => {
    const client = {
      public: {
        downloadResource: vi.fn(async () => {
          throw new CampClientError('RESOURCE_NOT_AVAILABLE', '资料不存在或不可访问', 404, 'request-id')
        }),
      },
    }

    await expect(runResourceDownload(context(client))).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      requestId: 'request-id',
    })
  })
})
