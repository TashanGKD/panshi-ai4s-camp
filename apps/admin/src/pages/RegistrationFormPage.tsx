import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_REGISTRATION_FORM,
  type RegistrationAttachment,
  type RegistrationDynamicQuestion,
  type RegistrationForm,
  type RegistrationQuestionOption,
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

type FieldError = { path: string, message: string }

const fieldErrors = (errors: readonly FieldError[], ...paths: string[]) => errors.filter((error) => paths.includes(error.path))
const optionalInteger = (value: string) => value === '' ? undefined : Number(value)
const pathLabel = (path: string) => path
  .replace(/^questions\.(\d+)/u, (_match, index: string) => `问题 ${Number(index) + 1}`)
  .replace(/\.options\.(\d+)/u, (_match, index: string) => ` / 选项 ${Number(index) + 1}`)
  .replace(/^attachments\.(\d+)/u, (_match, index: string) => `附件 ${Number(index) + 1}`)
  .replace(/\.validation\.minLength$/u, ' / 最少字数')
  .replace(/\.validation\.maxLength$/u, ' / 最多字数')
  .replace(/\.allowedExtensions$/u, ' / 允许格式')
  .replace(/\.maxSizeBytes$/u, ' / 大小限制')
  .replace(/\.label$/u, ' / 名称')
  .replace(/\.value$/u, ' / 值')
  .replace(/\.helpText$/u, ' / 说明')
  .replace(/\.type$/u, ' / 类型')
  .replace(/\.id$/u, ' / 标识')
  .replace(/\.order$/u, ' / 顺序')

function ErrorMessages({ errors }: { errors: readonly FieldError[] }) {
  if (errors.length === 0) return null
  return <>{errors.map((error, index) => <small className="field-error" key={`${error.path}-${index}`}>{error.message}</small>)}</>
}

function PreviewQuestion({ question }: { question: RegistrationDynamicQuestion }) {
  const id = `preview-${question.id}`
  const helpId = `${id}-help`
  const limits = [
    question.validation.minLength === undefined ? null : `至少 ${question.validation.minLength} 字`,
    question.validation.maxLength === undefined ? null : `最多 ${question.validation.maxLength} 字`,
  ].filter(Boolean).join('，')
  const label = <>{question.label}{question.required ? '（必填）' : ''}</>
  const help = <p id={helpId} className="form-help">{question.helpText}{question.helpText && limits ? '；' : ''}{limits}</p>
  if (question.type === 'short_text') return <div className="registration-question"><label htmlFor={id}>{label}</label><input id={id} readOnly minLength={question.validation.minLength} maxLength={question.validation.maxLength} aria-describedby={helpId} />{help}</div>
  if (question.type === 'long_text') return <div className="registration-question"><label htmlFor={id}>{label}</label><textarea id={id} readOnly minLength={question.validation.minLength} maxLength={question.validation.maxLength} aria-describedby={helpId} />{help}</div>
  const options = 'options' in question && question.options ? question.options : []
  return <fieldset className="registration-question" disabled aria-describedby={helpId} aria-required={question.required}><legend>{label}</legend>{options.map((option) => <label key={option.id}><input type={question.type === 'single_choice' ? 'radio' : 'checkbox'} name={id} value={option.value} />{option.label}</label>)}{help}</fieldset>
}

function RegistrationPreview({ form }: { form: RegistrationForm }) {
  return <section className="panel registration-preview" aria-labelledby="preview-title"><h2 id="preview-title">预览</h2>
    <fieldset disabled><legend>固定身份信息</legend>{form.coreFields.map((field) => <label key={field.key}>{field.label}<input readOnly value="" /></label>)}</fieldset>
    {form.questions.filter((question) => question.active).map((question) => <PreviewQuestion key={question.id} question={question} />)}
    {form.attachments.filter((attachment) => attachment.active).map((attachment) => <section key={attachment.id} className="registration-attachment-preview" aria-label={attachment.label}><h3>{attachment.label}{attachment.required ? '（必填）' : ''}</h3><p>{attachment.helpText}</p><p>允许格式：{attachment.allowedExtensions.map((extension) => extension.toUpperCase()).join('、')}；大小上限：{Math.ceil(attachment.maxSizeBytes / 1024 / 1024)} MB</p></section>)}
  </section>
}

