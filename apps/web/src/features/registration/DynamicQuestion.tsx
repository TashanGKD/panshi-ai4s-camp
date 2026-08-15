import type { RegistrationDynamicQuestion } from '@panshi/contracts'

type QuestionValue = string | readonly string[]

export function DynamicQuestion({ question, value, onChange, disabled = false }: {
  question: RegistrationDynamicQuestion
  value: QuestionValue
  onChange: (value: QuestionValue) => void
  disabled?: boolean
}) {
  const descriptionId = `${question.id}-help`
  const validation = [
    question.validation.minLength !== undefined ? `至少 ${question.validation.minLength} 字` : null,
    question.validation.maxLength !== undefined ? `最多 ${question.validation.maxLength} 字` : null,
  ].filter((item): item is string => item !== null).join('，')
  const label = <span>{question.label}{question.required ? <small>必填</small> : null}</span>
  const help = <p id={descriptionId} className="form-help"><span>{question.helpText}</span>{validation ? <span> {validation}</span> : null}</p>

  if (question.type === 'short_text') {
    return <div className="registration-question"><label htmlFor={question.id}>{label}</label>
      <input disabled={disabled} id={question.id} name={question.id} value={typeof value === 'string' ? value : ''} minLength={question.validation.minLength} maxLength={question.validation.maxLength} required={question.required} onChange={(event) => onChange(event.target.value)} aria-describedby={descriptionId} />{help}</div>
  }

  if (question.type === 'long_text') {
    return <div className="registration-question"><label htmlFor={question.id}>{label}</label>
      <textarea disabled={disabled} id={question.id} name={question.id} value={typeof value === 'string' ? value : ''} minLength={question.validation.minLength} maxLength={question.validation.maxLength} required={question.required} onChange={(event) => onChange(event.target.value)} aria-describedby={descriptionId} />{help}</div>
  }

  const selected = Array.isArray(value) ? value : value === '' ? [] : [value]
  const options = question.options ?? []
  return <fieldset className="registration-question" aria-describedby={descriptionId} aria-required={question.required}>
    <legend>{label}</legend>
    {options.map((option) => <label key={option.id}>
      <input
        type={question.type === 'single_choice' ? 'radio' : 'checkbox'}
        disabled={disabled}
        name={question.id}
        value={option.value}
        checked={selected.includes(option.value)}
        required={question.required && selected.length === 0 && (question.type === 'single_choice' || option === options[0])}
        onChange={(event) => {
          if (question.type === 'single_choice') onChange(event.target.value)
          else onChange(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))
        }}
      />{option.label}
    </label>)}
    {help}
  </fieldset>
}
