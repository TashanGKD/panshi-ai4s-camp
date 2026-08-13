import { EventEmitter } from 'node:events'
import request from 'supertest'
import { ApiErrorSchema } from '@panshi/contracts'
import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { getApiEnv } from '../src/config/env.js'
import { createDatabaseHealthCheck } from '../src/db/client.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createServerLifecycle, type ManagedServer } from '../src/server.js'

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
      config: { allowedOrigins: [], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
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

  it('returns a safe 503 when the database check rejects', async () => {
    const secretError = new Error(
      'SELECT password FROM users at postgres://admin:secret@db.internal/app https://internal.example',
    )
    secretError.stack = `STACK ${secretError.message}`
    const app = createTestApp({ checkDatabase: async () => Promise.reject(secretError) })

    const response = await request(app).get('/healthz').set('X-Request-Id', 'safe-error-id')

    expect(response.status).toBe(503)
    expect(ApiErrorSchema.parse(response.body)).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '服务暂时不可用',
        requestId: 'safe-error-id',
      },
    })
    expect(response.body.error.requestId).toBe(response.headers['x-request-id'])
    expect(JSON.stringify(response.body)).not.toMatch(
      /stack|select|password|postgres|secret|db\.internal|internal\.example/iu,
    )
  })

  it('returns a bounded 503 when the database check does not settle', async () => {
    const startedAt = Date.now()
    const app = createTestApp({
      checkDatabase: () => new Promise<void>(() => undefined),
      healthcheckTimeoutMs: 10,
    })

    const response = await request(app).get('/healthz').set('X-Request-Id', 'timeout-id')

    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(response.status).toBe(503)
    expect(ApiErrorSchema.parse(response.body)).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '服务暂时不可用',
        requestId: 'timeout-id',
      },
    })
  })

  it('handles a database rejection that arrives after the health timeout', async () => {
    const app = createTestApp({
      checkDatabase: () => new Promise<void>((_resolve, reject) => {
        setTimeout(() => reject(new Error('late database secret')), 20)
      }),
      healthcheckTimeoutMs: 5,
    })

    const response = await request(app).get('/healthz')
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(response.status).toBe(503)
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('SERVICE_UNAVAILABLE')
    expect(JSON.stringify(response.body)).not.toContain('late database secret')
  })

  it('rejects an oversized JSON body without leaking its contents', async () => {
    const app = createTestApp({ jsonLimitBytes: 32 })
    const response = await request(app)
      .post('/api/v1/not-implemented')
      .set('Origin', 'https://camp.example')
      .send({ secret: 'do-not-reflect-this-payload' })

    expect(response.status).toBe(413)
    expect(ApiErrorSchema.parse(response.body)).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: '请求体过大',
        requestId: response.headers['x-request-id'],
      },
    })
    expect(JSON.stringify(response.body)).not.toContain('do-not-reflect-this-payload')
    expect(JSON.stringify(response.body)).not.toMatch(/stack/iu)
  })

  it.each([
    {
      name: 'malformed JSON',
      headers: { 'Content-Type': 'application/json' },
      body: '{"secret":"fragment"',
      status: 400,
      code: 'MALFORMED_JSON',
      message: 'JSON 请求体格式错误',
    },
    {
      name: 'top-level primitive JSON',
      headers: { 'Content-Type': 'application/json' },
      body: '42',
      status: 400,
      code: 'MALFORMED_JSON',
      message: 'JSON 请求体格式错误',
    },
    {
      name: 'unsupported charset',
      headers: { 'Content-Type': 'application/json; charset=madeup-secret' },
      body: '{}',
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: '不支持的请求内容格式',
    },
    {
      name: 'unsupported content encoding',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'secret-encoding' },
      body: '{}',
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: '不支持的请求内容格式',
    },
  ])('returns a safe envelope for $name', async ({ headers, body, status, code, message }) => {
    const response = await request(createTestApp())
      .post('/api/v1/not-implemented')
      .set('Origin', 'https://camp.example')
      .set('X-Request-Id', 'parser-error-id')
      .set(headers)
      .send(body)

    expect(response.status).toBe(status)
    expect(ApiErrorSchema.parse(response.body)).toEqual({
      error: { code, message, requestId: 'parser-error-id' },
    })
    expect(response.headers['x-request-id']).toBe('parser-error-id')
    expect(JSON.stringify(response.body)).not.toMatch(
      /secret|fragment|charset|encoding|stack|entity\.parse\.failed/iu,
    )
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

describe('unified error handling', () => {
  it('delegates exactly once without writing when headers were already sent', () => {
    const error = new Error('private failure')
    const next = vi.fn()
    const response = {
      headersSent: true,
      locals: { requestId: 'already-sent-id' },
      setHeader: vi.fn(),
      status: vi.fn(),
      json: vi.fn(),
    }

    errorHandler(
      error,
      {} as Request,
      response as unknown as Response,
      next as NextFunction,
    )

    expect(next).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledWith(error)
    expect(response.setHeader).not.toHaveBeenCalled()
    expect(response.status).not.toHaveBeenCalled()
    expect(response.json).not.toHaveBeenCalled()
  })

  it('constructs a generic 500 envelope for an unknown error', () => {
    const next = vi.fn()
    const json = vi.fn()
    const status = vi.fn(() => ({ json }))
    const setHeader = vi.fn()
    const response = {
      headersSent: false,
      locals: { requestId: 'unknown-error-id' },
      setHeader,
      status,
    }

    errorHandler(
      new Error('SELECT password FROM secret_table'),
      {} as Request,
      response as unknown as Response,
      next as NextFunction,
    )

    expect(next).not.toHaveBeenCalled()
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'unknown-error-id')
    expect(status).toHaveBeenCalledWith(500)
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        requestId: 'unknown-error-id',
      },
    })
    expect(JSON.stringify(json.mock.calls)).not.toMatch(/select|password|secret_table|stack/iu)
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
      HEALTHCHECK_TIMEOUT_MS: 2_000,
      JSON_BODY_LIMIT_BYTES: 1_048_576,
    })
  })

  it('accepts body-limit boundaries and bounded health timeouts', () => {
    const base = {
      DATABASE_URL: 'postgresql://localhost/panshi',
      API_PORT: '3001',
      CORS_ORIGINS: '',
    }

    expect(getApiEnv({ ...base, JSON_BODY_LIMIT: '1kb', HEALTHCHECK_TIMEOUT_MS: '100' }))
      .toMatchObject({ JSON_BODY_LIMIT_BYTES: 1_024, HEALTHCHECK_TIMEOUT_MS: 100 })
    expect(getApiEnv({ ...base, JSON_BODY_LIMIT: '10mb', HEALTHCHECK_TIMEOUT_MS: '10000' }))
      .toMatchObject({ JSON_BODY_LIMIT_BYTES: 10_485_760, HEALTHCHECK_TIMEOUT_MS: 10_000 })
  })

  it('accepts canonical IPv6, deduplicates origins, and allows an empty allowlist', () => {
    const base = {
      DATABASE_URL: 'postgresql://localhost/panshi',
      API_PORT: '3001',
    }

    expect(getApiEnv({
      ...base,
      CORS_ORIGINS: 'http://[::1]:5173,https://camp.example,https://camp.example',
    }).CORS_ORIGINS).toEqual(['http://[::1]:5173', 'https://camp.example'])
    expect(getApiEnv({ ...base, CORS_ORIGINS: '' }).CORS_ORIGINS).toEqual([])
  })

  it.each([
    { API_PORT: '0', CORS_ORIGINS: 'https://camp.example' },
    { API_PORT: '65536', CORS_ORIGINS: 'https://camp.example' },
    { API_PORT: 'not-a-port', CORS_ORIGINS: 'https://camp.example' },
    { API_PORT: '3001', CORS_ORIGINS: 'https://camp.example/path' },
    { API_PORT: '3001', CORS_ORIGINS: 'javascript:alert(1)' },
    { API_PORT: '3001', CORS_ORIGINS: 'https://camp.example:443' },
    { API_PORT: '3001', CORS_ORIGINS: '', JSON_BODY_LIMIT: '0b' },
    { API_PORT: '3001', CORS_ORIGINS: '', JSON_BODY_LIMIT: '1023b' },
    { API_PORT: '3001', CORS_ORIGINS: '', JSON_BODY_LIMIT: '10485761b' },
    { API_PORT: '3001', CORS_ORIGINS: '', JSON_BODY_LIMIT: '1gb' },
    { API_PORT: '3001', CORS_ORIGINS: '', HEALTHCHECK_TIMEOUT_MS: '99' },
    { API_PORT: '3001', CORS_ORIGINS: '', HEALTHCHECK_TIMEOUT_MS: '10001' },
  ])('rejects invalid runtime configuration without echoing values %#', (invalid) => {
    const source = {
      DATABASE_URL: 'postgresql://admin:database-secret@localhost/panshi',
      ...invalid,
    }

    expect(() => getApiEnv(source)).toThrow('Invalid API environment configuration')
    try {
      getApiEnv(source)
    } catch (error) {
      expect(String(error)).not.toMatch(
        /database-secret|javascript|65536|not-a-port|10485761|10001|1023b|1gb/iu,
      )
    }
  })
})

