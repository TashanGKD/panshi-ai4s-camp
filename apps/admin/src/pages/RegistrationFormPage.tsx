import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_REGISTRATION_FORM,
  type RegistrationAttachment,
  type RegistrationDynamicQuestion,
  type RegistrationForm,
} from '@panshi/contracts'
import type { AdminClient } from '../api/admin-client'
import { AdminApiError } from '../api/admin-client'

let editorIdSeed = 0
const editorUuid = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  editorIdSeed += 1
  return `00000000-0000-4000-8000-${editorIdSeed.toString(16).padStart(12, '0')}`
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const reordered = <T extends { order: number }>(items: readonly T[]) => items.map((item, order) => ({ ...item, order }))

const newQuestion = (order: number): RegistrationDynamicQuestion => ({
  id: editorUuid(), type: 'short_text', label: '新问题', helpText: '', required: false, order, active: true, validation: {},
})

const newAttachment = (order: number): RegistrationAttachment => ({
  id: editorUuid(), label: '新附件', helpText: '', required: false, order, active: true, allowedExtensions: ['pdf', 'docx'], maxSizeBytes: 10 * 1024 * 1024,
})

const fieldError = (errors: readonly { path: string, message: string }[], path: string) => errors.find((error) => error.path === path)?.message

export function RegistrationFormPage({ client }: { client: AdminClient }) {
  const [draft, setDraft] = useState<Awaited<ReturnType<AdminClient['getRegistrationFormDraft']>>>()
  const [history, setHistory] = useState<Awaited<ReturnType<AdminClient['getRegistrationFormHistory']>>>()
  const [form, setForm] = useState<RegistrationForm>(() => copy(DEFAULT_REGISTRATION_FORM))
  const [baseline, setBaseline] = useState<RegistrationForm>(() => copy(DEFAULT_REGISTRATION_FORM))
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ kind: 'status' | 'error', text: string }>()
  const [errors, setErrors] = useState<readonly { path: string, message: string }[]>([])
  const generation = useRef(0)
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline])

  const load = async () => {
    const [nextDraft, nextHistory] = await Promise.all([client.getRegistrationFormDraft(), client.getRegistrationFormHistory()])
    setDraft(nextDraft); setHistory(nextHistory); setForm(copy(nextDraft.data.form)); setBaseline(copy(nextDraft.data.form)); setErrors([])
  }

  useEffect(() => {
    const current = ++generation.current
    void load().catch(() => { if (generation.current === current) setMessage({ kind: 'error', text: '报名表暂时无法加载' }) })
    return () => { generation.current += 1 }
  }, [client])

  const run = async (operation: () => Promise<void>) => {
    if (pending) return
    setPending(true); setMessage(undefined); setErrors([])
    try { await operation() } catch (error) {
      if (error instanceof AdminApiError && error.status === 409) setMessage({ kind: 'error', text: '报名表已被其他管理员修改，请刷新页面后重试。' })
      else if (error instanceof AdminApiError && error.status === 422) {
        setErrors(error.details?.fields ?? []); setMessage({ kind: 'error', text: '请修正标出的字段后再保存。' })
      } else setMessage({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请重试。' })
    } finally { setPending(false) }
  }

  const updateQuestion = (id: string, update: Partial<RegistrationDynamicQuestion>) => setForm((current) => ({
    ...current, questions: current.questions.map((question) => question.id === id ? { ...question, ...update } as RegistrationDynamicQuestion : question),
  }))
  const moveQuestion = (id: string, direction: -1 | 1) => setForm((current) => {
    const index = current.questions.findIndex((question) => question.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= current.questions.length) return current
    const questions = [...current.questions]; [questions[index], questions[target]] = [questions[target]!, questions[index]!]
    return { ...current, questions: reordered(questions) }
  })
  const updateAttachment = (id: string, update: Partial<RegistrationAttachment>) => setForm((current) => ({
    ...current, attachments: current.attachments.map((attachment) => attachment.id === id ? { ...attachment, ...update } : attachment),
  }))
  const moveAttachment = (id: string, direction: -1 | 1) => setForm((current) => {
    const index = current.attachments.findIndex((attachment) => attachment.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= current.attachments.length) return current
    const attachments = [...current.attachments]; [attachments[index], attachments[target]] = [attachments[target]!, attachments[index]!]
    return { ...current, attachments: reordered(attachments) }
  })

  const save = () => run(async () => {
    if (!draft) return
    const saved = await client.saveRegistrationFormDraft(form, draft.data.revision)
    setDraft(saved); setBaseline(copy(saved.data.form)); setForm(copy(saved.data.form)); setMessage({ kind: 'status', text: '报名表草稿已保存。' })
  })
  const publish = () => run(async () => {
    if (!draft || isDirty) { setMessage({ kind: 'error', text: '请先保存草稿，再发布报名表。' }); return }
    await client.publishRegistrationForm(draft.data.revision)
    await load(); setMessage({ kind: 'status', text: '报名表已发布。' })
  })

  if (!draft || !history) return <section className="page-section"><h1>报名管理</h1><p role="status">正在加载报名表配置</p></section>

  return <section className="page-section registration-form-page">
    <div className="page-heading"><div><p>报名管理</p><h1>表单配置</h1></div><div className="revision-badges"><span>草稿修订 {draft.data.revision}</span><span>已发布版本 {draft.data.baseVersion ?? '—'}</span></div></div>
    {message ? <p role={message.kind === 'error' ? 'alert' : 'status'} className={`operation-message ${message.kind}`}>{message.text}</p> : null}
    <div className="registration-form-tools">
      <section className="panel structured-form" aria-labelledby="fixed-fields-title">
        <h2 id="fixed-fields-title">固定字段</h2><p>核心身份字段由系统固定维护，手机号由登录账号带入且只读。</p>
        <ul>{form.coreFields.map((field) => <li key={field.key}><strong>{field.label}</strong><span>{field.key === 'phone' ? '只读' : '必填'}</span></li>)}</ul>
      </section>
      <section className="panel" aria-labelledby="preview-title"><h2 id="preview-title">预览</h2><p>固定身份信息</p><ul>{form.coreFields.map((field) => <li key={field.key}>{field.label}</li>)}</ul><p>动态问题与附件将在学员端按以下配置显示：</p>{form.questions.filter((question) => question.active).map((question) => <p key={question.id}>{question.label}{question.required ? '（必填）' : ''}</p>)}{form.attachments.filter((attachment) => attachment.active).map((attachment) => <p key={attachment.id}>{attachment.label}</p>)}</section>
    </div>
    <section className="panel registration-editor" aria-labelledby="questions-title"><div className="section-heading"><h2 id="questions-title">动态问题</h2><button type="button" disabled={pending} onClick={() => setForm((current) => ({ ...current, questions: [...current.questions, newQuestion(current.questions.length)] }))}>新增问题</button></div>
      {form.questions.length === 0 ? <p>尚未配置动态问题。</p> : form.questions.map((question, index) => <fieldset key={question.id} className="registration-editor-item"><legend>问题 {index + 1}</legend>
        <div className="form-grid"><label className="form-field">题目<input aria-label={`问题 ${index + 1} 题目`} id={`question-${question.id}-label`} value={question.label} onChange={(event) => updateQuestion(question.id, { label: event.target.value })} />{fieldError(errors, `questions.${index}.label`) ? <small className="field-error">{fieldError(errors, `questions.${index}.label`)}</small> : null}</label>
          <label className="form-field">类型<select aria-label={`问题 ${index + 1} 类型`} value={question.type} onChange={(event) => updateQuestion(question.id, event.target.value === 'short_text' || event.target.value === 'long_text' ? { type: event.target.value, options: undefined } : { type: event.target.value, validation: {}, options: [{ id: editorUuid(), value: 'option-1', label: '选项 1' }] } as Partial<RegistrationDynamicQuestion>)}><option value="short_text">单行文本</option><option value="long_text">多行文本</option><option value="single_choice">单选</option><option value="multiple_choice">多选</option></select></label></div>
        <label className="form-field">说明<textarea aria-label={`问题 ${index + 1} 说明`} value={question.helpText} onChange={(event) => updateQuestion(question.id, { helpText: event.target.value })} /></label>
        <label className="check-field"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />必填</label>
        <label className="check-field"><input type="checkbox" checked={question.active} onChange={(event) => updateQuestion(question.id, { active: event.target.checked })} />启用</label>
        {question.type === 'single_choice' || question.type === 'multiple_choice' ? <div className="choice-options"><strong>选项</strong>{question.options.map((option, optionIndex) => <div className="form-grid" key={option.id}><input aria-label={`问题 ${index + 1} 选项 ${optionIndex + 1} 值`} value={option.value} onChange={(event) => updateQuestion(question.id, { options: question.options.map((item) => item.id === option.id ? { ...item, value: event.target.value } : item) })} /><input aria-label={`问题 ${index + 1} 选项 ${optionIndex + 1} 标签`} value={option.label} onChange={(event) => updateQuestion(question.id, { options: question.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) })} /></div>)}</div> : null}
        <div className="collection-actions"><button type="button" className="button-secondary" disabled={pending || index === 0} onClick={() => moveQuestion(question.id, -1)}>上移</button><button type="button" className="button-secondary" disabled={pending || index === form.questions.length - 1} onClick={() => moveQuestion(question.id, 1)}>下移</button><button type="button" className="button-secondary" disabled={pending} onClick={() => updateQuestion(question.id, { active: !question.active })}>{question.active ? '停用' : '启用'}</button></div>
      </fieldset>)}
    </section>
    <section className="panel registration-editor" aria-labelledby="attachments-title"><div className="section-heading"><h2 id="attachments-title">附件要求</h2><button type="button" disabled={pending} onClick={() => setForm((current) => ({ ...current, attachments: [...current.attachments, newAttachment(current.attachments.length)] }))}>新增附件</button></div>
      {form.attachments.map((attachment, index) => <fieldset key={attachment.id} className="registration-editor-item"><legend>附件 {index + 1}</legend><div className="form-grid"><label className="form-field">名称<input aria-label={`附件 ${index + 1} 名称`} value={attachment.label} onChange={(event) => updateAttachment(attachment.id, { label: event.target.value })} /></label><label className="form-field">大小限制（字节）<input type="number" min={1} value={attachment.maxSizeBytes} onChange={(event) => updateAttachment(attachment.id, { maxSizeBytes: Number(event.target.value) })} /></label></div><label className="form-field">说明<textarea value={attachment.helpText} onChange={(event) => updateAttachment(attachment.id, { helpText: event.target.value })} /></label><label className="check-field"><input type="checkbox" checked={attachment.required} onChange={(event) => updateAttachment(attachment.id, { required: event.target.checked })} />必填</label><label className="check-field"><input type="checkbox" checked={attachment.active} onChange={(event) => updateAttachment(attachment.id, { active: event.target.checked })} />启用</label><p>允许格式：{attachment.allowedExtensions.map((extension) => extension.toUpperCase()).join('、')}</p><div className="collection-actions"><button type="button" className="button-secondary" disabled={pending || index === 0} onClick={() => moveAttachment(attachment.id, -1)}>上移</button><button type="button" className="button-secondary" disabled={pending || index === form.attachments.length - 1} onClick={() => moveAttachment(attachment.id, 1)}>下移</button><button type="button" className="button-secondary" disabled={pending} onClick={() => updateAttachment(attachment.id, { active: !attachment.active })}>{attachment.active ? '停用' : '启用'}</button></div></fieldset>)}
    </section>
    <div className="content-editor__actions"><button type="button" disabled={pending || !isDirty} onClick={() => { void save() }}>保存草稿</button><button type="button" disabled={pending || isDirty} onClick={() => { void publish() }}>发布当前草稿</button>{isDirty ? <span className="dirty-hint" role="status">有未保存修改，请先保存</span> : null}</div>
  </section>
}
