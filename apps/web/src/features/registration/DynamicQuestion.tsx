import type { ProficiencyMatrixAnswer, RegistrationDynamicQuestion } from '@panshi/contracts'

type QuestionValue = string | string[] | ProficiencyMatrixAnswer

export function DynamicQuestion({ question, value, onChange, disabled = false }: {
  question: RegistrationDynamicQuestion
  value: QuestionValue
  onChange: (value: QuestionValue) => void
  disabled?: boolean
}) {
  const descriptionId = `${question.id}-help`
  const validation = question.type === 'short_text' || question.type === 'long_text'
    ? [question.validation.minLength !== undefined ? `至少 ${question.validation.minLength} 字` : null, question.validation.maxLength !== undefined ? `最多 ${question.validation.maxLength} 字` : null].filter((item): item is string => item !== null).join('，')
    : ''
  const label = <span>{question.label}{question.required ? <small>必填</small> : null}</span>
  const hasHelp = question.helpText !== '' || validation !== ''
  const help = hasHelp ? <p id={descriptionId} className="form-help"><span>{question.helpText}</span>{validation ? <span>{question.helpText ? ' ' : ''}{validation}</span> : null}</p> : null

  if (question.type === 'short_text') {
    return <div className="registration-question"><label htmlFor={question.id}>{label}</label>
      <input disabled={disabled} id={question.id} name={question.id} value={typeof value === 'string' ? value : ''} minLength={question.validation.minLength} maxLength={question.validation.maxLength} required={question.required} onChange={(event) => onChange(event.target.value)} aria-describedby={hasHelp ? descriptionId : undefined} />{help}</div>
  }

  if (question.type === 'long_text') {
    return <div className="registration-question"><label htmlFor={question.id}>{label}</label>
      <textarea disabled={disabled} id={question.id} name={question.id} value={typeof value === 'string' ? value : ''} minLength={question.validation.minLength} maxLength={question.validation.maxLength} required={question.required} onChange={(event) => onChange(event.target.value)} aria-describedby={hasHelp ? descriptionId : undefined} />{help}</div>
  }

  if (question.type === 'proficiency_matrix') {
    const matrix: ProficiencyMatrixAnswer = typeof value === 'object' && !Array.isArray(value) && 'ratings' in value
      ? value
      : { ratings: {}, otherLabel: '', otherLevel: '' }
    const update = (next: Partial<ProficiencyMatrixAnswer>) => onChange({ ...matrix, ...next })
    return <fieldset className="registration-question proficiency-question" aria-describedby={hasHelp ? descriptionId : undefined} aria-required={question.required}>
      <legend>{label}</legend>
      {help}
      <div className="proficiency-matrix" role="table" aria-label={question.label}>
        <div className="proficiency-matrix__header" role="row"><span role="columnheader">能力项目</span>{question.levels.map((level) => <span role="columnheader" key={level.id}>{level.label}</span>)}</div>
        {question.items.map((item) => <div className="proficiency-matrix__row" role="radiogroup" aria-label={item.label} key={item.id}>
          <span className="proficiency-matrix__item" role="rowheader">{item.label}</span>
          {question.levels.map((level) => <label key={level.id}><input disabled={disabled} type="radio" name={`${question.id}-${item.value}`} aria-label={level.label} value={level.value} checked={matrix.ratings[item.value] === level.value} onChange={() => update({ ratings: { ...matrix.ratings, [item.value]: level.value } })}/><span>{level.label}</span></label>)}
        </div>)}
        {question.allowOther ? <div className="proficiency-matrix__other">
          <label htmlFor={`${question.id}-other`}><span>其他能力</span><input disabled={disabled} id={`${question.id}-other`} aria-label="其他能力" value={matrix.otherLabel} onChange={(event) => update({ otherLabel: event.target.value, otherLevel: '' })}/></label>
        </div> : null}
      </div>
    </fieldset>
  }

  const selected = Array.isArray(value) ? value : typeof value === 'string' && value !== '' ? [value] : []
  const options = question.options ?? []
  const atMaximum = question.type === 'multiple_choice' && question.validation.maxSelections !== undefined && selected.length >= question.validation.maxSelections
  return <fieldset className="registration-question" aria-describedby={hasHelp ? descriptionId : undefined} aria-required={question.required}>
    <legend>{label}</legend>
    {options.map((option) => <label className={option.description ? 'choice-card' : undefined} key={option.id}>
      <input
        type={question.type === 'single_choice' ? 'radio' : 'checkbox'}
        disabled={disabled || (question.type === 'multiple_choice' && atMaximum && !selected.includes(option.value))}
        name={question.id}
        value={option.value}
        checked={selected.includes(option.value)}
        required={question.required && selected.length === 0 && (question.type === 'single_choice' || option === options[0])}
        onChange={(event) => {
          if (question.type === 'single_choice') onChange(event.target.value)
          else onChange(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))
        }}
      /><span className="choice-card__body"><strong>{option.label}</strong>{option.description ? <span>{option.description}</span> : null}</span>
    </label>)}
    {question.type === 'multiple_choice' && question.validation.maxSelections !== undefined ? <p className="selection-count">已选择 {selected.length}/{question.validation.maxSelections} 项</p> : null}
    {help}
  </fieldset>
}
