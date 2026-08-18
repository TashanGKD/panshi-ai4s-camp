import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { JsonObject } from '@panshi/contracts'
import {
  ConfirmationError,
  canonicalJson,
  createConfirmationService,
  hashCanonicalJson,
  type ConfirmationActor,
  type ConfirmationIntent,
  type ConfirmationRepository,
} from '../src/modules/confirmations/confirmation.service.js'
import { createConfirmationHandlerRegistry } from '../src/modules/confirmations/confirmation-handlers.js'

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const BINDING_A = 'a'.repeat(64)
const BINDING_B = 'b'.repeat(64)

class MemoryConfirmationRepository implements ConfirmationRepository {
  readonly rows = new Map<string, ConfirmationIntent>()

  async create(input: ConfirmationIntent) {
    const existing = [...this.rows.values()].find((row) => row.idempotencyKey === input.idempotencyKey
      && (input.actorUserId ? row.actorUserId === input.actorUserId : row.clientBindingDigest === input.clientBindingDigest))
    if (existing) return existing
    this.rows.set(input.id, input)
    return input
  }

  async findById(id: string) { return this.rows.get(id) ?? null }

  async claim(id: string, now: Date) {
    const row = this.rows.get(id)
    if (!row || row.status !== 'pending' || row.expiresAt.getTime() <= now.getTime()) return false
    this.rows.set(id, { ...row, status: 'executing' })
    return true
  }

  async consume(id: string, safeResult: JsonObject, consumedAt: Date) {
    const row = this.rows.get(id)!
    this.rows.set(id, { ...row, status: 'consumed', safeResult, consumedAt })
  }

  async reject(id: string, status: 'expired' | 'failed') {
    const row = this.rows.get(id)
    if (row) this.rows.set(id, { ...row, status })
  }
}

const actor = (userId: string | null): ConfirmationActor => ({ userId, role: userId ? 'user' : 'anonymous' })

const createHarness = (now = new Date('2026-08-18T00:00:00.000Z')) => {
  const repository = new MemoryConfirmationRepository()
  const execute = vi.fn(async ({ preparedPayload }: { preparedPayload: JsonObject }) => ({ accepted: true, targetId: preparedPayload.targetId ?? null }))
  const handlers = createConfirmationHandlerRegistry([{
    capabilityId: 'application.submit',
    prepare: (payload) => ({
      preview: { action: '提交报名', targetId: payload.targetId ?? null, revision: payload.revision ?? null },
      targetType: 'application',
      targetId: String(payload.targetId),
      expectedRevision: Number(payload.revision),
    }),
    execute,
  }])
  const service = createConfirmationService(repository, handlers, { now: () => now })
  return { repository, service, execute }
}

const request = (overrides: Partial<{ payload: JsonObject, clientBinding: string, idempotencyKey: string }> = {}) => ({
  capabilityId: 'application.submit' as const,
  payload: overrides.payload ?? { targetId: 'app-1', revision: 3 },
  clientBinding: overrides.clientBinding ?? BINDING_A,
  idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
})

describe('canonical confirmation payloads', () => {
  it('sorts object keys recursively and hashes equivalent values identically', () => {
    expect(canonicalJson({ z: 1, a: { d: 2, c: [3, { b: true, a: null }] } }))
      .toBe('{"a":{"c":[3,{"a":null,"b":true}],"d":2},"z":1}')
    expect(hashCanonicalJson({ b: 2, a: 1 })).toBe(hashCanonicalJson({ a: 1, b: 2 }))
  })

  it.each([
    { bad: undefined },
    { bad: Number.NaN },
    { bad: Number.POSITIVE_INFINITY },
    { bad: () => true },
    { bad: Symbol('bad') },
    { bad: new Date() },
  ])('rejects non-JSON or prototype-bearing input %#', (payload) => {
    expect(() => canonicalJson(payload as never)).toThrow(ConfirmationError)
  })
})

