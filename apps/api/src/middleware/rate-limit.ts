import { createHash } from 'node:crypto'
import type { RequestHandler } from 'express'
import { HttpError } from './error-handler.js'

export type RateLimitCategory = 'login_failure' | 'auth_verification' | 'public' | 'authenticated' | 'admin'
export type RateLimitPolicy = { max: number, windowMs: number }
type Bucket = { count: number, resetAt: number }

export interface RateLimitStore {
  get(key: string): Bucket | undefined
  set(key: string, value: Bucket): void
  delete(key: string): void
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>()
  get(key: string) { return this.buckets.get(key) }
  set(key: string, value: Bucket) { this.buckets.set(key, value) }
  delete(key: string) { this.buckets.delete(key) }
}

export const hashRateLimitIdentifier = (value: string) => createHash('sha256').update(value).digest('hex')

export const createRateLimiter = ({ store = new InMemoryRateLimitStore(), now = Date.now }: { store?: RateLimitStore, now?: () => number } = {}) => {
  const bucketKey = (category: RateLimitCategory, actor: string) => `${category}:${actor}`
  return {
    consume: (category: RateLimitCategory, actor: string, policy: RateLimitPolicy) => {
      const key = bucketKey(category, actor); const currentTime = now(); const existing = store.get(key)
      const bucket = !existing || existing.resetAt <= currentTime ? { count: 0, resetAt: currentTime + policy.windowMs } : existing
      if (bucket.count >= policy.max) return { allowed: false as const, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1_000)) }
      store.set(key, { ...bucket, count: bucket.count + 1 })
      return { allowed: true as const, retryAfterSeconds: 0 }
    },
    reset: (category: RateLimitCategory, actor: string) => store.delete(bucketKey(category, actor)),
  }
}

export type RateLimiter = ReturnType<typeof createRateLimiter>

export const defaultRateLimits: Record<RateLimitCategory, RateLimitPolicy> = {
  login_failure: { max: 5, windowMs: 15 * 60_000 },
  auth_verification: { max: 20, windowMs: 15 * 60_000 },
  public: { max: 120, windowMs: 60_000 },
  authenticated: { max: 300, windowMs: 60_000 },
  admin: { max: 180, windowMs: 60_000 },
}

const categoryForPath = (path: string): Exclude<RateLimitCategory, 'login_failure'> | undefined => {
  if (path.startsWith('/api/v1/admin')) return 'admin'
  if (path.startsWith('/api/v1/auth')) return 'auth_verification'
  if (path.startsWith('/api/v1/public')) return 'public'
  if (path.startsWith('/api/v1/me') || path.startsWith('/api/v1/files') || path.startsWith('/api/v1/resources')) return 'authenticated'
  return undefined
}

export const createRateLimitMiddleware = (limiter: RateLimiter, policies: Record<RateLimitCategory, RateLimitPolicy>): RequestHandler => (request, response, next) => {
  const category = categoryForPath(request.path)
  if (!category) { next(); return }
  const session = typeof request.cookies?.panshi_session === 'string' ? request.cookies.panshi_session as string : ''
  const actor = category === 'authenticated' || category === 'admin'
    ? `session:${hashRateLimitIdentifier(session || `ip:${request.ip ?? 'unknown'}`)}`
    : `ip:${request.ip ?? 'unknown'}`
  const result = limiter.consume(category, actor, policies[category])
  if (!result.allowed) {
    response.setHeader('Retry-After', String(result.retryAfterSeconds))
    next(new HttpError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试'))
    return
  }
  next()
}

export const loginRateLimitActor = (ip: string | undefined, normalizedAccount: string) => (
  `ip:${ip ?? 'unknown'}|account:${hashRateLimitIdentifier(normalizedAccount)}`
)
