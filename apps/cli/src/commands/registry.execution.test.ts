import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CliSuccessSchema } from '@panshi/contracts'
import { executeCommand } from './registry.js'

const api = <T>(data: T) => ({ apiVersion: 'v1' as const, data })
const bytes = () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close() } })

describe('read command execution contracts', () => {
  it('executes every approved read command with its exact capability envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-cli-commands-'))
    const client = {
      public: {
        getSite: vi.fn(async () => api({ title: 'camp' })),
        getContent: vi.fn(async (key) => api({ contentVersion: 'v1', key, payload: {} })),
        getSchedule: vi.fn(async () => api({ contentVersion: 'v1', schedule: { days: [{ date: '2026-09-04', label: '第一天', theme: '智能体', sessions: [] }] } })),
        getTravel: vi.fn(async () => ({ sections: [] })), getContacts: vi.fn(async () => ({ items: [] })),
        getInstitutions: vi.fn(async () => api({ version: 'v1', sources: [], universities: [{ name: '中国科学院大学', province: '北京', level: '本科' }], ucasTrainingUnits: [{ name: '中国科学院物理研究所', type: 'institute' }] })),
        getRegistrationForm: vi.fn(async () => api({ formVersionId: crypto.randomUUID(), version: 1, form: {} })),
        getApplicationCount: vi.fn(async () => api({ count: 12, public: true })),
        listResources: vi.fn(async () => api({ resources: [] })),
        downloadResource: vi.fn(async () => ({ stream: bytes(), headers: new Headers(), status: 200 })),
      },
      auth: { status: vi.fn(async () => api({ user: { id: 'user-1', displayName: '测试用户', role: 'user', phoneNormalized: '+8613800000000' } })) },
      application: { getMine: vi.fn(async () => api({ application: {}, timeline: [], supplementRequest: null, accessibleResources: [] })) },
      files: { download: vi.fn(async () => ({ stream: bytes(), headers: new Headers(), status: 200 })) },
      checkIn: { show: vi.fn(async () => api({ availability: 'available', qrPayload: 'panshi-check-in-payload-that-is-long-enough', displayCode: 'ABC12345', checkedInAt: null })) },
    }
    const credentials = { get: vi.fn(async () => null), set: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) }
    const cases = [
      ['public.site.show', ['info', 'show']],
      ['public.content.show', ['content', 'get', 'basic']],
      ['public.schedule.list', ['schedule', 'list', '--date', '2026-09-04']],
      ['public.travel.show', ['travel', 'show']],
      ['public.contacts.show', ['contacts', 'show']],
      ['public.institutions.search', ['institutions', 'search', '中国科学院']],
      ['public.registration_form.show', ['application', 'form']],
      ['public.application_count.show', ['application-count', 'show']],
      ['resource.list', ['resources', 'list']],
      ['resource.download', ['resources', 'download', crypto.randomUUID(), '--output', join(root, 'resource.bin')]],
      ['auth.status', ['auth', 'status']],
      ['application.show', ['application', 'show']],
      ['application.validate', ['application', 'validate', '--input', '-']],
      ['file.download', ['files', 'download', crypto.randomUUID(), '--output', join(root, 'file.bin')]],
      ['check_in.show', ['check-in', 'show']],
      ['check_in.qr.export', ['check-in', 'qr', 'export', '--output', join(root, 'check-in.gif')]],
    ] as const
    for (const [expectedCapabilityId, args] of cases) {
      const result = await executeCommand([...args], {
        client: client as never, json: false, profileName: 'local', credentials,
        workspaceRoot: join(root, 'workspace'), homeDirectory: join(root, 'home'),
        stdin: async () => '{}', promptText: async () => '13800000000', readSecret: async () => 'password123',
        readSecrets: async () => ({ password: 'password123' }), confirm: async () => true,
      })
      expect(result.capabilityId).toBe(expectedCapabilityId)
      expect(CliSuccessSchema.safeParse({ ok: true, apiVersion: 'v1', capabilityId: result.capabilityId, data: JSON.parse(JSON.stringify(result.data)), requestId: 'local' }).success).toBe(true)
    }
  })
})
