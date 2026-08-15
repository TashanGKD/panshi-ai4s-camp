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

  it('selects the client through exactly two trusted hops and rejects direct or prepended spoofing', async () => {
    const make = (trustProxyHops: number) => createApp({
      checkDatabase: async () => undefined,
      config: {
        allowedOrigins: [], healthcheckTimeoutMs: 10, jsonLimitBytes: 10_000, trustProxyHops,
        rateLimits: { public: { max: 1, windowMs: 60_000 } },
      },
    })
    const untrusted = make(0)
    await request(untrusted).get('/api/v1/public/site').set('X-Forwarded-For', '198.51.100.10').expect(404)
    const blocked = await request(untrusted).get('/api/v1/public/site').set('X-Forwarded-For', '198.51.100.11').expect(429)
    expect(blocked.body.error.code).toBe('RATE_LIMITED')
    expect(blocked.headers['retry-after']).toBe('60')
    expect(blocked.headers['cache-control']).toBe('no-store')

    const trusted = make(2)
    await request(trusted).get('/api/v1/public/site').set('X-Forwarded-For', '198.51.100.10, 192.0.2.10').expect(404)
    await request(trusted).get('/api/v1/public/site').set('X-Forwarded-For', '198.51.100.11, 192.0.2.10').expect(404)
    await request(trusted).get('/api/v1/public/site').set('X-Forwarded-For', '203.0.113.1, 198.51.100.12, 192.0.2.10').expect(404)
    const spoofBlocked = await request(trusted).get('/api/v1/public/site').set('X-Forwarded-For', '203.0.113.2, 198.51.100.12, 192.0.2.10').expect(429)
    expect(spoofBlocked.headers['cache-control']).toBe('no-store')
  })

  it('bounds unique actors, sweeps expired buckets, and retains a recently active actor deterministically', () => {
    let now = 1_000
    const store = new InMemoryRateLimitStore({ now: () => now, maxBuckets: 3, sweepIntervalMs: 100 })
    const limiter = createRateLimiter({ store, now: () => now })
    const policy = { max: 1, windowMs: 1_000 }
    limiter.consume('public', 'active', policy)
    limiter.consume('public', 'oldest', policy)
    limiter.consume('public', 'newer', policy)
    expect(limiter.consume('public', 'active', policy).allowed).toBe(false)
    limiter.consume('public', 'new-actor', policy)
    expect(store.size).toBe(3)
    expect(limiter.consume('public', 'active', policy).allowed).toBe(false)
    expect(limiter.consume('public', 'oldest', policy).allowed).toBe(true)

    now = 2_001
    limiter.consume('public', 'after-expiry', policy)
    expect(store.size).toBe(1)
  })

  it('returns no-store and Retry-After for public and resource-family 429 responses', async () => {
    const app = createApp({
      checkDatabase: async () => undefined,
      config: { allowedOrigins: [], healthcheckTimeoutMs: 10, jsonLimitBytes: 10_000, rateLimits: { public: { max: 1, windowMs: 60_000 }, authenticated: { max: 1, windowMs: 60_000 } } },
    })
    for (const path of ['/api/v1/public/site', '/api/v1/resources/00000000-0000-4000-8000-000000000001']) {
      await request(app).get(path).expect(404)
      const blockedResponse = await request(app).get(path).expect(429)
      expect(blockedResponse.headers['retry-after']).toBe('60')
      expect(blockedResponse.headers['cache-control']).toBe('no-store')
    }
  })
})
