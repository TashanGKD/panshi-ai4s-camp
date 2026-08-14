import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REGISTRATION_ATTACHMENT_ID,
  DEFAULT_REGISTRATION_FORM,
  RegistrationFormSchema,
  type RegistrationDynamicQuestion,
  type RegistrationForm,
} from './registration.js'

const question = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: 'short_text',
  label: '研究问题',
  helpText: '请用一句话说明。',
  required: true,
  order: 0,
  active: true,
  validation: { maxLength: 120 },
  ...overrides,
})

describe('registration form contract', () => {
  it('keeps the fixed core fields and deterministic default attachment', () => {
    const parsed = RegistrationFormSchema.parse(DEFAULT_REGISTRATION_FORM)

    expect(parsed.coreFields.map((field) => field.key)).toEqual([
      'name', 'phone', 'email', 'organization', 'department', 'identityType', 'educationStage', 'majorResearchDirection',
    ])
    expect(parsed.coreFields.find((field) => field.key === 'phone')).toMatchObject({ readOnly: true, required: true })
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]).toMatchObject({
      id: DEFAULT_REGISTRATION_ATTACHMENT_ID,
      label: '个人简历／补充材料',
      required: false,
      active: true,
      allowedExtensions: ['pdf', 'docx'],
    })
  })

  it('accepts all four dynamic question types with strict type-specific options', () => {
    const forms: RegistrationForm[] = (['short_text', 'long_text', 'single_choice', 'multiple_choice'] as RegistrationDynamicQuestion['type'][]).map((type, index) => ({
      ...DEFAULT_REGISTRATION_FORM,
      questions: [question({
        id: `11111111-1111-4111-8111-11111111111${index}`,
        type,
        order: 0,
        validation: type === 'single_choice' || type === 'multiple_choice' ? {} : { maxLength: 120 },
        ...(type === 'single_choice' || type === 'multiple_choice' ? {
          options: [{ id: '22222222-2222-4222-8222-222222222222', value: 'yes', label: '是' }],
        } : {}),
      })],
    } as RegistrationForm))

    for (const form of forms) expect(RegistrationFormSchema.safeParse(form).success).toBe(true)
  })

  it.each([
    ['duplicate question ids', { questions: [question(), question({ order: 1 })] }],
    ['non-contiguous question order', { questions: [question({ order: 1 })] }],
    ['text question options', { questions: [question({ options: [] })] }],
    ['choice question without options', { questions: [question({ type: 'single_choice' })] }],
    ['duplicate option ids', { questions: [question({ type: 'single_choice', options: [
      { id: '22222222-2222-4222-8222-222222222222', value: 'a', label: 'A' },
      { id: '22222222-2222-4222-8222-222222222222', value: 'b', label: 'B' },
    ] })] }],
  ])('rejects %s', (_name, overrides) => {
    expect(RegistrationFormSchema.safeParse({ ...DEFAULT_REGISTRATION_FORM, ...overrides }).success).toBe(false)
  })
})
