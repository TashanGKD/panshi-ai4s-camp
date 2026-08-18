import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { AdminApplicationDetail, AdminClient } from '../api/admin-client'
import type { RegistrationDynamicQuestion } from '@panshi/contracts'

const nextStatuses: Record<string, string[]> = {
  submitted: ['reviewing'],
  reviewing: ['needs_supplement', 'admitted', 'waitlisted', 'rejected'],
  needs_supplement: ['reviewing'],
}

type ScopedError = { id: string, message: string }
type PendingOperation = { id: string, token: number }
type LoadingRequest = { id: string, generation: number }

const profileLabels: Record<string, string> = {
  name: '姓名', email: '电子邮箱', organization: '学校／单位', department: '院系／培养单位', identityType: '当前身份',
  major: '专业', researchInterest: '研究兴趣', researchDirection: '研究方向', postdocStation: '博士后流动站／工作站',
  disciplineField: '一级学科或专业领域', supervisor: '合作导师', jobPosition: '职务／岗位',
  professionalTitleLevel: '专业技术职称等级', specificTitle: '具体职称', identityDescription: '身份说明',
}

const answerText = (question: RegistrationDynamicQuestion | undefined, value: unknown) => {
  if (!question) return typeof value === 'string' ? value : JSON.stringify(value)
  if (question.type === 'single_choice' || question.type === 'multiple_choice') {
    const values = Array.isArray(value) ? value : [value]
    const labels = new Map(question.options.map((option) => [option.value, option.label]))
    return values.map((item) => labels.get(String(item)) ?? String(item)).join('、')
  }
  if (question.type === 'proficiency_matrix' && typeof value === 'object' && value !== null && 'ratings' in value) {
    const matrix = value as { ratings?: Record<string, string>, otherLabel?: string, otherLevel?: string }
    const items = new Map(question.items.map((item) => [item.value, item.label]))
    const levels = new Map(question.levels.map((level) => [level.value, level.label]))
    const rows = Object.entries(matrix.ratings ?? {}).map(([item, level]) => `${items.get(item) ?? item}：${levels.get(level) ?? level}`)
    if (matrix.otherLabel) rows.push(matrix.otherLevel ? `${matrix.otherLabel}：${levels.get(matrix.otherLevel) ?? matrix.otherLevel}` : matrix.otherLabel)
    return rows.join('；')
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function ApplicationReviewPage({ client }: { client: AdminClient }) {
  const { id = '' } = useParams()
  const routeIdRef = useRef(id)
  const loadGenerationRef = useRef(0)
  const operationTokenRef = useRef(0)
  routeIdRef.current = id

  const [detail, setDetail] = useState<AdminApplicationDetail | null>(null)
  const [error, setError] = useState<ScopedError | null>(null)
  const [loadingRequest, setLoadingRequest] = useState<LoadingRequest | null>(null)
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null)
  const [reloadGeneration, setReloadGeneration] = useState(0)
  const [target, setTarget] = useState('')
  const [publicMessage, setPublicMessage] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [deadline, setDeadline] = useState('')
  const [fields, setFields] = useState<Set<string>>(new Set())
  const [slots, setSlots] = useState<Set<string>>(new Set())

  useEffect(() => {
    const loadId = id
    const generation = ++loadGenerationRef.current
    const controller = new AbortController()
    ++operationTokenRef.current
    setLoadingRequest({ id: loadId, generation })
    setDetail(null)
    setError(null)
    setPendingOperation(null)
    setTarget('')
    setPublicMessage('')
    setInternalNote('')
    setDeadline('')
    setFields(new Set())
    setSlots(new Set())

    const isCurrent = () => loadGenerationRef.current === generation && routeIdRef.current === loadId
    void client.getApplication(loadId, controller.signal)
      .then((response) => {
        if (!isCurrent()) return
        if (response.data.application.id !== loadId) throw new Error('报名详情编号不匹配')
        setDetail(response.data)
        setInternalNote(response.data.application.internalReviewNote ?? '')
        setTarget(nextStatuses[response.data.application.status]?.[0] ?? '')
      })
      .catch((caught: unknown) => {
        if (!isCurrent() || controller.signal.aborted) return
        setError({ id: loadId, message: caught instanceof Error ? caught.message : '加载失败' })
      })
      .finally(() => {
        if (!isCurrent()) return
        setLoadingRequest(null)
      })

    return () => controller.abort()
  }, [client, id, reloadGeneration])

  const currentDetail = detail?.application.id === id ? detail : null
  const currentError = error?.id === id ? error.message : ''
  const loading = loadingRequest?.id === id
  const pending = pendingOperation?.id === id

  if (currentError) return <p role="alert">{currentError}</p>
  if (loading || !currentDetail) return <p role="status">正在加载报名详情</p>

  const app = currentDetail.application
  const latest = currentDetail.versions[0]?.snapshot as Record<string, unknown> | undefined
  const allowed = nextStatuses[app.status] ?? []
  const toggle = (set: Set<string>, value: string, update: (next: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    update(next)
  }

  const transition = async () => {
    const operationId = id
    const operationDetail = currentDetail
    if (operationDetail.application.id !== operationId || routeIdRef.current !== operationId) {
      setError({ id: operationId, message: '报名详情已变化，请重新加载后操作' })
      return
    }

    const loadGeneration = loadGenerationRef.current
    const operationToken = ++operationTokenRef.current
    const isCurrent = () => (
      operationTokenRef.current === operationToken
      && loadGenerationRef.current === loadGeneration
      && routeIdRef.current === operationId
    )
    setPendingOperation({ id: operationId, token: operationToken })
    setError(null)

    try {
      await client.transitionApplication(operationId, {
        expectedRevision: operationDetail.application.revision,
        targetStatus: target,
        publicMessage: target === 'needs_supplement' ? publicMessage : undefined,
        internalNote,
        supplementDeadline: deadline ? new Date(deadline).toISOString() : undefined,
        editableFieldIds: [...fields],
        editableAttachmentIds: [...slots],
      })
      if (!isCurrent()) return
      setReloadGeneration((value) => value + 1)
    } catch (caught) {
      if (!isCurrent()) return
      setError({ id: operationId, message: caught instanceof Error ? caught.message : '状态更新失败' })
    } finally {
      if (isCurrent()) setPendingOperation(null)
    }
  }

  return <section>
    <p><Link to="/applications">← 返回报名列表</Link></p>
    <h1>{app.name}的报名</h1>
    <dl><dt>状态</dt><dd>{app.status}</dd><dt>手机号</dt><dd>{app.phone}</dd><dt>单位</dt><dd>{app.organization}</dd><dt>身份与学历</dt><dd>{app.identityType} / {app.educationStage}</dd><dt>提交时间</dt><dd>{app.submittedAt ?? '—'}</dd></dl>
    <section><h2>固定资料</h2>{Object.entries((latest?.profile ?? app.coreFields) as Record<string, unknown>).filter(([key, value]) => key !== 'phone' && key !== 'educationStage' && key !== 'majorResearchDirection' && value !== '').map(([key, value]) => <p key={key}><strong>{profileLabels[key] ?? key}：</strong>{String(value)}</p>)}</section>
    <section><h2>报名答案（只读）</h2>{Object.entries((latest?.answers ?? app.answers) as Record<string, unknown>).map(([key, value]) => { const question = app.form.questions.find((item) => item.id === key); return <p key={key}><strong>{question?.label ?? key}：</strong>{answerText(question, value)}</p> })}</section>
    <section><h2>附件</h2>{currentDetail.attachments.length ? <ul>{currentDetail.attachments.map((file) => <li key={file.id}><a href={file.downloadUrl}>{file.originalName}</a>（{file.sizeBytes} 字节）</li>)}</ul> : <p>无附件</p>}</section>
    <section><h2>状态历史</h2><ol>{currentDetail.history.map((entry) => <li key={`${entry.createdAt}-${entry.toStatus}`}>{new Date(entry.createdAt).toLocaleString('zh-CN')}：{entry.fromStatus ?? '创建'} → {entry.toStatus}；操作者：{entry.changedBy ?? '系统'}{entry.reason ? `；公开说明：${entry.reason}` : ''}{entry.internalNote ? `；内部备注：${entry.internalNote}` : ''}</li>)}</ol></section>
    {allowed.length ? <section>
      <h2>审核操作</h2>
      <label>目标状态<select value={target} disabled={pending} onChange={(event) => setTarget(event.target.value)}><option value="">请选择</option>{allowed.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label>内部备注<textarea value={internalNote} disabled={pending} maxLength={2000} onChange={(event) => setInternalNote(event.target.value)} /></label>
      {target === 'needs_supplement' ? <div>
        <label>面向学员的说明<textarea required value={publicMessage} disabled={pending} maxLength={2000} onChange={(event) => setPublicMessage(event.target.value)} /></label>
        <label>补充截止时间<input type="datetime-local" value={deadline} disabled={pending} onChange={(event) => setDeadline(event.target.value)} /></label>
        <fieldset disabled={pending}><legend>允许修改的资料</legend>{['name', 'email', 'organization', 'department', 'identityType', 'major', 'researchInterest', 'researchDirection', 'postdocStation', 'disciplineField', 'supervisor', 'jobPosition', 'professionalTitleLevel', 'specificTitle', 'identityDescription', ...app.form.questions.filter((question) => question.active).map((question) => question.id)].map((key) => <label key={key}><input type="checkbox" checked={fields.has(key)} onChange={() => toggle(fields, key, setFields)} />{app.form.questions.find((question) => question.id === key)?.label ?? profileLabels[key] ?? key}</label>)}</fieldset>
        <fieldset disabled={pending}><legend>允许替换的附件</legend>{app.form.attachments.filter((slot) => slot.active).map((slot) => <label key={slot.id}><input type="checkbox" checked={slots.has(slot.id)} onChange={() => toggle(slots, slot.id, setSlots)} />{slot.label}</label>)}</fieldset>
      </div> : null}
      <button type="button" disabled={pending || !target} onClick={() => void transition()}>{pending ? '提交中' : '确认更新状态'}</button>
    </section> : <p>当前状态没有可执行的后续审核操作。</p>}
  </section>
}
