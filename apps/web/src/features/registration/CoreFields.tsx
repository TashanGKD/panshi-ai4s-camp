import { useEffect, useId, useMemo, useState } from 'react'
import { REGISTRATION_IDENTITY_OPTIONS, type InstitutionDirectoryResponse, type RegistrationCoreFieldKey } from '@panshi/contracts'

export type CoreFieldValues = Partial<Record<RegistrationCoreFieldKey, string>>
type Directory = InstitutionDirectoryResponse['data']

const normalize = (value: string) => value.toLocaleLowerCase('zh-CN').replace(/\s+/gu, '')

function SearchableSelect({ id, label, value, options, required, disabled, placeholder, onChange, extraOption }: {
  id: string; label: string; value: string; options: readonly string[]; required?: boolean; disabled?: boolean; placeholder?: string
  onChange: (value: string) => void; extraOption?: { label: string, onSelect: () => void }
}) {
  const generatedId = useId()
  const listId = `${id}-${generatedId.replace(/:/gu, '')}-listbox`
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  useEffect(() => { if (value !== '' || !open) setQuery(value) }, [open, value])
  const matches = useMemo(() => {
    const rawNeedle = normalize(query)
    const needle = rawNeedle === '国科大' ? '中国科学院大学' : rawNeedle
    return options.filter((option) => needle === '' || normalize(option).includes(needle))
  }, [options, query])
  const optionCount = matches.length + (extraOption ? 1 : 0)
  const select = (selected: string) => { setQuery(selected); setOpen(false); onChange(selected) }
  return <div className="searchable-select">
    <input
      id={id}
      role="combobox"
      aria-label={label}
      aria-autocomplete="list"
      aria-controls={listId}
      aria-expanded={open}
      aria-activedescendant={open && optionCount > 0 ? `${listId}-option-${activeIndex}` : undefined}
      autoComplete="off"
      disabled={disabled}
      required={required}
      placeholder={placeholder}
      value={query}
      onFocus={() => { setOpen(true); setActiveIndex(0) }}
      onBlur={() => window.setTimeout(() => setOpen(false), 0)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); onChange('') }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); return }
        if (event.key === 'ArrowDown' && optionCount > 0) { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.min(current + 1, optionCount - 1)); return }
        if (event.key === 'ArrowUp' && optionCount > 0) { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); return }
        if (event.key === 'Enter' && open && optionCount > 0) {
          event.preventDefault()
          if (activeIndex < matches.length) select(matches[activeIndex]!)
          else extraOption?.onSelect()
        }
      }}
    />
    {open ? <ul id={listId} role="listbox" className="searchable-select__options">
      {matches.map((option, index) => <li
        id={`${listId}-option-${index}`}
        role="option"
        aria-selected={option === value}
        className={index === activeIndex ? 'is-active' : undefined}
        key={option}
        onMouseDown={(event) => { event.preventDefault(); select(option) }}
      >{option}</li>)}
      {extraOption ? <li
        id={`${listId}-option-${matches.length}`}
        role="option"
        aria-selected={false}
        className={matches.length === activeIndex ? 'is-active' : undefined}
        onMouseDown={(event) => { event.preventDefault(); setQuery(''); setOpen(false); extraOption.onSelect() }}
      >{extraOption.label}</li> : null}
      {matches.length === 0 && !extraOption ? <li className="searchable-select__empty">未找到匹配项</li> : null}
    </ul> : null}
  </div>
}

const FieldLabel = ({ label, required = true }: { label: string, required?: boolean }) => <span>{label}{required ? <small>必填</small> : <small className="is-optional">选填</small>}</span>

