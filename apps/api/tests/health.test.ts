import request from 'supertest'
import { ApiErrorSchema } from '@panshi/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { getApiEnv } from '../src/config/env.js'
import { createDatabaseHealthCheck } from '../src/db/client.js'

describe('API health', () => {
  it('executes SELECT 1 through the database health capability', async () => {
    const query = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }))

    await createDatabaseHealthCheck({ query })()

    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith('SELECT 1')
  })

  it('returns API and database health with request id', async () => {
    const checkDatabase = vi.fn(async () => undefined)
    const app = createApp({
      checkDatabase,
      config: { allowedOrigins: [], jsonLimit: '1mb' },
    })

    const response = await request(app).get('/healthz')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', database: 'ok' })
    expect(response.headers['x-request-id']).toBeTruthy()
    expect(checkDatabase).toHaveBeenCalledOnce()
  })

  it('preserves a safely validated incoming request id', async () => {
    const app = createTestApp()
    const response = await request(app).get('/healthz').set('X-Request-Id', 'client-request_42')

    expect(response.headers['x-request-id']).toBe('client-request_42')
  })

  it.each([
    'contains spaces',
    'x'.repeat(65),
    'comma,separated',
  ])('replaces an unsafe incoming request id %#', async (incomingRequestId) => {
    const app = createTestApp()
    const response = await request(app).get('/healthz').set('X-Request-Id', incomingRequestId)

    expect(response.headers['x-request-id']).not.toBe(incomingRequestId)
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it('returns a generic safe error with the response request id', async () => {
    const secretError = new Error(
      'SELECT password FROM users at postgres://admin:secret@db.internal/app https://internal.example',
    )
    secretError.stack = `STACK ${secretError.message}`
    const app = createTestApp({ checkDatabase: async () => Promise.reject(secretError) })

    const response = await request(app).get('/healthz').set('X-Request-Id', 'safe-error-id')

    expect(response.status).toBe(500)
    expect(ApiErrorSchema.parse(response.body)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        requestId: 'safe-error-id',
      },
    })
    expect(response.body.error.requestId).toBe(response.headers['x-request-id'])
    expect(JSON.stringify(response.body)).not.toMatch(
      /stack|select|password|postgres|secret|db\.internal|internal\.example/iu,
    )
  })

  it('rejects an oversized JSON body without leaking its contents', async () => {
    const app = createTestApp({ jsonLimit: '32b' })
    const response = await request(app)
      .post('/api/v1/not-implemented')
      .set('Origin', 'https://camp.example')
      .send({ secret: 'do-not-reflect-this-payload' })

    expect(response.status).toBe(413)
    expect(ApiErrorSchema.parse(response.body).error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      requestId: response.headers['x-request-id'],
    })
    expect(JSON.stringify(response.body)).not.toContain('do-not-reflect-this-payload')
    expect(JSON.stringify(response.body)).not.toMatch(/stack/iu)
  })

  it('rejects cross-origin state changes and does not reflect their origin', async () => {
    const app = createTestApp()
    const response = await request(app)
      .post('/api/v1/not-implemented')
      .set('Origin', 'https://evil.example')
      .send({})

    expect(response.status).toBe(403)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('ORIGIN_FORBIDDEN')
  })

  it('rejects state-changing requests without an Origin header', async () => {
    const response = await request(createTestApp()).post('/api/v1/not-implemented').send({})

    expect(response.status).toBe(403)
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('ORIGIN_REQUIRED')
  })

  it('permits configured origins and returns the versioned API 404 boundary', async () => {
    const response = await request(createTestApp())
      .post('/api/v1/not-implemented')
      .set('Origin', 'https://camp.example')
      .send({})

    expect(response.status).toBe(404)
    expect(response.headers['access-control-allow-origin']).toBe('https://camp.example')
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('NOT_FOUND')
  })

  it('answers allowed CORS preflight requests without reflecting arbitrary origins', async () => {
    const allowed = await request(createTestApp())
      .options('/api/v1/not-implemented')
      .set('Origin', 'https://camp.example')
      .set('Access-Control-Request-Method', 'POST')
    const denied = await request(createTestApp())
      .options('/api/v1/not-implemented')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')

    expect(allowed.status).toBe(204)
    expect(allowed.headers['access-control-allow-origin']).toBe('https://camp.example')
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('API runtime configuration', () => {
  it('validates the API port and normalizes comma-separated allowed origins', () => {
    expect(getApiEnv({
      DATABASE_URL: 'postgresql://localhost/panshi',
      API_PORT: '3001',
      CORS_ORIGINS: 'https://camp.example, http://localhost:5173 ',
    })).toEqual({
      DATABASE_URL: 'postgresql://localhost/panshi',
      API_PORT: 3001,
      CORS_ORIGINS: ['https://camp.example', 'http://localhost:5173'],
      JSON_BODY_LIMIT: '1mb',
    })
  })

  it.each([
    { API_PORT: '0', CORS_ORIGINS: 'https://camp.example' },
    { API_PORT: '65536', CORS_ORIGINS: 'https://camp.example' },
    { API_PORT: 'not-a-port', CORS_ORIGINS: 'https://camp.example' },
    { API_PORT: '3001', CORS_ORIGINS: 'https://camp.example/path' },
    { API_PORT: '3001', CORS_ORIGINS: 'javascript:alert(1)' },
  ])('rejects invalid runtime configuration without echoing values %#', (invalid) => {
    const source = {
      DATABASE_URL: 'postgresql://admin:database-secret@localhost/panshi',
      ...invalid,
    }

    expect(() => getApiEnv(source)).toThrow('Invalid API environment configuration')
    try {
      getApiEnv(source)
    } catch (error) {
      expect(String(error)).not.toMatch(/database-secret|javascript|65536|not-a-port/iu)
    }
  })
})

const createTestApp = (overrides: {
  checkDatabase?: () => Promise<void>
  jsonLimit?: string
} = {}) => createApp({
  checkDatabase: overrides.checkDatabase ?? (async () => undefined),
  config: {
    allowedOrigins: ['https://camp.example'],
    jsonLimit: overrides.jsonLimit ?? '1mb',
  },
})
