import { useEffect, useState } from 'react'
import { PublicContentPayloadSchemas, type AdminContentPreviewResponse, type ContentModuleKey, type JsonObject, type PublicSiteResponse } from '@panshi/contracts'
import { getDraftPreview, PreviewAccessError } from '../api/public-client'
import { PublicShell } from '../app/PublicShell'
import { ContentModuleRenderer } from '../renderers/ContentModuleRenderer'

type PreviewClient = { getDraftPreview: (key: ContentModuleKey) => Promise<AdminContentPreviewResponse> }
type State = { status: 'loading' } | { status: 'unauthorized' | 'forbidden' | 'error' } | { status: 'ready', preview: AdminContentPreviewResponse }

export function PreviewPage({ site, moduleKey, client = { getDraftPreview } }: {
  site: PublicSiteResponse['data']
  moduleKey: ContentModuleKey
  client?: PreviewClient
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    let active = true
    void client.getDraftPreview(moduleKey).then(
      (preview) => { if (active) setState({ status: 'ready', preview }) },
      (error: unknown) => {
        if (!active) return
        if (error instanceof PreviewAccessError) setState({ status: error.status === 401 ? 'unauthorized' : 'forbidden' })
        else setState({ status: 'error' })
      },
    )
    return () => { active = false }
  }, [client, moduleKey])

  if (state.status !== 'ready') return <main className="event-container public-state">
    {state.status === 'loading' ? <p role="status">正在加载草稿预览</p> : null}
    {state.status === 'unauthorized' ? <p role="alert">请先登录管理后台后再预览草稿</p> : null}
    {state.status === 'forbidden' ? <p role="alert">无权预览该草稿</p> : null}
    {state.status === 'error' ? <p role="alert">草稿预览暂时无法加载</p> : null}
  </main>

  const payload = state.preview.data.payload
  const parsedPayload = PublicContentPayloadSchemas[moduleKey].safeParse(payload)
  if (!parsedPayload.success) return <main className="event-container public-state">
    <p role="alert">草稿内容格式不完整，暂时无法预览</p>
  </main>
  const renderablePayload = parsedPayload.data as JsonObject
  const previewSite = {
    ...site,
    ...(moduleKey === 'basic' ? { basic: PublicContentPayloadSchemas.basic.parse(renderablePayload) } : {}),
    ...(moduleKey === 'importantDates' ? { importantDates: PublicContentPayloadSchemas.importantDates.parse(renderablePayload) } : {}),
    ...(moduleKey === 'contacts' ? { contacts: PublicContentPayloadSchemas.contacts.parse(renderablePayload) } : {}),
    ...(moduleKey === 'display' ? { display: PublicContentPayloadSchemas.display.parse(renderablePayload) } : {}),
  }
  return <PublicShell site={previewSite}><div className="preview-banner" role="status">草稿预览 · 修订 {state.preview.data.revision}</div>
    <ContentModuleRenderer moduleKey={moduleKey} payload={renderablePayload} />
  </PublicShell>
}