export function CoreFields({ values, phone, directory, onChange, editableKeys, errors = {} }: {
  values: CoreFieldValues
  phone: string
  directory: Directory
  onChange: (key: RegistrationCoreFieldKey, value: string) => void
  editableKeys?: ReadonlySet<string>
  errors?: Record<string, string>
}) {
  const universityNames = useMemo(() => directory.universities.map(({ name }) => name), [directory.universities])
  const universitySet = useMemo(() => new Set(universityNames), [universityNames])
  const unitNames = useMemo(() => directory.ucasTrainingUnits.map(({ name }) => name), [directory.ucasTrainingUnits])
  const organization = values.organization ?? ''
  const identity = values.identityType ?? ''
  const isStudent = ['本科生', '硕士研究生', '博士研究生'].includes(identity)
  const [customOrganization, setCustomOrganization] = useState(organization !== '' && !universitySet.has(organization))
  useEffect(() => { if (organization !== '' && !universitySet.has(organization)) setCustomOrganization(true) }, [organization, universitySet])
  const disabled = (key: RegistrationCoreFieldKey) => editableKeys !== undefined && !editableKeys.has(key)
  const error = (key: RegistrationCoreFieldKey) => errors[`profile.${key}`]
  const input = (key: RegistrationCoreFieldKey, label: string, required = true, placeholder?: string) => <label htmlFor={`core-${key}`}>
    <FieldLabel label={label} required={required}/>
    <input id={`core-${key}`} aria-label={label} required={required} disabled={disabled(key)} placeholder={placeholder} value={values[key] ?? ''} onChange={(event) => onChange(key, event.target.value)} />
    {error(key) ? <em role="alert">{error(key)}</em> : null}
  </label>
  const textarea = (key: RegistrationCoreFieldKey, label: string, required = true, placeholder?: string) => <label htmlFor={`core-${key}`}>
    <FieldLabel label={label} required={required}/>
    <textarea id={`core-${key}`} aria-label={label} required={required} disabled={disabled(key)} rows={3} placeholder={placeholder} value={values[key] ?? ''} onChange={(event) => onChange(key, event.target.value)} />
    {error(key) ? <em role="alert">{error(key)}</em> : null}
  </label>

  return <fieldset className="registration-core-fields">
    <legend>基本信息</legend>
    <label htmlFor="core-name"><FieldLabel label="姓名"/><input id="core-name" aria-label="姓名" required disabled={disabled('name')} value={values.name ?? ''} onChange={(event) => onChange('name', event.target.value)} />{error('name') ? <em role="alert">{error('name')}</em> : null}</label>
    <label htmlFor="core-phone"><FieldLabel label="手机号"/><span className="phone-field"><span className="phone-field__prefix" aria-hidden="true">+86</span><input id="core-phone" aria-label="手机号" required readOnly value={phone.replace(/^\+86/u, '')} /></span></label>
    <label htmlFor="core-email"><FieldLabel label="电子邮箱" required={false}/><input id="core-email" aria-label="电子邮箱" type="email" disabled={disabled('email')} value={values.email ?? ''} onChange={(event) => onChange('email', event.target.value)} />{error('email') ? <em role="alert">{error('email')}</em> : null}</label>
    <label htmlFor="core-identityType"><FieldLabel label="当前身份"/><select id="core-identityType" aria-label="当前身份" required disabled={disabled('identityType')} value={identity} onChange={(event) => onChange('identityType', event.target.value)}><option value="">请选择</option>{REGISTRATION_IDENTITY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select>{error('identityType') ? <em role="alert">{error('identityType')}</em> : null}</label>

    {isStudent ? <>
      <label htmlFor="core-organization"><FieldLabel label="所在学校"/>
        {customOrganization ? <>
          <input id="core-organization" aria-label="所在学校" required disabled={disabled('organization')} placeholder="请填写学校全称" value={organization} onChange={(event) => onChange('organization', event.target.value)} />
          <button className="field-inline-action" type="button" disabled={disabled('organization')} onClick={() => { setCustomOrganization(false); onChange('organization', '') }}>返回高校名录</button>
        </> : <SearchableSelect id="core-organization" label="所在学校" value={organization} options={universityNames} required disabled={disabled('organization')} placeholder="输入学校名称检索" onChange={(value) => onChange('organization', value)} extraOption={{ label: '其他学校（手动填写）', onSelect: () => { setCustomOrganization(true); onChange('organization', '') } }} />}
        {error('organization') ? <em role="alert">{error('organization')}</em> : null}
      </label>
      <label htmlFor="core-department"><FieldLabel label={organization === '中国科学院大学' ? '培养单位' : '院系'}/>
        {organization === '中国科学院大学'
          ? <SearchableSelect id="core-department" label="培养单位" value={values.department ?? ''} options={unitNames} required disabled={disabled('department')} placeholder="输入学院或研究所名称检索" onChange={(value) => onChange('department', value)} />
          : <input id="core-department" aria-label="院系" required disabled={disabled('department')} value={values.department ?? ''} onChange={(event) => onChange('department', event.target.value)} />}
        {error('department') ? <em role="alert">{error('department')}</em> : null}
      </label>
      {input('major', '专业')}
      {identity === '本科生' ? textarea('researchInterest', '研究兴趣', false) : textarea('researchDirection', '研究方向')}
    </> : null}

    {identity === '在站博士后' ? <>
      {input('organization', '设站单位')}
      {input('postdocStation', '博士后流动站／工作站')}
      {input('disciplineField', '一级学科或专业领域')}
      {textarea('researchDirection', '研究方向')}
      {input('supervisor', '合作导师', false)}
    </> : null}

    {identity === '在职人员' ? <>
      {input('organization', '工作单位')}
      {input('jobPosition', '职务／岗位')}
      <label htmlFor="core-professionalTitleLevel"><FieldLabel label="专业技术职称等级" required={false}/><select id="core-professionalTitleLevel" aria-label="专业技术职称等级" disabled={disabled('professionalTitleLevel')} value={values.professionalTitleLevel ?? ''} onChange={(event) => onChange('professionalTitleLevel', event.target.value)}><option value="">请选择（选填）</option>{['无', '初级', '中级', '副高级', '正高级', '其他'].map((option) => <option key={option}>{option}</option>)}</select>{error('professionalTitleLevel') ? <em role="alert">{error('professionalTitleLevel')}</em> : null}</label>
      {input('specificTitle', '具体职称', false, '如研究员、高级工程师等')}
    </> : null}

    {identity === '其他' ? <>
      {textarea('identityDescription', '身份说明')}
      {input('organization', '所在单位', false)}
      {textarea('disciplineField', '专业领域或研究方向', false)}
    </> : null}
  </fieldset>
}
