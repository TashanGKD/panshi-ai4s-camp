import { pipeline } from 'node:stream/promises'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { HttpError } from '../../middleware/error-handler.js'
import { getSessionToken } from '../../middleware/require-user.js'
import { createRequireUser, type AuthenticatedLocals } from '../../middleware/require-user.js'
import { requireAdmin } from '../../middleware/require-admin.js'
import { AuthenticationError, type AuthenticatedSessionUser, type SessionService } from '../identity/session.service.js'
import { buildContentDisposition } from '../files/file-validation.js'
import { ResourceAccessError, ResourceRevisionConflictError, type ResourceService } from './resource.service.js'

const Id = z.string().uuid()
const resolveOptional = async (sessions: SessionService, cookies: unknown): Promise<AuthenticatedSessionUser | null> => {
  try { return await sessions.resolve(getSessionToken(cookies)) } catch (error) {
    if (error instanceof AuthenticationError && error.kind === 'unauthorized') return null
    throw error
  }
}
const mapError = (error: unknown) => error instanceof ResourceAccessError || error instanceof ResourceRevisionConflictError ? new HttpError(error.status, error.code, error.message) : error
const privateNoStore = (response: Response) => {
  response.setHeader('Cache-Control', 'private, no-store')
  const setHeader = response.setHeader.bind(response)
  response.setHeader = ((name: string, value: unknown) => name.toLowerCase() === 'etag' ? response : setHeader(name, value as string)) as typeof response.setHeader
  response.removeHeader('ETag')
}

export const createResourceRouter = (sessions: SessionService, service: ResourceService) => {
  const router = Router()
  router.get('/', async (request, response, next) => {
    try {
      const actor = await resolveOptional(sessions, request.cookies)
      if (actor) privateNoStore(response)
      const resources = await service.list(actor)
      response.setHeader('Cache-Control', actor ? 'private, no-store' : 'public, max-age=30, must-revalidate')
      response.json({ apiVersion: 'v1', data: { resources } })
    } catch (error) { next(mapError(error)) }
  })
  router.use('/:id/download', (_request, response, next) => {
    privateNoStore(response)
    next()
  })
  router.get('/:id/download', async (request, response, next) => {
    let stream: Awaited<ReturnType<ResourceService['open']>>['stream'] | undefined
    const abort = () => stream?.destroy(new Error('Download client disconnected'))
    try {
      const parsed = Id.safeParse(request.params.id)
      if (!parsed.success) throw new HttpError(400, 'RESOURCE_ID_INVALID', '资料标识无效')
      const actor = await resolveOptional(sessions, request.cookies)
      const opened = await service.open(parsed.data, actor)
      stream = opened.stream
      response.setHeader('Content-Type', opened.record.mimeType)
      response.setHeader('Content-Length', String(opened.record.sizeBytes))
      response.setHeader('Content-Disposition', buildContentDisposition(opened.record.originalName))
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Cache-Control', opened.isPublished && !opened.isAdminPreview && opened.anonymousPublic ? 'public, max-age=0, must-revalidate' : 'private, no-store')
      request.once('aborted', abort); response.once('close', abort)
      await pipeline(stream, response)
    } catch (error) {
      if (request.aborted || response.destroyed) return
      if (response.headersSent) { response.destroy(error instanceof Error ? error : undefined); return }
      next(mapError(error))
    } finally { request.off('aborted', abort); response.off('close', abort); stream?.destroy() }
  })
  return router
}

const ResourceInput = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/u),
  title: z.string().trim().min(1).max(200), description: z.string().trim().max(1000).nullable(),
  fileId: z.string().uuid(), accessScope: z.enum(['public', 'authenticated', 'admitted']),
  sortOrder: z.number().int().min(0).max(10000),
}).strict()
const ExpectedRevision = z.object({ expectedRevision: z.number().int().min(0) }).strict()
const ResourceMutationInput = ResourceInput.extend({ expectedRevision: z.number().int().min(0) }).strict()

export const createAdminResourceRouter = (sessions: SessionService, service: ResourceService) => {
  const router = Router()
  router.get('/:id/preview', async (request, response, next) => {
    let stream: Awaited<ReturnType<ResourceService['preview']>>['stream'] | undefined
    const abort = () => stream?.destroy(new Error('Preview client disconnected'))
    try {
      const id = Id.safeParse(request.params.id)
      if (!id.success) throw new HttpError(404, 'RESOURCE_NOT_AVAILABLE', '资料不存在或不可访问')
      privateNoStore(response)
      const actor = await resolveOptional(sessions, request.cookies)
      if (!actor || actor.role !== 'admin' || actor.disabledAt !== null) throw new ResourceAccessError(404, 'RESOURCE_NOT_AVAILABLE')
      const opened = await service.preview(id.data, actor)
      stream = opened.stream
      response.setHeader('Content-Type', opened.record.mimeType)
      response.setHeader('Content-Length', String(opened.record.sizeBytes))
      response.setHeader('Content-Disposition', buildContentDisposition(opened.record.originalName))
      response.setHeader('X-Content-Type-Options', 'nosniff')
      request.once('aborted', abort); response.once('close', abort)
      await pipeline(stream, response)
    } catch (error) {
      if (request.aborted || response.destroyed) return
      if (response.headersSent) { response.destroy(error instanceof Error ? error : undefined); return }
      next(mapError(error))
    } finally { request.off('aborted', abort); response.off('close', abort); stream?.destroy() }
  })
  router.use(createRequireUser(sessions), requireAdmin)
  router.get('/', async (_request, response, next) => { try { response.json({ apiVersion: 'v1', data: { resources: await service.listAdmin() } }) } catch (error) { next(mapError(error)) } })
  router.post('/', async (request, response, next) => {
    try {
      const parsed = ResourceMutationInput.safeParse(request.body)
      if (!parsed.success) throw new HttpError(422, 'RESOURCE_VALIDATION_FAILED', '资料配置无效')
      const actor = (response.locals as AuthenticatedLocals).authenticatedUser
      const { expectedRevision, ...input } = parsed.data
      response.status(201).json({ apiVersion: 'v1', data: { resource: await service.createDraft(input, expectedRevision, actor.id) } })
    } catch (error) { next(mapError(error)) }
  })
  router.put('/:id', async (request, response, next) => {
    try {
      const id = Id.safeParse(request.params.id); const input = ResourceMutationInput.safeParse(request.body)
      if (!id.success || !input.success) throw new HttpError(422, 'RESOURCE_VALIDATION_FAILED', '资料配置无效')
      const actor = (response.locals as AuthenticatedLocals).authenticatedUser
      const { expectedRevision, ...resourceInput } = input.data
      response.json({ apiVersion: 'v1', data: { resource: await service.updateDraft(id.data, resourceInput, expectedRevision, actor.id) } })
    } catch (error) { next(mapError(error)) }
  })
  router.post('/:id/:action', async (request, response, next) => {
    try {
      const id = Id.safeParse(request.params.id)
      const input = ExpectedRevision.safeParse(request.body)
      if (!id.success || !['publish', 'unpublish'].includes(request.params.action ?? '')) throw new HttpError(404, 'RESOURCE_NOT_AVAILABLE', '资料不存在或不可访问')
      if (!input.success) throw new HttpError(422, 'RESOURCE_VALIDATION_FAILED', '资料配置无效')
      const actor = (response.locals as AuthenticatedLocals).authenticatedUser
      response.json({ apiVersion: 'v1', data: { resource: await service.setPublished(id.data, request.params.action === 'publish', input.data.expectedRevision, actor.id) } })
    } catch (error) { next(mapError(error)) }
  })
  return router
}