describe('confirmation intent security', () => {
  it('rejects execution by another user', async () => {
    const { service } = createHarness()
    const input = request()
    const prepared = await service.prepare(actor(USER_A), input)
    await expect(service.execute(actor(USER_B), prepared.confirmationId, {
      clientBinding: BINDING_A, idempotencyKey: input.idempotencyKey, payload: { targetId: 'app-1', revision: 3 },
    })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' })
  })

  it('rejects reusing an idempotency key for a different payload', async () => {
    const { service } = createHarness()
    const idempotencyKey = randomUUID()
    await service.prepare(actor(USER_A), request({ idempotencyKey }))
    await expect(service.prepare(actor(USER_A), request({ idempotencyKey, payload: { targetId: 'app-2', revision: 3 } })))
      .rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' })
  })

  it.each([
    { payload: { targetId: 'app-2', revision: 3 } },
    { payload: { targetId: 'app-1', revision: 4 } },
  ])('rejects target or revision mutation %#', async ({ payload }) => {
    const { service } = createHarness()
    const input = request()
    const prepared = await service.prepare(actor(USER_A), input)
    await expect(service.execute(actor(USER_A), prepared.confirmationId, {
      clientBinding: BINDING_A, idempotencyKey: input.idempotencyKey, payload,
    })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' })
  })

  it('rejects expired intents', async () => {
    let clock = new Date('2026-08-18T00:00:00.000Z')
    const repository = new MemoryConfirmationRepository()
    const handlers = createConfirmationHandlerRegistry([{
      capabilityId: 'application.submit', prepare: () => ({ preview: { action: '提交报名' } }), execute: async () => ({ ok: true }),
    }])
    const service = createConfirmationService(repository, handlers, { now: () => clock })
    const input = request()
    const prepared = await service.prepare(actor(USER_A), input)
    clock = new Date('2026-08-18T00:05:01.000Z')
    await expect(service.execute(actor(USER_A), prepared.confirmationId, {
      clientBinding: BINDING_A, idempotencyKey: input.idempotencyKey, payload: { targetId: 'app-1', revision: 3 },
    })).rejects.toMatchObject({ code: 'CONFIRMATION_EXPIRED' })
  })

  it('returns the stored safe result on an exact consumed replay without invoking the handler twice', async () => {
    const { service, execute } = createHarness()
    const input = request()
    const prepared = await service.prepare(actor(USER_A), input)
    const execution = { clientBinding: BINDING_A, idempotencyKey: input.idempotencyKey, payload: { targetId: 'app-1', revision: 3 } }
    const first = await service.execute(actor(USER_A), prepared.confirmationId, execution)
    const replay = await service.execute(actor(USER_A), prepared.confirmationId, execution)
    expect(replay).toEqual(first)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('allows only one concurrent request to reach the business handler', async () => {
    const repository = new MemoryConfirmationRepository()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const execute = vi.fn(async () => { await blocked; return { ok: true } })
    const service = createConfirmationService(repository, createConfirmationHandlerRegistry([{
      capabilityId: 'application.submit', prepare: () => ({ preview: { action: '提交报名' } }), execute,
    }]), { now: () => new Date('2026-08-18T00:00:00.000Z') })
    const requestInput = request()
    const prepared = await service.prepare(actor(USER_A), requestInput)
    const input = { clientBinding: BINDING_A, idempotencyKey: requestInput.idempotencyKey, payload: { targetId: 'app-1', revision: 3 } }
    const first = service.execute(actor(USER_A), prepared.confirmationId, input)
    await Promise.resolve()
    await expect(service.execute(actor(USER_A), prepared.confirmationId, input))
      .rejects.toMatchObject({ code: 'CONFIRMATION_EXECUTION_INDETERMINATE' })
    release()
    await first
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown handlers, read-only capabilities, and secret preview fields', async () => {
    const { service } = createHarness()
    await expect(service.prepare(actor(USER_A), { ...request(), capabilityId: 'public.site.show' as never }))
      .rejects.toMatchObject({ code: 'STATE_NOT_ALLOWED' })
    await expect(service.prepare(actor(USER_A), { ...request(), capabilityId: 'application.reopen', payload: { password: 'secret' } } as never))
      .rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })

  it('binds anonymous intents to the exact client digest', async () => {
    const repository = new MemoryConfirmationRepository()
    const service = createConfirmationService(repository, createConfirmationHandlerRegistry([{
      capabilityId: 'auth.verification.send', prepare: () => ({ preview: { purpose: 'register', phone: '+8613******000' } }), execute: async () => ({ accepted: true }),
    }]), { now: () => new Date('2026-08-18T00:00:00.000Z') })
    const input = { ...request({ payload: { phoneMasked: '+8613******000', purpose: 'register' } }), capabilityId: 'auth.verification.send' as const }
    const prepared = await service.prepare(actor(null), input)
    await expect(service.execute(actor(null), prepared.confirmationId, {
      clientBinding: BINDING_B, idempotencyKey: input.idempotencyKey, payload: { phoneMasked: '+8613******000', purpose: 'register' },
    })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' })
  })
})