export function RegistrationFormPage({ client }: { client: AdminClient }) {
  const [draft, setDraft] = useState<Awaited<ReturnType<AdminClient['getRegistrationFormDraft']>>>()
  const [history, setHistory] = useState<Awaited<ReturnType<AdminClient['getRegistrationFormHistory']>>>()
  const [form, setForm] = useState<RegistrationForm>(() => copy(DEFAULT_REGISTRATION_FORM))
  const [baseline, setBaseline] = useState<RegistrationForm>(() => copy(DEFAULT_REGISTRATION_FORM))
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ kind: 'status' | 'error', text: string }>()
  const [errors, setErrors] = useState<readonly { path: string, message: string }[]>([])
  const generation = useRef(0)
  const operationLock = useRef(false)
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline])

  const load = async (loadGeneration = ++generation.current) => {
    const [nextDraft, nextHistory] = await Promise.all([client.getRegistrationFormDraft(), client.getRegistrationFormHistory()])
    if (generation.current !== loadGeneration) return false
    setDraft(nextDraft); setHistory(nextHistory); setForm(copy(nextDraft.data.form)); setBaseline(copy(nextDraft.data.form)); setErrors([])
    return true
  }

  useEffect(() => {
    const current = ++generation.current
    void load(current).catch(() => { if (generation.current === current) setMessage({ kind: 'error', text: '报名表暂时无法加载' }) })
    return () => { generation.current += 1 }
  }, [client])

  const run = async (operation: () => Promise<void>) => {
    if (operationLock.current) return
    operationLock.current = true
    setPending(true); setMessage(undefined); setErrors([])
    try { await operation() } catch (error) {
      if (error instanceof AdminApiError && error.status === 409) setMessage({ kind: 'error', text: '报名表已被其他管理员修改，请刷新页面后重试。' })
      else if (error instanceof AdminApiError && error.status === 422) {
        setErrors(error.details?.fields ?? []); setMessage({ kind: 'error', text: '请修正标出的字段后再保存。' })
      } else setMessage({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请重试。' })
    } finally {
      operationLock.current = false
      setPending(false)
    }
  }

  const updateQuestion = (id: string, update: Partial<RegistrationDynamicQuestion>) => setForm((current) => ({
    ...current, questions: current.questions.map((question) => question.id === id ? { ...question, ...update } as RegistrationDynamicQuestion : question),
  }))
  const changeQuestionType = (id: string, type: RegistrationDynamicQuestion['type']) => setForm((current) => ({
    ...current,
    questions: current.questions.map((question): RegistrationDynamicQuestion => {
      if (question.id !== id) return question
      const common = {
        id: question.id, label: question.label, helpText: question.helpText, required: question.required,
        order: question.order, active: question.active,
      }
      if (type === 'single_choice' || type === 'multiple_choice') {
        const options = question.type === 'single_choice' || question.type === 'multiple_choice'
          ? question.options
          : [{ id: editorUuid(), value: 'option-1', label: '选项 1' }]
        return { ...common, type, validation: {}, options }
      }
      return { ...common, type, validation: question.validation }
    }),
  }))
  const updateQuestionOption = (questionId: string, optionId: string, update: Partial<RegistrationQuestionOption>) => setForm((current) => ({
    ...current,
    questions: current.questions.map((question) => question.id === questionId && (question.type === 'single_choice' || question.type === 'multiple_choice')
      ? { ...question, options: question.options.map((option) => option.id === optionId ? { ...option, ...update } : option) }
      : question),
  }))
  const addQuestionOption = (questionId: string) => setForm((current) => ({
    ...current,
    questions: current.questions.map((question) => question.id === questionId && (question.type === 'single_choice' || question.type === 'multiple_choice')
      ? { ...question, options: [...question.options, { id: editorUuid(), value: `option-${question.options.length + 1}`, label: `选项 ${question.options.length + 1}` }] }
      : question),
  }))
  const removeQuestionOption = (questionId: string, optionId: string) => setForm((current) => ({
    ...current,
    questions: current.questions.map((question) => question.id === questionId && (question.type === 'single_choice' || question.type === 'multiple_choice')
      ? { ...question, options: question.options.filter((option) => option.id !== optionId) }
      : question),
  }))
  const moveQuestionOption = (questionId: string, optionId: string, direction: -1 | 1) => setForm((current) => ({
    ...current,
    questions: current.questions.map((question) => {
      if (question.id !== questionId || (question.type !== 'single_choice' && question.type !== 'multiple_choice')) return question
      const index = question.options.findIndex((option) => option.id === optionId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= question.options.length) return question
      const options = [...question.options]; [options[index], options[target]] = [options[target]!, options[index]!]
      return { ...question, options }
    }),
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
  const toggleAttachmentExtension = (id: string, extension: 'pdf' | 'docx') => setForm((current) => ({
    ...current,
    attachments: current.attachments.map((attachment) => attachment.id === id
      ? { ...attachment, allowedExtensions: attachment.allowedExtensions.includes(extension) ? attachment.allowedExtensions.filter((item) => item !== extension) : [...attachment.allowedExtensions, extension] }
      : attachment),
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
    const operationGeneration = generation.current
    const submittedForm = copy(form)
    const submittedSnapshot = JSON.stringify(submittedForm)
    const saved = await client.saveRegistrationFormDraft(submittedForm, draft.data.revision)
    if (generation.current !== operationGeneration) return
    setDraft(saved)
    setBaseline(copy(saved.data.form))
    setForm((current) => JSON.stringify(current) === submittedSnapshot ? copy(saved.data.form) : current)
    setMessage({ kind: 'status', text: '报名表草稿已保存。' })
  })
  const publish = () => run(async () => {
    if (!draft || isDirty) { setMessage({ kind: 'error', text: '请先保存草稿，再发布报名表。' }); return }
    const operationGeneration = generation.current
    await client.publishRegistrationForm(draft.data.revision)
    if (generation.current !== operationGeneration) return
    if (await load()) setMessage({ kind: 'status', text: '报名表已发布。' })
  })

  if (!draft || !history) return <section className="page-section"><h1>报名管理</h1><p role="status">正在加载报名表配置</p></section>

  return <section className="page-section registration-form-page">
    <div className="page-heading"><div><p>报名管理</p><h1>表单配置</h1></div><div className="revision-badges"><span>草稿修订 {draft.data.revision}</span><span>已发布版本 {draft.data.baseVersion ?? '—'}</span></div></div>
    {message ? <div role={message.kind === 'error' ? 'alert' : 'status'} className={`operation-message ${message.kind}`}><p>{message.text}</p>{message.kind === 'error' && errors.length > 0 ? <ul>{errors.map((error, index) => <li key={`${error.path}-${index}`}><strong>{pathLabel(error.path)}：</strong>{error.message}</li>)}</ul> : null}</div> : null}
    <div className="registration-form-tools">
      <section className="panel structured-form" aria-labelledby="fixed-fields-title">
        <h2 id="fixed-fields-title">固定字段</h2><p>核心身份字段由系统固定维护，手机号由登录账号带入且只读。</p>
        <ul>{form.coreFields.map((field) => <li key={field.key}><strong>{field.label}</strong><span>{field.key === 'phone' ? '只读' : '必填'}</span></li>)}</ul>
      </section>
      <RegistrationPreview form={form} />
    </div>
    <section className="panel registration-editor" aria-labelledby="questions-title"><div className="section-heading"><h2 id="questions-title">动态问题</h2><button type="button" disabled={pending} onClick={() => setForm((current) => ({ ...current, questions: [...current.questions, newQuestion(current.questions.length)] }))}>新增问题</button></div>
      {form.questions.length === 0 ? <p>尚未配置动态问题。</p> : form.questions.map((question, index) => <fieldset key={question.id} className="registration-editor-item"><legend>问题 {index + 1}</legend>
        <div className="form-grid"><label className="form-field">题目<input aria-label={`问题 ${index + 1} 题目`} id={`question-${question.id}-label`} value={question.label} onChange={(event) => updateQuestion(question.id, { label: event.target.value })} /><ErrorMessages errors={fieldErrors(errors, `questions.${index}.label`)} /></label>
          <label className="form-field">类型<select aria-label={`问题 ${index + 1} 类型`} value={question.type} onChange={(event) => changeQuestionType(question.id, event.target.value as RegistrationDynamicQuestion['type'])}><option value="short_text">单行文本</option><option value="long_text">多行文本</option><option value="single_choice">单选</option><option value="multiple_choice">多选</option></select><ErrorMessages errors={fieldErrors(errors, `questions.${index}.type`)} /></label></div>
        <label className="form-field">说明<textarea aria-label={`问题 ${index + 1} 说明`} value={question.helpText} onChange={(event) => updateQuestion(question.id, { helpText: event.target.value })} /><ErrorMessages errors={fieldErrors(errors, `questions.${index}.helpText`)} /></label>
        {question.type === 'short_text' || question.type === 'long_text' ? <div className="form-grid"><label className="form-field">最少字数<input aria-label={`问题 ${index + 1} 最少字数`} type="number" min={0} value={question.validation.minLength ?? ''} onChange={(event) => updateQuestion(question.id, { validation: { ...question.validation, minLength: optionalInteger(event.target.value) } })} /><ErrorMessages errors={fieldErrors(errors, `questions.${index}.validation.minLength`)} /></label><label className="form-field">最多字数<input aria-label={`问题 ${index + 1} 最多字数`} type="number" min={1} value={question.validation.maxLength ?? ''} onChange={(event) => updateQuestion(question.id, { validation: { ...question.validation, maxLength: optionalInteger(event.target.value) } })} /><ErrorMessages errors={fieldErrors(errors, `questions.${index}.validation.maxLength`)} /></label></div> : null}
        <label className="check-field"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />必填</label>
        <label className="check-field"><input type="checkbox" checked={question.active} onChange={(event) => updateQuestion(question.id, { active: event.target.checked })} />启用</label>
        {question.type === 'single_choice' || question.type === 'multiple_choice' ? <div className="choice-options"><div className="section-heading"><strong>选项</strong><button type="button" className="button-secondary" aria-label={`问题 ${index + 1} 新增选项`} onClick={() => addQuestionOption(question.id)}>新增选项</button></div><ErrorMessages errors={fieldErrors(errors, `questions.${index}.options`)} />{question.options.map((option, optionIndex) => <div className="choice-option-editor" key={option.id}><div className="form-grid"><label className="form-field">值<input aria-label={`问题 ${index + 1} 选项 ${optionIndex + 1} 值`} data-option-id={option.id} value={option.value} onChange={(event) => updateQuestionOption(question.id, option.id, { value: event.target.value })} /><ErrorMessages errors={fieldErrors(errors, `questions.${index}.options.${optionIndex}.value`)} /></label><label className="form-field">标签<input aria-label={`问题 ${index + 1} 选项 ${optionIndex + 1} 标签`} data-option-id={option.id} value={option.label} onChange={(event) => updateQuestionOption(question.id, option.id, { label: event.target.value })} /><ErrorMessages errors={fieldErrors(errors, `questions.${index}.options.${optionIndex}.label`, `questions.${index}.options.${optionIndex}.id`)} /></label></div><div className="collection-actions"><button type="button" className="button-secondary" aria-label={`问题 ${index + 1} 选项 ${optionIndex + 1} 上移`} disabled={optionIndex === 0} onClick={() => moveQuestionOption(question.id, option.id, -1)}>上移</button><button type="button" className="button-secondary" aria-label={`问题 ${index + 1} 选项 ${optionIndex + 1} 下移`} disabled={optionIndex === question.options.length - 1} onClick={() => moveQuestionOption(question.id, option.id, 1)}>下移</button><button type="button" className="button-secondary" aria-label={`问题 ${index + 1} 选项 ${optionIndex + 1} 删除`} onClick={() => removeQuestionOption(question.id, option.id)}>删除</button></div></div>)}</div> : null}
        <ErrorMessages errors={fieldErrors(errors, `questions.${index}.id`, `questions.${index}.order`, `questions.${index}.required`, `questions.${index}.active`, `questions.${index}.validation`)} />
        <div className="collection-actions"><button type="button" className="button-secondary" disabled={pending || index === 0} onClick={() => moveQuestion(question.id, -1)}>上移</button><button type="button" className="button-secondary" disabled={pending || index === form.questions.length - 1} onClick={() => moveQuestion(question.id, 1)}>下移</button><button type="button" className="button-secondary" disabled={pending} onClick={() => updateQuestion(question.id, { active: !question.active })}>{question.active ? '停用' : '启用'}</button></div>
      </fieldset>)}
    </section>
    <section className="panel registration-editor" aria-labelledby="attachments-title"><div className="section-heading"><h2 id="attachments-title">附件要求</h2><button type="button" disabled={pending} onClick={() => setForm((current) => ({ ...current, attachments: [...current.attachments, newAttachment(current.attachments.length)] }))}>新增附件</button></div>
      {form.attachments.map((attachment, index) => <fieldset key={attachment.id} className="registration-editor-item"><legend>附件 {index + 1}</legend><div className="form-grid"><label className="form-field">名称<input aria-label={`附件 ${index + 1} 名称`} value={attachment.label} onChange={(event) => updateAttachment(attachment.id, { label: event.target.value })} /><ErrorMessages errors={fieldErrors(errors, `attachments.${index}.label`)} /></label><label className="form-field">大小限制（字节）<input aria-label={`附件 ${index + 1} 大小限制`} type="number" min={1} value={attachment.maxSizeBytes} onChange={(event) => updateAttachment(attachment.id, { maxSizeBytes: Number(event.target.value) })} /><ErrorMessages errors={fieldErrors(errors, `attachments.${index}.maxSizeBytes`)} /></label></div><label className="form-field">说明<textarea aria-label={`附件 ${index + 1} 说明`} value={attachment.helpText} onChange={(event) => updateAttachment(attachment.id, { helpText: event.target.value })} /><ErrorMessages errors={fieldErrors(errors, `attachments.${index}.helpText`)} /></label><label className="check-field"><input type="checkbox" checked={attachment.required} onChange={(event) => updateAttachment(attachment.id, { required: event.target.checked })} />必填</label><label className="check-field"><input type="checkbox" checked={attachment.active} onChange={(event) => updateAttachment(attachment.id, { active: event.target.checked })} />启用</label><fieldset className="attachment-formats"><legend>允许格式</legend>{(['pdf', 'docx'] as const).map((extension) => <label className="check-field" key={extension}><input aria-label={`附件 ${index + 1} 允许 ${extension.toUpperCase()}`} type="checkbox" checked={attachment.allowedExtensions.includes(extension)} onChange={() => toggleAttachmentExtension(attachment.id, extension)} />{extension.toUpperCase()}</label>)}<ErrorMessages errors={fieldErrors(errors, `attachments.${index}.allowedExtensions`)} /></fieldset><ErrorMessages errors={fieldErrors(errors, `attachments.${index}.id`, `attachments.${index}.order`, `attachments.${index}.required`, `attachments.${index}.active`)} /><div className="collection-actions"><button type="button" className="button-secondary" disabled={pending || index === 0} onClick={() => moveAttachment(attachment.id, -1)}>上移</button><button type="button" className="button-secondary" disabled={pending || index === form.attachments.length - 1} onClick={() => moveAttachment(attachment.id, 1)}>下移</button><button type="button" className="button-secondary" disabled={pending} onClick={() => updateAttachment(attachment.id, { active: !attachment.active })}>{attachment.active ? '停用' : '启用'}</button></div></fieldset>)}
    </section>
    <div className="content-editor__actions"><button type="button" disabled={pending || !isDirty} onClick={() => { void save() }}>保存草稿</button><button type="button" disabled={pending || isDirty} onClick={() => { void publish() }}>发布当前草稿</button>{isDirty ? <span className="dirty-hint" role="status">有未保存修改，请先保存</span> : null}</div>
  </section>
}
