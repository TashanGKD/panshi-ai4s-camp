import { describe, expect, it } from 'vitest'
import {
  ApplicationAnswersSchema,
  ApplicationCoreFieldsSchema,
  DEFAULT_REGISTRATION_ATTACHMENT_ID,
  DEFAULT_REGISTRATION_FORM,
  InstitutionDirectoryResponseSchema,
  REGISTRATION_FORM_LIMITS,
  RegistrationFormSchema,
  RegistrationDynamicQuestionSchema,
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
  it('accepts a versioned institution directory and rejects duplicate names', () => {
    const directory = {
      apiVersion: 'v1',
      data: {
        version: 'moe-2025-06-20_ucas-2026-08-18',
        sources: [
          { label: '教育部全国普通高等学校名单', href: 'https://www.moe.gov.cn/', asOf: '2025-06-20' },
          { label: '中国科学院大学培养单位', href: 'https://www.ucas.ac.cn/', asOf: '2026-08-18' },
        ],
        universities: [
          { name: '中国科学院大学', province: '北京市', level: '本科' },
          { name: '北京大学', province: '北京市', level: '本科' },
        ],
        ucasTrainingUnits: [
          { name: '中国科学院大学物理科学学院', type: 'college' },
          { name: '中国科学院物理研究所', type: 'institute' },
        ],
      },
    }

    expect(InstitutionDirectoryResponseSchema.parse(directory)).toEqual(directory)
    expect(InstitutionDirectoryResponseSchema.safeParse({
      ...directory,
      data: { ...directory.data, universities: [...directory.data.universities, directory.data.universities[0]] },
    }).success).toBe(false)
    expect(InstitutionDirectoryResponseSchema.safeParse({
      ...directory,
      data: { ...directory.data, ucasTrainingUnits: [...directory.data.ucasTrainingUnits, directory.data.ucasTrainingUnits[0]] },
    }).success).toBe(false)
  })

  it('keeps the fixed core fields and deterministic default attachment', () => {
    const parsed = RegistrationFormSchema.parse(DEFAULT_REGISTRATION_FORM)

    expect(parsed.coreFields).toEqual(DEFAULT_REGISTRATION_FORM.coreFields)
    expect(parsed.coreFields.find((field) => field.key === 'email')).toMatchObject({ required: false })
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

  it('upgrades legacy application profiles with empty conditional fields', () => {
    expect(ApplicationCoreFieldsSchema.parse({
      name: '', phone: '+8613800138000', email: '', organization: '', department: '',
      identityType: '', educationStage: '', majorResearchDirection: '',
    })).toMatchObject({
      major: '', researchInterest: '', researchDirection: '', postdocStation: '',
      disciplineField: '', supervisor: '', jobPosition: '', professionalTitleLevel: '',
      specificTitle: '', identityDescription: '',
    })
  })

  it('accepts described choices with bounded selections', () => {
    const parsed = RegistrationDynamicQuestionSchema.parse(question({
      type: 'multiple_choice',
      validation: { minSelections: 1, maxSelections: 3 },
      options: [
        { id: '22222222-2222-4222-8222-222222222221', value: 'problem-1', label: '问题一', description: '问题简介。' },
        { id: '22222222-2222-4222-8222-222222222222', value: 'problem-2', label: '问题二', description: '问题简介。' },
        { id: '22222222-2222-4222-8222-222222222223', value: 'problem-3', label: '问题三', description: '问题简介。' },
      ],
    }))
    if (parsed.type !== 'multiple_choice') throw new Error('expected multiple choice')
    expect(parsed.validation).toEqual({ minSelections: 1, maxSelections: 3 })
    expect(parsed.options[0]).toMatchObject({ description: '问题简介。' })
  })

  it('accepts a visibility condition that points to an earlier choice question', () => {
    const controller = question({
      type: 'multiple_choice',
      options: [{ id: '22222222-2222-4222-8222-222222222221', value: 'open', label: '开放实践' }],
      validation: {},
    })
    const dependent = question({
      id: '11111111-1111-4111-8111-111111111112',
      order: 1,
      visibleWhen: { questionId: controller.id, includes: 'open' },
    })

    expect(RegistrationFormSchema.safeParse({ ...DEFAULT_REGISTRATION_FORM, questions: [controller, dependent] }).success).toBe(true)
    expect(RegistrationFormSchema.safeParse({ ...DEFAULT_REGISTRATION_FORM, questions: [dependent, controller] }).success).toBe(false)
  })

  it('accepts a proficiency matrix question and structured answer', () => {
    expect(RegistrationDynamicQuestionSchema.parse(question({
      type: 'proficiency_matrix', validation: {}, allowOther: true,
      items: [{ id: '22222222-2222-4222-8222-222222222222', value: 'python', label: 'Python' }],
      levels: [
        { id: '33333333-3333-4333-8333-333333333331', value: 'unfamiliar', label: '不了解' },
        { id: '33333333-3333-4333-8333-333333333332', value: 'basic', label: '了解并会简单使用' },
        { id: '33333333-3333-4333-8333-333333333333', value: 'proficient', label: '熟练使用并掌握相关原理' },
      ],
    }))).toMatchObject({ type: 'proficiency_matrix', allowOther: true })
    expect(ApplicationAnswersSchema.safeParse({
      '11111111-1111-4111-8111-111111111111': {
        ratings: { python: 'basic' }, otherLabel: 'Fortran', otherLevel: 'proficient',
      },
    }).success).toBe(true)
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
    ['attachment label over maximum', { attachments: [{ ...DEFAULT_REGISTRATION_FORM.attachments[0]!, label: 'x'.repeat(REGISTRATION_FORM_LIMITS.labelMaxLength + 1) }] }, 'attachments.0.label'],
    ['attachment helpText over maximum', { attachments: [{ ...DEFAULT_REGISTRATION_FORM.attachments[0]!, helpText: 'x'.repeat(REGISTRATION_FORM_LIMITS.helpTextMaxLength + 1) }] }, 'attachments.0.helpText'],
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
