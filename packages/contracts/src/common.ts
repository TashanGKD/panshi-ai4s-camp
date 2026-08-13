import { z } from 'zod'

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
})

export type JsonPrimitive = string | number | boolean | null
export type JsonObject = { readonly [key: string]: JsonValue }
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

const isJsonValue = (value: unknown, ancestors = new Set<object>()): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (typeof value !== 'object' || ancestors.has(value)) {
    return false
  }

  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length > 0) {
        return false
      }

      return value.every((item) => isJsonValue(item, ancestors))
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return false
    }

    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return false
    }

    return Object.values(descriptors).every((descriptor) => (
      descriptor.enumerable === true
      && 'value' in descriptor
      && isJsonValue(descriptor.value, ancestors)
    ))
  } catch {
    return false
  } finally {
    ancestors.delete(value)
  }
}

const isJsonObject = (value: unknown): value is JsonObject => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && isJsonValue(value)
)

export const JsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(isJsonValue, {
  message: 'Expected a JSON-safe value',
})

export const JsonObjectSchema: z.ZodType<JsonObject> = z.custom<JsonObject>(isJsonObject, {
  message: 'Expected a JSON-safe object',
})

export const PaginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})

export type ApiError = z.infer<typeof ApiErrorSchema>
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>
