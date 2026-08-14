import { DEFAULT_REGISTRATION_FORM, type RegistrationCoreFieldKey } from '@panshi/contracts'

export type CoreFieldValues = Partial<Record<RegistrationCoreFieldKey, string>>

export function CoreFields({ values, phone, onChange }: {
  values: CoreFieldValues
  phone: string
  onChange: (key: RegistrationCoreFieldKey, value: string) => void
}) {
  return <fieldset className="registration-core-fields">
    <legend>固定身份信息</legend>
    {DEFAULT_REGISTRATION_FORM.coreFields.map((field) => {
      const isPhone = field.key === 'phone'
      return <label key={field.key} htmlFor={`core-${field.key}`}>
        <span>{field.label}{field.required ? <small>必填</small> : null}</span>
        <input
          id={`core-${field.key}`}
          name={field.key}
          value={isPhone ? phone : values[field.key] ?? ''}
          readOnly={isPhone}
          required={field.required}
          aria-label={field.label}
          onChange={(event) => { if (!isPhone) onChange(field.key, event.target.value) }}
        />
      </label>
    })}
  </fieldset>
}
