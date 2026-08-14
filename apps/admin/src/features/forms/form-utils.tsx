import { useEffect, useId, useRef } from 'react'
import sanitizeHtml from 'sanitize-html'
import type { ContentModuleKey, JsonObject } from '@panshi/contracts'

export type FieldErrors = Readonly<Record<string, string>>

export const sanitizeRichText = (value: string) => sanitizeHtml(value, {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
})

const record = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonObject : {}

export const sanitizeContentPayload = (key: ContentModuleKey, payload: JsonObject): JsonObject => {
  if (key === 'basic') {
    if (!Array.isArray(payload.intro)) return payload
    return { ...payload, intro: payload.intro.map((item) => typeof item === 'string' ? sanitizeRichText(item) : item) }
  }
  if (key === 'features') {
    if (!Array.isArray(payload.items)) return payload
    return { ...payload, items: payload.items.map((item) => {
      const entry = record(item)
      return typeof entry.description === 'string' ? { ...entry, description: sanitizeRichText(entry.description) } : entry
    }) }
  }
  if (key === 'travel') {
    if (!Array.isArray(payload.sections)) return payload
    return { ...payload, sections: payload.sections.map((item) => {
      const entry = record(item)
      return typeof entry.body === 'string' ? { ...entry, body: sanitizeRichText(entry.body) } : entry
    }) }
  }
  return payload
}

export const fieldErrorId = (path: string) => `field-error-${path.replace(/[^a-zA-Z0-9_-]/gu, '-')}`

export function FieldError({ path, errors }: { path: string, errors: FieldErrors }) {
  const message = errors[path]
  return message ? <p className="field-error" role="alert" id={fieldErrorId(path)}>{message}</p> : null
}

export const errorDescription = (path: string, errors: FieldErrors) => errors[path] ? fieldErrorId(path) : undefined

export function RichTextField({ label, path, value, errors, onChange }: {
  label: string
  path: string
  value: string
  errors: FieldErrors
  onChange: (value: string) => void
}) {
  const id = useId()
  const editor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value) editor.current.innerHTML = value
  }, [value])
  return <div className="form-field">
    <label id={`${id}-label`}>{label}</label>
    <div
      ref={editor}
      className="rich-text-input"
      role="textbox"
      aria-labelledby={`${id}-label`}
      aria-describedby={errorDescription(path, errors)}
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      onInput={(event) => onChange(sanitizeRichText(event.currentTarget.innerHTML))}
    />
    <small>支持段落、加粗、斜体、列表和安全链接。</small>
    <FieldError path={path} errors={errors} />
  </div>
}

export function TextField({ label, path, value, errors, type = 'text', onChange }: {
  label: string
  path: string
  value: string
  errors: FieldErrors
  type?: 'text' | 'date' | 'time' | 'email' | 'tel'
  onChange: (value: string) => void
}) {
  const id = useId()
  return <div className="form-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type={type} value={value} aria-describedby={errorDescription(path, errors)} onChange={(event) => onChange(event.target.value)} />
    <FieldError path={path} errors={errors} />
  </div>
}

export const moveItem = <T,>(items: readonly T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction
  if (target < 0 || target >= items.length) return [...items]
  const next = [...items]
  const current = next[index]!
  next[index] = next[target]!
  next[target] = current
  return next
}

export function CollectionActions({ label, index, length, onMove, onDelete }: {
  label: string
  index: number
  length: number
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}) {
  return <div className="collection-actions">
    <button type="button" className="button-secondary" disabled={index === 0} aria-label={`上移“${label}”`} onClick={() => onMove(-1)}>上移</button>
    <button type="button" className="button-secondary" disabled={index === length - 1} aria-label={`下移“${label}”`} onClick={() => onMove(1)}>下移</button>
    <button type="button" className="button-danger" aria-label={`删除${label === '' ? '项目' : label}`} onClick={onDelete}>删除</button>
  </div>
}
