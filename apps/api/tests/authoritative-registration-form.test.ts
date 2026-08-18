import { RegistrationFormSchema } from '@panshi/contracts'
import { describe, expect, it } from 'vitest'
import { authoritativeRegistrationForm } from '../src/db/seeds/authoritative-registration-form.js'

describe('authoritative registration form', () => {
  it('contains the approved structured background and complete AI4S problem pool', () => {
    const form = RegistrationFormSchema.parse(authoritativeRegistrationForm)

    expect(form.questions.map(({ label }) => label)).toEqual([
      '编程、数据分析和人工智能基础',
      '已有科研、竞赛、工程或项目经历',
      '感兴趣的课程专题',
      '是否可以线下参加实训',
      '是否愿意参加晚间研讨、开放实践及实训营后的持续项目研究',
      '从实训营问题池中选择 1—3 个 AI4S 问题',
      '本人希望提出和研讨的科研问题',
      '对课程的主要预期',
    ])
    expect(form.coreFields.find((field) => field.key === 'email')).toMatchObject({ required: false })
    expect(form.questions[3]).toMatchObject({
      type: 'single_choice', required: true,
      options: [
        expect.objectContaining({ value: 'yes', label: '是' }),
        expect.objectContaining({ value: 'no', label: '否' }),
      ],
    })
    const proficiency = form.questions[0]
    expect(proficiency).toMatchObject({ type: 'proficiency_matrix', required: true, allowOther: true })
    if (proficiency?.type !== 'proficiency_matrix') throw new Error('expected proficiency matrix')
    expect(proficiency.items.map(({ label }) => label)).toEqual([
      'Python', 'C/C++', 'R', 'MATLAB', 'SQL/数据库', 'Linux/Shell', 'Git/版本控制',
      '数据分析与可视化', '机器学习/深度学习', '大语言模型', '智能体开发',
    ])
    expect(proficiency.levels.map(({ label }) => label)).toEqual(['不了解', '了解并会简单使用', '熟练使用并掌握相关原理'])

    expect(form.questions[1]).toMatchObject({ required: false })
    const willingness = form.questions[4]
    expect(willingness).toMatchObject({
      type: 'multiple_choice', required: true,
      options: [
        expect.objectContaining({ value: 'evening-seminar', label: '晚间研讨' }),
        expect.objectContaining({ value: 'open-practice', label: '开放实践' }),
        expect.objectContaining({ value: 'continued-research', label: '持续项目研究' }),
        expect.objectContaining({ value: 'not-yet', label: '暂不确定' }),
      ],
    })
    const problem = form.questions[5]
    expect(problem).toMatchObject({
      type: 'multiple_choice', required: true,
      helpText: '最希望在实训营中了解、研讨或继续研究的问题。 请选择 1—3 项，或提出自己的问题',
      validation: { minSelections: 1, maxSelections: 3 },
      visibleWhen: { questionId: willingness?.id, includes: 'open-practice' },
    })
    if (problem?.type !== 'multiple_choice') throw new Error('expected problem choice')
    expect(problem.options).toHaveLength(20)
    expect(problem.options.slice(0, 19).every(({ description }) => Boolean(description?.trim()))).toBe(true)
    expect(problem.options[19]).toMatchObject({ value: 'other-problem', label: '其他：本人希望提出和研讨的科研问题' })
    expect(problem.options.slice(8, 11).map(({ label }) => label)).toEqual([
      '（产业赛题）数据共情者——面向消费者需求理解的 AI 管家',
      '（产业赛题）信任守护师——面向美妆内容真实性识别的 AI 卫士',
      '（产业赛题）无界体验家——人工智能驱动的未来美妆体验',
    ])
    expect(form.questions[6]).toMatchObject({
      type: 'long_text', required: true, validation: {},
      visibleWhen: { questionId: problem.id, includes: 'other-problem' },
    })
    expect(form.questions[7]).toMatchObject({ type: 'long_text', required: false, validation: {} })
    expect(form.attachments).toEqual([expect.objectContaining({ label: '个人简历／补充材料', required: false, allowedExtensions: ['pdf', 'docx', 'jpg'] })])
  })
})
