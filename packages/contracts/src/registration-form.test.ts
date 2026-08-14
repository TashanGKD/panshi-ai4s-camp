import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REGISTRATION_ATTACHMENT_ID,
  DEFAULT_REGISTRATION_FORM,
  REGISTRATION_FORM_LIMITS,
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

    expect(parsed.coreFields).toEqual(DEFAULT_REGISTRATION_FORM.coreFields)
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]).toMatchObject({
      id: DEFAULT_REGISTRATION_ATTACHMENT_ID,
      label: '个人简历／补充材料',
      required: false,
      active: true,
      allowedExtensions: ['pdf', 'docx'],
    })
  })

  it('rejects any direct change to a fixed core field definition', () => {
    for (const change of [
      (form: RegistrationForm) => ({ ...form, coreFields: form.coreFields.map((field) => field.key === 'name' ? { ...field, label: '可改姓名' } : field) }),
      (form: RegistrationForm) => ({ ...form, coreFields: [...form.coreFields].reverse() }),
      (form: RegistrationForm) => ({ ...form, coreFields: form.coreFields.map((field) => field.key === 'phone' ? { ...field, readOnly: false } : field) }),
    ]) {
      expect(RegistrationFormSchema.safeParse(change(DEFAULT_REGISTRATION_FORM)).success).toBe(false)
    }
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

  it('accepts the conservative collection and text boundaries', () => {
    const questions = Array.from({ length: REGISTRATION_FORM_LIMITS.maxQuestions }, (_, index) => question({
      id: `11111111-1111-4111-8111-${(index + 1).toString().padStart(12, '0')}`,
      order: index,
    }))
    const options = Array.from({ length: REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion }, (_, index) => ({
      id: `22222222-2222-4222-8222-${(index + 1).toString().padStart(12, '0')}`,
      value: `value-${index}`,
      label: `选项 ${index}`,
    }))
    const form = {
      ...DEFAULT_REGISTRATION_FORM,
      questions: [
        ...questions.slice(0, REGISTRATION_FORM_LIMITS.maxQuestions - 1),
        question({
          id: '11111111-1111-4111-8111-000000000050',
          order: REGISTRATION_FORM_LIMITS.maxQuestions - 1,
          label: 'x'.repeat(REGISTRATION_FORM_LIMITS.labelMaxLength),
          helpText: 'x'.repeat(REGISTRATION_FORM_LIMITS.helpTextMaxLength),
          validation: { minLength: REGISTRATION_FORM_LIMITS.textMaxLength, maxLength: REGISTRATION_FORM_LIMITS.textMaxLength },
        }),
      ],
      attachments: Array.from({ length: REGISTRATION_FORM_LIMITS.maxAttachments }, (_, index) => ({
        ...DEFAULT_REGISTRATION_FORM.attachments[0]!,
        id: `33333333-3333-4333-8333-${(index + 1).toString().padStart(12, '0')}`,
        order: index,
        label: 'x'.repeat(REGISTRATION_FORM_LIMITS.labelMaxLength),
        helpText: 'x'.repeat(REGISTRATION_FORM_LIMITS.helpTextMaxLength),
      })),
    }
    const choiceQuestion = question({
      id: '11111111-1111-4111-8111-000000000051',
      type: 'single_choice',
      order: 0,
      validation: {},
      options: options.map((option) => ({
        ...option,
        value: 'v'.repeat(REGISTRATION_FORM_LIMITS.optionValueMaxLength - option.value.length) + option.value,
        label: 'l'.repeat(REGISTRATION_FORM_LIMITS.optionLabelMaxLength - option.label.length) + option.label,
      })),
    })
    const boundaryForm = { ...form, questions: [choiceQuestion] }

    expect(RegistrationFormSchema.safeParse(boundaryForm).success).toBe(true)
  })

  it.each([
    ['too many questions', { questions: Array.from({ length: REGISTRATION_FORM_LIMITS.maxQuestions + 1 }, (_, index) => question({ id: `11111111-1111-4111-8111-${(index + 1).toString().padStart(12, '0')}`, order: index })) }, 'questions'],
    ['too many attachments', { attachments: Array.from({ length: REGISTRATION_FORM_LIMITS.maxAttachments + 1 }, (_, index) => ({ ...DEFAULT_REGISTRATION_FORM.attachments[0]!, id: `33333333-3333-4333-8333-${(index + 1).toString().padStart(12, '0')}`, order: index })) }, 'attachments'],
    ['too many options', { questions: [question({ type: 'single_choice', validation: {}, options: Array.from({ length: REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion + 1 }, (_, index) => ({ id: `22222222-2222-4222-8222-${(index + 1).toString().padStart(12, '0')}`, value: `v-${index}`, label: `选项 ${index}` })) })] }, 'questions.0.options'],
    ['label over maximum', { questions: [question({ label: 'x'.repeat(REGISTRATION_FORM_LIMITS.labelMaxLength + 1) })] }, 'questions.0.label'],
    ['helpText over maximum', { questions: [question({ helpText: 'x'.repeat(REGISTRATION_FORM_LIMITS.helpTextMaxLength + 1) })] }, 'questions.0.helpText'],
    ['option value over maximum', { questions: [question({ type: 'single_choice', validation: {}, options: [{ id: '22222222-2222-4222-8222-222222222222', value: 'x'.repeat(REGISTRATION_FORM_LIMITS.optionValueMaxLength + 1), label: '选项' }] })] }, 'questions.0.options.0.value'],
    ['option label over maximum', { questions: [question({ type: 'single_choice', validation: {}, options: [{ id: '22222222-2222-4222-8222-222222222222', value: 'option', label: 'x'.repeat(REGISTRATION_FORM_LIMITS.optionLabelMaxLength + 1) }] })] }, 'questions.0.options.0.label'],
    ['text minLength over maximum', { questions: [question({ validation: { minLength: REGISTRATION_FORM_LIMITS.textMaxLength + 1 } })] }, 'questions.0.validation.minLength'],
    ['text maxLength over maximum', { questions: [question({ validation: { maxLength: REGISTRATION_FORM_LIMITS.textMaxLength + 1 } })] }, 'questions.0.validation.maxLength'],
  ])('rejects %s with a bounded schema path', (_name, overrides, path) => {
    const result = RegistrationFormSchema.safeParse({ ...DEFAULT_REGISTRATION_FORM, ...overrides })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join('.') === path)).toBe(true)
  })
})
