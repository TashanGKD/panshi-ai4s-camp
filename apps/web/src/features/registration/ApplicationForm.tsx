import type { ApplicationAnswers, ApplicationCoreFields, MyApplicationResponse, RegistrationCoreFieldKey } from '@panshi/contracts'
import { CoreFields, type CoreFieldValues } from './CoreFields'
import { DynamicQuestion } from './DynamicQuestion'

export type FormDraft = {
  profile: Omit<ApplicationCoreFields, 'phone'>
  answers: ApplicationAnswers
  attachments: Array<{ slotId: string, fileId: string }>
}

export function ApplicationForm({ application, draft, disabled, errors, onChange, onUpload, onRemove, onRemoveUnlinked }: {
  application: MyApplicationResponse['data']['application']; draft: FormDraft; disabled: boolean; errors: Record<string, string>
  onChange: (draft: FormDraft) => void; onUpload: (slotId: string, file: File) => void; onRemove: (slotId: string, fileId: string) => void
  onRemoveUnlinked?: (fileId: string) => void
}) {
  const coreValues = draft.profile as CoreFieldValues
  const currentFiles = new Map(application.attachments.map((file) => [file.slotId, file]))
  const changeCore = (key: RegistrationCoreFieldKey, value: string) => {
    if (key === 'phone') return
    onChange({ ...draft, profile: { ...draft.profile, [key]: value } })
  }
  return <fieldset disabled={disabled} className="application-form-fields">
    <CoreFields values={coreValues} phone={application.profile.phone} onChange={changeCore} />
    <section><h3>补充问题</h3>{application.form.questions.filter((question) => question.active).map((question) => <div key={question.id}>
      <DynamicQuestion question={question} value={draft.answers[question.id] ?? (question.type === 'multiple_choice' ? [] : '')} onChange={(value) => onChange({ ...draft, answers: { ...draft.answers, [question.id]: value as string | string[] } })} />
      {errors[`answers.${question.id}`] ? <p className="form-error" role="alert">{errors[`answers.${question.id}`]}</p> : null}
    </div>)}</section>
    <section><h3>附件</h3>{application.form.attachments.filter((slot) => slot.active).map((slot) => {
      const file = currentFiles.get(slot.id)
      return <div className="application-attachment" key={slot.id}><label htmlFor={`attachment-${slot.id}`}>{slot.label}{slot.required ? <small>必填</small> : null}</label><p>{slot.helpText}</p>
        {file ? <p><a href={file.downloadUrl}>{file.originalName}</a> <button type="button" onClick={() => onRemove(slot.id, file.id)}>删除并替换</button></p> : <input id={`attachment-${slot.id}`} type="file" accept={slot.allowedExtensions.map((extension) => `.${extension}`).join(',')} required={slot.required} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onUpload(slot.id, selected) }} />}
        {errors[`attachments.${slot.id}`] ? <p className="form-error" role="alert">{errors[`attachments.${slot.id}`]}</p> : null}</div>
    })}</section>
    {application.unlinkedAttachments.length > 0 ? <section><h3>未关联附件</h3><p>以下文件来自已停用的附件项或尚未关联的上传，可下载留存或删除。</p><ul>{application.unlinkedAttachments.map((file) => <li key={file.id}><a href={file.downloadUrl}>{file.originalName}</a> <button type="button" onClick={() => onRemoveUnlinked?.(file.id)}>删除</button></li>)}</ul></section> : null}
  </fieldset>
}
