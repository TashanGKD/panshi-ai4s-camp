import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MyApplicationResponse } from '@panshi/contracts'
import { applicationClient, ApplicationApiError } from '../api/application-client'
import { ApplicationForm, type FormDraft } from '../features/registration/ApplicationForm'

type ReadyState = { application: MyApplicationResponse['data']['application'], draft: FormDraft }

const draftFrom = (application: MyApplicationResponse['data']['application']): FormDraft => {
  const profile = {
    name: application.profile.name, email: application.profile.email, organization: application.profile.organization,
    department: application.profile.department, identityType: application.profile.identityType,
    educationStage: application.profile.educationStage, majorResearchDirection: application.profile.majorResearchDirection,
  }
  return { profile, answers: application.answers, attachments: application.attachments.map((file) => ({ slotId: file.slotId, fileId: file.id })) }
}

const fieldErrors = (error: ApplicationApiError) => {
  const result: Record<string, string> = {}
  const fields = typeof error.details === 'object' && error.details !== null && 'fields' in error.details ? error.details.fields : undefined
  if (Array.isArray(fields)) for (const field of fields) if (typeof field === 'object' && field !== null && 'path' in field && 'message' in field && typeof field.path === 'string' && typeof field.message === 'string') result[field.path] = field.message
  return result
}

export function RegistrationPage() {
  const [state, setState] = useState<ReadyState | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'anonymous' | 'disabled' | 'error'>('loading')
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const generation = useRef(0)
  const operationLocked = useRef(false)
  const waitForOperation = async () => {
    while (operationLocked.current) await new Promise((resolve) => window.setTimeout(resolve, 25))
  }

  const load = useCallback(async () => {
    const current = ++generation.current
    try {
      const response = await applicationClient.getMine()
      if (generation.current !== current) return
      setState({ application: response.data.application, draft: draftFrom(response.data.application) }); setStatus('ready'); setDirty(false)
    } catch (caught) {
      if (generation.current !== current) return
      if (caught instanceof ApplicationApiError && caught.status === 401) setStatus('anonymous')
      else if (caught instanceof ApplicationApiError && caught.code === 'ACCOUNT_DISABLED') { await applicationClient.logout().catch(() => undefined); setStatus('disabled') }
      else setStatus('error')
    }
  }, [])
  useEffect(() => { void load(); return () => { generation.current += 1 } }, [load])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  const save = useCallback(async (draftOverride?: FormDraft) => {
    if (!state || operationLocked.current || state.application.locked) return null
    operationLocked.current = true
    const operation = ++generation.current; setPending(true); setMessage(''); setErrors({})
    try {
      const response = await applicationClient.saveDraft({ expectedRevision: state.application.revision, ...(draftOverride ?? state.draft) })
      if (generation.current !== operation) return null
      setState({ application: response.data.application, draft: draftFrom(response.data.application) }); setDirty(false); setMessage('草稿已保存')
      return response.data.application
    } catch (caught) {
      if (generation.current !== operation) return null
      if (caught instanceof ApplicationApiError) { setErrors(fieldErrors(caught)); setMessage(caught.message); if (caught.code === 'ACCOUNT_DISABLED') { await applicationClient.logout().catch(() => undefined); setStatus('disabled') } }
      else setMessage('保存失败，请稍后重试')
      return null
    } finally { operationLocked.current = false; if (generation.current === operation) setPending(false) }
  }, [pending, state])

  useEffect(() => {
    if (!dirty || pending || !state || state.application.locked) return
    const timer = window.setTimeout(() => { void save() }, 2_000)
    return () => window.clearTimeout(timer)
  }, [dirty, pending, save, state])

  if (status === 'loading') return <p role="status">正在加载报名信息</p>
  if (status === 'anonymous') return <section><h2>在线报名</h2><p>请先登录后填写报名信息。</p><p><Link to="/login">登录</Link> · <Link to="/register">注册账号</Link></p></section>
  if (status === 'disabled') return <p role="alert">账号已停用，当前会话已退出。如有疑问请联系工作人员。</p>
  if (status === 'error' || !state) return <p role="alert">报名信息暂时无法加载，请稍后重试。</p>

  const updateDraft = (draft: FormDraft) => { setState({ ...state, draft }); setDirty(true); setMessage('尚未保存') }
  const upload = async (slotId: string, file: File) => {
    await waitForOperation()
    operationLocked.current = true
    setPending(true); setMessage('正在上传附件')
    try {
      const uploaded = await applicationClient.upload(file, slotId)
      const next = { ...state.draft, attachments: [...state.draft.attachments.filter((item) => item.slotId !== slotId), { slotId, fileId: uploaded.data.file.id }] }
      operationLocked.current = false; setPending(false); await save(next)
    } catch (caught) { operationLocked.current = false; setPending(false); setMessage(caught instanceof Error ? caught.message : '附件上传失败') }
  }
  const remove = async (slotId: string, fileId: string) => {
    await waitForOperation()
    operationLocked.current = true
    setPending(true)
    try {
      await applicationClient.removeFile(fileId)
      const next = { ...state.draft, attachments: state.draft.attachments.filter((item) => item.slotId !== slotId) }
      operationLocked.current = false; setPending(false); await save(next)
    } catch (caught) { operationLocked.current = false; setPending(false); setMessage(caught instanceof Error ? caught.message : '附件删除失败') }
  }
  const submit = async () => {
    if (operationLocked.current || state.application.locked || !window.confirm('提交后报名信息将锁定，确认正式提交吗？')) return
    const saved = dirty ? await save() : state.application
    if (!saved) return
    operationLocked.current = true; setPending(true); setErrors({}); setMessage('')
    try { await applicationClient.submit(saved.revision); await load(); setMessage('报名已提交') }
    catch (caught) { if (caught instanceof ApplicationApiError) { setErrors(fieldErrors(caught)); setMessage(caught.message) } else setMessage('提交失败，请稍后重试') }
    finally { operationLocked.current = false; setPending(false) }
  }
  return <section><h2>在线报名</h2>{state.application.retiredAnswerIds.length > 0 ? <p role="status">报名表已更新，原问题答案已保留；请核对当前表单后提交。</p> : null}
    <ApplicationForm application={state.application} draft={state.draft} disabled={pending || state.application.locked} errors={errors} onChange={updateDraft} onUpload={(slot, file) => void upload(slot, file)} onRemove={(slot, file) => void remove(slot, file)} />
    <div className="application-actions"><button type="button" disabled={pending || !dirty || state.application.locked} onClick={() => void save()}>{pending ? '处理中' : '保存草稿'}</button><button type="button" disabled={pending || state.application.locked} onClick={() => void submit()}>正式提交</button></div>
    {message ? <p role={Object.keys(errors).length > 0 ? 'alert' : 'status'}>{message}</p> : null}
    {state.application.locked ? <p role="status">报名已提交，当前内容为只读。</p> : null}</section>
}
