import { useEffect, useMemo, useState } from 'react'
import type { ContentModuleKey, ContentValidationDetails, JsonObject } from '@panshi/contracts'
import type { AdminClient } from '../../api/admin-client'
import { AdminApiError } from '../../api/admin-client'
import { VersionHistory } from '../../features/content/VersionHistory'
import { sanitizeContentPayload, type FieldErrors } from '../../features/forms/form-utils'
import { BasicForm, ContactsForm, DisplayForm, FeaturesForm, ImportantDatesForm, OrganizationsForm, ScheduleForm, TravelForm } from './ContentForms'

const moduleTitles: Record<ContentModuleKey, string> = {
  basic: '基本信息', features: '实训特色', organizations: '组织单位', importantDates: '重要日期',
  schedule: '实训日程与师资', contacts: '联系方式', travel: '住宿交通', display: '展示设置',
}
const forms = { basic: BasicForm, features: FeaturesForm, organizations: OrganizationsForm, importantDates: ImportantDatesForm, schedule: ScheduleForm, contacts: ContactsForm, travel: TravelForm, display: DisplayForm }

const validationMap = (details?: ContentValidationDetails): FieldErrors => {
  const entries: [string, string][] = []
  for (const field of details?.fields ?? []) {
    entries.push([field.path, field.message])
    const parent = field.path.match(/^(.*\.speakerIds)\.\d+$/u)?.[1]
    if (parent) entries.push([parent, field.message])
  }
  return Object.fromEntries(entries)
}

export function ContentPage({ moduleKey, client, publicWebBaseUrl }: { moduleKey: ContentModuleKey, client: AdminClient, publicWebBaseUrl: string }) {
  const [draft, setDraft] = useState<Awaited<ReturnType<AdminClient['getDraft']>>>()
  const [history, setHistory] = useState<Awaited<ReturnType<AdminClient['getHistory']>>>()
  const [payload, setPayload] = useState<JsonObject>({})
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState<{ kind: 'status' | 'error', text: string }>()
  const [pending, setPending] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const Form = useMemo(() => forms[moduleKey], [moduleKey])

  const refresh = async () => {
    const [nextDraft, nextHistory] = await Promise.all([client.getDraft(moduleKey), client.getHistory(moduleKey)])
    setDraft(nextDraft); setPayload(nextDraft.data.payload); setHistory(nextHistory); setFieldErrors({}); setMessage(undefined)
  }
  useEffect(() => { setDraft(undefined); setHistory(undefined); setLoadFailed(false); void refresh().catch(() => setLoadFailed(true)) }, [client, moduleKey])

  const report = (error: unknown) => {
    if (error instanceof AdminApiError && error.status === 409) {
      setMessage({ kind: 'error', text: '内容已被其他管理员修改，请刷新页面后再编辑。' }); return
    }
    if (error instanceof AdminApiError && error.status === 422) {
      setFieldErrors(validationMap(error.details)); setMessage({ kind: 'error', text: '发布前请修正标出的字段。' }); return
    }
    setMessage({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请重试。' })
  }
  const run = async (operation: () => Promise<void>) => {
    if (pending) return
    setPending(true); setMessage(undefined); setFieldErrors({})
    try { await operation() } catch (error) { report(error) } finally { setPending(false) }
  }

  if (loadFailed) return <section className="page-section"><p role="alert">内容模块暂时无法加载</p></section>
  if (!draft || !history) return <section className="page-section"><p role="status">正在加载{moduleTitles[moduleKey]}</p></section>
  return <section className="page-section"><div className="page-heading"><div><p>网站内容</p><h1>{moduleTitles[moduleKey]}</h1></div><div className="revision-badges"><span>草稿修订 {draft.data.revision}</span><span>已发布版本 {draft.data.publishedVersion ?? '—'}</span></div></div>
    {message ? <p role={message.kind === 'error' ? 'alert' : 'status'} className={`operation-message ${message.kind}`}>{message.text}</p> : null}
    <div className="content-tools"><section className="content-editor structured-editor"><Form value={payload} errors={fieldErrors} onChange={setPayload} /><div className="content-editor__actions">
      <button type="button" disabled={pending} onClick={() => { void run(async () => { const cleanPayload = sanitizeContentPayload(moduleKey, payload); const saved = await client.saveDraft(moduleKey, cleanPayload, draft.data.revision); setDraft(saved); setPayload(saved.data.payload); setMessage({ kind: 'status', text: '草稿已保存。' }) }) }}>保存草稿</button>
      <button type="button" className="button-secondary" disabled={pending} onClick={() => window.open(`${publicWebBaseUrl}/preview/${moduleKey}`, '_blank', 'noopener,noreferrer')}>预览草稿</button>
      <button type="button" disabled={pending} onClick={() => { void run(async () => { await client.publish(moduleKey, draft.data.revision); await refresh(); setMessage({ kind: 'status', text: '内容已发布。' }) }) }}>发布当前草稿</button>
    </div></section><VersionHistory publishedVersion={history.data.publishedVersion} versions={history.data.versions} onRollback={async (version) => { await client.rollback(moduleKey, version); await refresh() }} /></div>
  </section>
}

export function ResourcesPlaceholderPage() {
  return <section className="page-section"><div className="page-heading"><div><p>网站内容</p><h1>相关资料</h1></div></div><article className="panel empty-panel"><h2>资料管理将在 Task 15 建设</h2><p>当前尚未提供资料创建、上传或公开范围管理接口。本页不会保存虚构资料。</p></article></section>
}
