import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createRateLimiter, InMemoryRateLimitStore } from '../src/middleware/rate-limit.js'

describe('rate limiter policy', () => {
  it('separates categories and actors, enforces the threshold, and opens a new window', () => {
    let now = 1_000
    const limiter = createRateLimiter({ store: new InMemoryRateLimitStore(), now: () => now })
    expect(limiter.consume('public', 'ip:a', { max: 2, windowMs: 1_000 }).allowed).toBe(true)
    expect(limiter.consume('public', 'ip:a', { max: 2, windowMs: 1_000 }).allowed).toBe(true)
    expect(limiter.consume('public', 'ip:a', { max: 2, windowMs: 1_000 })).toMatchObject({ allowed: false, retryAfterSeconds: 1 })
    expect(limiter.consume('admin', 'ip:a', { max: 1, windowMs: 1_000 }).allowed).toBe(true)
    expect(limiter.consume('public', 'ip:b', { max: 2, windowMs: 1_000 }).allowed).toBe(true)
    now = 2_001
    expect(limiter.consume('public', 'ip:a', { max: 2, windowMs: 1_000 }).allowed).toBe(true)
  })

  it('resets a login actor after success without affecting another actor', () => {
    const limiter = createRateLimiter({ store: new InMemoryRateLimitStore(), now: () => 1_000 })
    const policy = { max: 1, windowMs: 60_000 }
    limiter.consume('login_failure', 'ip:a|account:one', policy)
    limiter.consume('login_failure', 'ip:a|account:two', policy)
    limiter.reset('login_failure', 'ip:a|account:one')
    expect(limiter.consume('login_failure', 'ip:a|account:one', policy).allowed).toBe(true)
    expect(limiter.consume('login_failure', 'ip:a|account:two', policy).allowed).toBe(false)
  })

  it('ignores spoofed forwarded addresses unless one trusted proxy hop is explicit', async () => {
    const make = (trustProxy: boolean) => createApp({
      checkDatabase: async () => undefined,
      config: {
        allowedOrigins: [], healthcheckTimeoutMs: 10, jsonLimitBytes: 10_000, trustProxy,
        rateLimits: { public: { max: 1, windowMs: 60_000 } },
      },
    })
    const untrusted = make(false)
    await request(untrusted).get('/api/v1/public/site').set('X-Forwarded-For', '198.51.100.10').expect(404)
    const blocked = await request(untrusted).get('/api/v1/public/site').set('X-Forwarded-For', '198.51.100.11').expect(429)
    expect(blocked.body.error.code).toBe('RATE_LIMITED')
    expect(blocked.headers['retry-after']).toBe('60')

    const trusted = make(true)
    await request(trusted).get('/api/v1/public/site').set('X-Forwarded-For', '198.51.100.10').expect(404)
    await request(trusted).get('/api/v1/public/site').set('X-Forwarded-For', '198.51.100.11').expect(404)
  })
})