describe('server lifecycle', () => {
  it('handles startup errors and closes resources exactly once', async () => {
    const server = createFakeServer()
    const closeDatabase = vi.fn(async () => undefined)
    const lifecycle = createServerLifecycle({ listen: () => server, closeDatabase })

    const started = lifecycle.start()
    server.emit('error', Object.assign(new Error('address and secret details'), { code: 'EADDRINUSE' }))

    await expect(started).rejects.toThrow('API server failed to start')
    expect(server.close).toHaveBeenCalledOnce()
    expect(closeDatabase).toHaveBeenCalledOnce()
  })

  it('shares concurrent shutdown and closes HTTP and database once', async () => {
    const server = createFakeServer()
    const closeDatabase = vi.fn(async () => undefined)
    const lifecycle = createServerLifecycle({ listen: () => server, closeDatabase })
    const started = lifecycle.start()
    server.emit('listening')
    await started

    const first = lifecycle.shutdown()
    const second = lifecycle.shutdown()

    expect(first).toBe(second)
    await expect(first).resolves.toBeUndefined()
    expect(server.close).toHaveBeenCalledOnce()
    expect(closeDatabase).toHaveBeenCalledOnce()
  })

  it('ignores ERR_SERVER_NOT_RUNNING during shutdown around startup', async () => {
    const notRunning = Object.assign(new Error('not running'), { code: 'ERR_SERVER_NOT_RUNNING' })
    const server = createFakeServer(notRunning)
    const closeDatabase = vi.fn(async () => undefined)
    const lifecycle = createServerLifecycle({ listen: () => server, closeDatabase })
    const started = lifecycle.start()

    const shutdown = lifecycle.shutdown()

    await expect(shutdown).resolves.toBeUndefined()
    await expect(started).rejects.toThrow('API server stopped before listening')
    expect(server.close).toHaveBeenCalledOnce()
    expect(closeDatabase).toHaveBeenCalledOnce()
  })

  it('reports a controlled server close failure and still closes the database', async () => {
    const server = createFakeServer(new Error('server close secret'))
    const closeDatabase = vi.fn(async () => undefined)
    const lifecycle = createServerLifecycle({ listen: () => server, closeDatabase })
    const started = lifecycle.start()
    server.emit('listening')
    await started

    await expect(lifecycle.shutdown()).rejects.toThrow('API server shutdown failed')
    expect(closeDatabase).toHaveBeenCalledOnce()
  })

  it('reports a controlled database close failure without retrying closure', async () => {
    const server = createFakeServer()
    const closeDatabase = vi.fn(async () => Promise.reject(new Error('database close secret')))
    const lifecycle = createServerLifecycle({ listen: () => server, closeDatabase })
    const started = lifecycle.start()
    server.emit('listening')
    await started

    const first = lifecycle.shutdown()
    const second = lifecycle.shutdown()
    await expect(first).rejects.toThrow('API server shutdown failed')
    await expect(second).rejects.toThrow('API server shutdown failed')
    expect(server.close).toHaveBeenCalledOnce()
    expect(closeDatabase).toHaveBeenCalledOnce()
  })
})

const createTestApp = (overrides: {
  checkDatabase?: () => Promise<void>
  healthcheckTimeoutMs?: number
  jsonLimitBytes?: number
} = {}) => createApp({
  checkDatabase: overrides.checkDatabase ?? (async () => undefined),
  config: {
    allowedOrigins: ['https://camp.example'],
    healthcheckTimeoutMs: overrides.healthcheckTimeoutMs ?? 2_000,
    jsonLimitBytes: overrides.jsonLimitBytes ?? 1_048_576,
  },
})

type FakeServer = ManagedServer & EventEmitter

const createFakeServer = (closeError?: Error): FakeServer => {
  const server = new EventEmitter() as unknown as FakeServer
  server.close = vi.fn((callback) => {
    callback(closeError)
    return server
  })
  return server
}
