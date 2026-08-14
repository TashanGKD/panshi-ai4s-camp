import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContentModuleKey, ContentValidationDetails, JsonObject, JsonValue } from '@panshi/contracts'
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

const sameJson = (left: JsonValue, right: JsonValue): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameJson(item, right[index]!))
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  const leftObject = left as JsonObject
  const rightObject = right as JsonObject
  const leftKeys = Object.keys(leftObject)
  const rightKeys = Object.keys(rightObject)
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightObject, key) && sameJson(leftObject[key]!, rightObject[key]!))
}

type DraftResponse = Awaited<ReturnType<AdminClient['getDraft']>>
type HistoryResponse = Awaited<ReturnType<AdminClient['getHistory']>>
type Message = { kind: 'status' | 'error', text: string }

export function ContentPage({ moduleKey, client, publicWebBaseUrl }: { moduleKey: ContentModuleKey, client: AdminClient, publicWebBaseUrl: string }) {
  const [draft, setDraft] = useState<DraftResponse>()
  const [history, setHistory] = useState<HistoryResponse>()
  const [payload, setPayload] = useState<JsonObject>({})
  const [baseline, setBaseline] = useState<JsonObject>({})
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState<Message>()
  const [pending, setPending] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const generationRef = useRef(0)
  const activeRef = useRef(false)
  const operationRef = useRef({ locked: false, id: 0 })
  const moduleKeyRef = useRef(moduleKey)
  moduleKeyRef.current = moduleKey
  const Form = useMemo(() => forms[moduleKey], [moduleKey])
  const isDirty = !sameJson(payload, baseline)

  const isCurrent = (key: ContentModuleKey, generation: number) => (
    activeRef.current && moduleKeyRef.current === key && generationRef.current === generation
  )

  const applyLoaded = (nextDraft: DraftResponse, nextHistory: HistoryResponse) => {
    setDraft(nextDraft)
    setPayload(nextDraft.data.payload)
    setBaseline(nextDraft.data.payload)
    setHistory(nextHistory)
    setFieldErrors({})
  }

  const load = async (key: ContentModuleKey, generation: number) => {
    const [nextDraft, nextHistory] = await Promise.all([client.getDraft(key), client.getHistory(key)])
    if (!isCurrent(key, generation)) return false
    applyLoaded(nextDraft, nextHistory)
    return true
  }

  useEffect(() => {
    activeRef.current = true
    const generation = generationRef.current + 1
    generationRef.current = generation
    operationRef.current = { locked: false, id: operationRef.current.id + 1 }
    setPending(false)
    setDraft(undefined)
    setHistory(undefined)
    setLoadFailed(false)
    setMessage(undefined)
    setFieldErrors({})
    void load(moduleKey, generation).catch(() => {
      if (isCurrent(moduleKey, generation)) setLoadFailed(true)
    })
    return () => {
      activeRef.current = false
      generationRef.current += 1
      operationRef.current = { locked: false, id: operationRef.current.id + 1 }
    }
  }, [client, moduleKey])

  const report = (error: unknown) => {
    if (error instanceof AdminApiError && error.status === 409) {
      setMessage({ kind: 'error', text: '内容已被其他管理员修改，请刷新页面后再编辑。' }); return
    }
    if (error instanceof AdminApiError && error.status === 422) {
      setFieldErrors(validationMap(error.details)); setMessage({ kind: 'error', text: '发布前请修正标出的字段。' }); return
    }
    setMessage({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请重试。' })
  }

  const run = async (operation: (context: { key: ContentModuleKey, generation: number }) => Promise<void>) => {
    if (operationRef.current.locked) return
    const operationId = operationRef.current.id + 1
    operationRef.current = { locked: true, id: operationId }
    const key = moduleKey
    const generation = generationRef.current
    setPending(true)
    setMessage(undefined)
    setFieldErrors({})
    try {
      await operation({ key, generation })
    } catch (error) {
      if (isCurrent(key, generation)) report(error)
    } finally {
      if (operationRef.current.id === operationId) {
        operationRef.current = { locked: false, id: operationId }
        if (isCurrent(key, generation)) setPending(false)
      }
    }
  }

  if (loadFailed) return <section className="page-section"><p role="alert">内容模块暂时无法加载</p></section>
  if (!draft || !history) return <section className="page-section"><p role="status">正在加载{moduleTitles[moduleKey]}</p></section>

  const save = () => run(async ({ key, generation }) => {
    const cleanPayload = sanitizeContentPayload(key, payload)
    const saved = await client.saveDraft(key, cleanPayload, draft.data.revision)
    if (!isCurrent(key, generation)) return
    setDraft(saved)
    setPayload(saved.data.payload)
    setBaseline(saved.data.payload)
    setMessage({ kind: 'status', text: '草稿已保存。' })
  })

  const publish = () => run(async ({ key, generation }) => {
    await client.publish(key, draft.data.revision)
    if (!await load(key, generation) || !isCurrent(key, generation)) return
    setMessage({ kind: 'status', text: '内容已发布。' })
  })

  const rollback = (version: number) => run(async ({ key, generation }) => {
    await client.rollback(key, version)
    if (!await load(key, generation) || !isCurrent(key, generation)) return
    setMessage({ kind: 'status', text: `已回退到版本 ${version}。` })
  })

  return <section className="page-section"><div className="page-heading"><div><p>网站内容</p><h1>{moduleTitles[moduleKey]}</h1></div><div className="revision-badges"><span>草稿修订 {draft.data.revision}</span><span>已发布版本 {draft.data.publishedVersion ?? '—'}</span></div></div>
    {message ? <p role={message.kind === 'error' ? 'alert' : 'status'} className={`operation-message ${message.kind}`}>{message.text}</p> : null}
    <div className="content-tools"><section className="content-editor structured-editor"><Form value={payload} errors={fieldErrors} onChange={setPayload} /><div className="content-editor__actions">
      <button type="button" disabled={pending} onClick={() => { void save() }}>保存草稿</button>
      <button type="button" className="button-secondary" disabled={pending || isDirty} onClick={() => window.open(`${publicWebBaseUrl}/preview/${moduleKey}`, '_blank', 'noopener,noreferrer')}>预览草稿</button>
      <button type="button" disabled={pending || isDirty} onClick={() => { void publish() }}>发布当前草稿</button>
      {isDirty ? <span className="dirty-hint" role="status">请先保存草稿</span> : null}
    </div></section><VersionHistory busy={pending || isDirty} publishedVersion={history.data.publishedVersion} versions={history.data.versions} onRollback={(version) => { void rollback(version) }} /></div>
  </section>
}

export function ResourcesPlaceholderPage() {
  return <section className="page-section"><div className="page-heading"><div><p>网站内容</p><h1>相关资料</h1></div></div><article className="panel empty-panel"><h2>资料管理将在 Task 15 建设</h2><p>当前尚未提供资料创建、上传或公开范围管理接口。本页不会保存虚构资料。</p></article></section>
}
