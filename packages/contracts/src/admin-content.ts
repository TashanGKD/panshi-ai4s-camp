import { z } from 'zod'
import { ContentModuleKeySchema } from './content.js'
import { JsonObjectSchema } from './common.js'

const RevisionSchema = z.number().int().nonnegative()
const VersionSchema = z.number().int().positive()
const IsoTimestampSchema = z.string().datetime({ offset: true })

export const ContentSaveDraftRequestSchema = z.object({
  expectedRevision: RevisionSchema,
  payload: JsonObjectSchema,
}).strict()

export const ContentPublishRequestSchema = z.object({
  expectedRevision: RevisionSchema,
}).strict()

export const ContentRollbackRequestSchema = z.object({
  version: VersionSchema,
}).strict()

export const ContentValidationFieldSchema = z.object({
  path: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
}).strip()

export const ContentValidationDetailsSchema = z.object({
  fields: z.array(ContentValidationFieldSchema).min(1),
}).strip()

const ContentDraftDataSchema = z.object({
  key: ContentModuleKeySchema,
  revision: RevisionSchema,
  payload: JsonObjectSchema,
  publishedVersion: VersionSchema.nullable(),
}).strip()

export const AdminContentDraftResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: ContentDraftDataSchema,
}).strip()

export const AdminContentPreviewResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: ContentDraftDataSchema.omit({ publishedVersion: true }),
}).strip()

export const ContentVersionSchema = z.object({
  version: VersionSchema,
  payload: JsonObjectSchema,
  createdBy: z.string().min(1),
  createdAt: IsoTimestampSchema,
}).strip()

export const AdminContentHistoryResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    key: ContentModuleKeySchema,
    publishedVersion: VersionSchema.nullable(),
    versions: z.array(ContentVersionSchema),
  }).strip(),
}).strip()

export const ContentPublishResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    key: ContentModuleKeySchema,
    version: VersionSchema,
    revision: RevisionSchema,
    sourceVersion: VersionSchema.optional(),
  }).strip(),
}).strip()

export type ContentSaveDraftRequest = z.infer<typeof ContentSaveDraftRequestSchema>
export type ContentPublishRequest = z.infer<typeof ContentPublishRequestSchema>
export type ContentRollbackRequest = z.infer<typeof ContentRollbackRequestSchema>
export type ContentValidationDetails = z.infer<typeof ContentValidationDetailsSchema>
export type AdminContentDraftResponse = z.infer<typeof AdminContentDraftResponseSchema>
export type AdminContentPreviewResponse = z.infer<typeof AdminContentPreviewResponseSchema>
export type AdminContentHistoryResponse = z.infer<typeof AdminContentHistoryResponseSchema>
export type ContentPublishResponse = z.infer<typeof ContentPublishResponseSchema>
