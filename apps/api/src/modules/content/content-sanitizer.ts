import sanitizeHtml from 'sanitize-html'
import type { ContentModuleKey, JsonObject, JsonValue } from '@panshi/contracts'

export const sanitizeContentHtml = (value: string) => sanitizeHtml(value, {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
})

const record = (value: JsonValue | undefined): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonObject : {}

export const sanitizeContentPayload = (key: ContentModuleKey, payload: JsonObject): JsonObject => {
  if (key === 'basic' && Array.isArray(payload.intro)) {
    return { ...payload, intro: payload.intro.map((item) => typeof item === 'string' ? sanitizeContentHtml(item) : item) }
  }
  if (key === 'features' && Array.isArray(payload.items)) {
    return { ...payload, items: payload.items.map((item) => {
      const entry = record(item)
      return typeof entry.description === 'string' ? { ...entry, description: sanitizeContentHtml(entry.description) } : entry
    }) }
  }
  if (key === 'travel' && Array.isArray(payload.sections)) {
    return { ...payload, sections: payload.sections.map((item) => {
      const entry = record(item)
      return typeof entry.body === 'string' ? { ...entry, body: sanitizeContentHtml(entry.body) } : entry
    }) }
  }
  return payload
}
