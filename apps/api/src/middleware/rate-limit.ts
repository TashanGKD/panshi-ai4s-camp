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
  private nextSweepAt: number
  constructor(private readonly options: { now?: () => number, maxBuckets?: number, sweepIntervalMs?: number } = {}) {
    this.nextSweepAt = this.now() + this.sweepIntervalMs
  }
  private get now() { return this.options.now ?? Date.now }
  private get maxBuckets() { return this.options.maxBuckets ?? 50_000 }
  private get sweepIntervalMs() { return this.options.sweepIntervalMs ?? 60_000 }
  private sweepExpired(currentTime: number) {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= currentTime) this.buckets.delete(key)
    this.nextSweepAt = currentTime + this.sweepIntervalMs
  }
  get size() { return this.buckets.size }
  get(key: string) {
    const currentTime = this.now()
    if (currentTime >= this.nextSweepAt) this.sweepExpired(currentTime)
    const value = this.buckets.get(key)
    if (value) { this.buckets.delete(key); this.buckets.set(key, value) }
    return value
  }
  set(key: string, value: Bucket) {
    const currentTime = this.now()
    if (currentTime >= this.nextSweepAt || (!this.buckets.has(key) && this.buckets.size >= this.maxBuckets)) this.sweepExpired(currentTime)
    if (this.buckets.has(key)) this.buckets.delete(key)
    while (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.buckets.delete(oldest)
    }
    this.buckets.set(key, value)
  }
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
  if (path.startsWith('/api/v1/confirmations')) return 'authenticated'
  if (path.startsWith('/api/v1/public')) return 'public'
  if (path.startsWith('/api/v1/me') || path.startsWith('/api/v1/files') || path.startsWith('/api/v1/resources')) return 'authenticated'
  return undefined
}

export const createRateLimitMiddleware = (limiter: RateLimiter, policies: Record<RateLimitCategory, RateLimitPolicy>): RequestHandler => (request, response, next) => {
  const category = categoryForPath(request.path)
  if (!category) { next(); return }
  const cookieSession = typeof request.cookies?.panshi_session === 'string' ? request.cookies.panshi_session as string : ''
  const bearerSession = /^Bearer ([a-f0-9]{64})$/u.exec(request.get('Authorization') ?? '')?.[1] ?? ''
  const session = cookieSession || bearerSession
  const actor = category === 'authenticated' || category === 'admin'
    ? `session:${hashRateLimitIdentifier(session || `ip:${request.ip ?? 'unknown'}`)}`
    : `ip:${request.ip ?? 'unknown'}`
  const result = limiter.consume(category, actor, policies[category])
  if (!result.allowed) {
    response.setHeader('Retry-After', String(result.retryAfterSeconds))
    response.setHeader('Cache-Control', 'no-store')
    next(new HttpError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试'))
    return
  }
  next()
}

export const loginRateLimitActor = (ip: string | undefined, normalizedAccount: string) => (
  `ip:${ip ?? 'unknown'}|account:${hashRateLimitIdentifier(normalizedAccount)}`
)
