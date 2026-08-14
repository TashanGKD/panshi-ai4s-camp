import { useEffect, useState } from 'react'
import type { AdminContentDraftResponse, JsonObject } from '@panshi/contracts'

export function ContentEditor({ draft, publicWebBaseUrl, onSave, onPublish }: {
  draft: AdminContentDraftResponse
  publicWebBaseUrl: string
  onSave: (payload: JsonObject, expectedRevision: number) => Promise<void>
  onPublish: (expectedRevision: number) => Promise<void>
}) {
  const [value, setValue] = useState(() => JSON.stringify(draft.data.payload, null, 2))
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  useEffect(() => setValue(JSON.stringify(draft.data.payload, null, 2)), [draft])

  const run = async (operation: () => Promise<void>) => {
    setPending(true)
    setError(undefined)
    try { await operation() } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败')
    } finally { setPending(false) }
  }

  const save = () => run(async () => {
    let payload: unknown
    try { payload = JSON.parse(value) } catch { setError('请输入有效的 JSON'); return }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      setError('内容 JSON 必须是对象')
      return
    }
    await onSave(payload as JsonObject, draft.data.revision)
  })

  const previewUrl = `${publicWebBaseUrl}/preview/${draft.data.key}`

  return <section className="content-editor" aria-labelledby="content-editor-title">
    <header><div><p>草稿修订 {draft.data.revision}</p><h2 id="content-editor-title">内容编辑</h2></div>
      <span>已发布版本 {draft.data.publishedVersion ?? '—'}</span></header>
    <label htmlFor="content-json">内容 JSON</label>
    <textarea id="content-json" value={value} onChange={(event) => setValue(event.target.value)} rows={18} spellCheck={false} />
    {error ? <p role="alert">{error}</p> : null}
    <div className="content-editor__actions">
      <button type="button" disabled={pending} onClick={() => { void save() }}>保存草稿</button>
      <button type="button" disabled={pending} onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}>预览草稿</button>
      <button type="button" disabled={pending} onClick={() => { void run(() => onPublish(draft.data.revision)) }}>发布当前草稿</button>
    </div>
  </section>
}
