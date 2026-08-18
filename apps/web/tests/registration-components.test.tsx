import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { REGISTRATION_PROFICIENCY_LEVELS, type InstitutionDirectoryResponse, type RegistrationDynamicQuestion } from '@panshi/contracts'
import { CoreFields } from '../src/features/registration/CoreFields'
import { DynamicQuestion } from '../src/features/registration/DynamicQuestion'

const base = (type: 'short_text' | 'long_text' | 'single_choice' | 'multiple_choice'): RegistrationDynamicQuestion => {
  const common = {
    id: '11111111-1111-4111-8111-111111111111', label: `${type} 问题`, helpText: '说明文字', required: true,
    order: 0, active: true,
  }
  if (type === 'single_choice' || type === 'multiple_choice') return {
    ...common, type,
    validation: {}, options: [
      { id: '22222222-2222-4222-8222-222222222222', value: 'a', label: '选项 A' },
      { id: '33333333-3333-4333-8333-333333333333', value: 'b', label: '选项 B' },
    ],
  }
  return { ...common, type, validation: { minLength: 2, maxLength: 120 } }
}

describe('registration renderers', () => {
  const directory: InstitutionDirectoryResponse['data'] = {
    version: 'test',
    sources: [
      { label: '高校', href: 'https://example.org/a', asOf: '2025-06-20' },
      { label: '培养单位', href: 'https://example.org/b', asOf: '2026-08-18' },
    ],
    universities: [
      { name: '北京大学', province: '北京市', level: '本科' },
      { name: '中国科学院大学', province: '北京市', level: '本科' },
    ],
    ucasTrainingUnits: [
      { name: '中国科学院物理研究所', type: 'institute' },
      { name: '中国科学院大学物理科学学院', type: 'college' },
    ],
  }
  it.each(['short_text', 'long_text', 'single_choice', 'multiple_choice'] as const)('renders %s as a labeled field', (type) => {
    render(<DynamicQuestion question={base(type)} value={type === 'multiple_choice' ? [] : ''} onChange={() => undefined} />)
    expect(screen.getByText(`${type} 问题`)).toBeInTheDocument()
    expect(screen.getByText('说明文字')).toBeInTheDocument()
    expect(screen.getByText('必填')).toBeInTheDocument()
  })

  it('renders a fixed +86 phone prefix, local mobile number, and optional email', () => {
    render(<CoreFields values={{}} phone="+8613800138000" directory={directory} onChange={() => undefined} />)
    expect(screen.getByText('+86')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByLabelText('手机号')).toHaveValue('13800138000')
    expect(screen.getByLabelText('手机号')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('电子邮箱')).not.toBeRequired()
    expect(screen.getByLabelText('姓名')).toBeInTheDocument()
    expect(screen.getByLabelText('当前身份')).toBeInTheDocument()
    expect(screen.queryByLabelText('所在学校')).not.toBeInTheDocument()
  })

  it('uses identity-first student fields and reveals a searchable UCAS training-unit field', () => {
    const change = vi.fn()
    const { rerender } = render(<CoreFields values={{ identityType: '博士研究生', organization: '' }} phone="+8613800138000" directory={directory} onChange={change} />)
    const organization = screen.getByRole('combobox', { name: '所在学校' })
    fireEvent.change(organization, { target: { value: '国科大' } })
    expect(screen.getByRole('option', { name: /中国科学院大学/u })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('option', { name: /中国科学院大学/u }))
    expect(change).toHaveBeenCalledWith('organization', '中国科学院大学')

    rerender(<CoreFields values={{ identityType: '博士研究生', organization: '中国科学院大学', department: '' }} phone="+8613800138000" directory={directory} onChange={change} />)
    const trainingUnit = screen.getByRole('combobox', { name: '培养单位' })
    fireEvent.change(trainingUnit, { target: { value: '物理' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '中国科学院物理研究所',
      '中国科学院大学物理科学学院',
    ])
  })

  it('allows applicants to browse every university when no search text is entered', () => {
    const completeDirectory: InstitutionDirectoryResponse['data'] = {
      ...directory,
      universities: Array.from({ length: 60 }, (_, index) => ({
        name: `测试大学${String(index + 1).padStart(2, '0')}`,
        province: '测试省',
        level: '本科',
      })),
    }
    render(<CoreFields values={{ identityType: '本科生', organization: '' }} phone="+8613800138000" directory={completeDirectory} onChange={() => undefined} />)
    fireEvent.focus(screen.getByRole('combobox', { name: '所在学校' }))
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: '测试大学60' })).toBeInTheDocument()
  })

  it('shows role-appropriate fields for employed applicants', () => {
    render(<CoreFields values={{ identityType: '在职人员' }} phone="+8613800138000" directory={directory} onChange={() => undefined} />)
    expect(screen.getByLabelText('工作单位')).toBeInTheDocument()
    expect(screen.getByLabelText('职务／岗位')).toBeRequired()
    expect(screen.getByLabelText('专业技术职称等级')).not.toBeRequired()
    expect(screen.queryByLabelText('专业')).not.toBeInTheDocument()
  })

  it('renders the three-level proficiency matrix and a free-text-only other row', () => {
    const question: RegistrationDynamicQuestion = {
      id: '11111111-1111-4111-8111-111111111111', type: 'proficiency_matrix', label: '能力基础', helpText: '', required: true,
      order: 0, active: true, validation: {}, allowOther: true,
      items: [{ id: '22222222-2222-4222-8222-222222222222', value: 'python', label: 'Python' }],
      levels: REGISTRATION_PROFICIENCY_LEVELS.map((level, index) => ({ id: `33333333-3333-4333-8333-33333333333${index}`, ...level })),
    }
    const change = vi.fn()
    render(<DynamicQuestion question={question} value={{ ratings: {}, otherLabel: '', otherLevel: '' }} onChange={change} />)
    const pythonRow = screen.getByRole('radiogroup', { name: 'Python' })
    expect(pythonRow).toBeInTheDocument()
    expect(screen.getByLabelText('其他能力')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: '其他能力等级' })).not.toBeInTheDocument()
    fireEvent.click(within(pythonRow).getByRole('radio', { name: '了解并会简单使用' }))
    expect(change).toHaveBeenCalledWith({ ratings: { python: 'basic' }, otherLabel: '', otherLevel: '' })
  })

  it('shows academic problem descriptions and prevents selecting more than three', () => {
    const question: RegistrationDynamicQuestion = {
      id: '11111111-1111-4111-8111-111111111111', type: 'multiple_choice', label: '问题池', helpText: '说明文字', required: true, order: 0, active: true,
      validation: { minSelections: 1, maxSelections: 3 },
      options: ['a', 'b', 'c', 'd'].map((value, index) => ({
        id: `22222222-2222-4222-8222-22222222222${index}`,
        value,
        label: `题目 ${value}`,
        description: `题目 ${value} 的学术介绍。`,
      })),
    }
    render(<DynamicQuestion question={question} value={['a', 'b', 'c']} onChange={() => undefined} />)
    expect(screen.getByText('题目 a 的学术介绍。')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /题目 d/u })).toBeDisabled()
    expect(screen.getByText('已选择 3/3 项')).toBeInTheDocument()
  })

  it('applies minimum and maximum length constraints to text controls', () => {
    const { rerender } = render(<DynamicQuestion question={base('short_text')} value="" onChange={() => undefined} />)
    expect(screen.getByRole('textbox')).toHaveAttribute('minlength', '2')
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '120')
    rerender(<DynamicQuestion question={base('long_text')} value="" onChange={() => undefined} />)
    expect(screen.getByRole('textbox')).toHaveAttribute('minlength', '2')
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '120')
  })

  it('exposes a required multiple-choice group and validates the empty group', () => {
    const { rerender } = render(<DynamicQuestion question={base('multiple_choice')} value={[]} onChange={() => undefined} />)
    const group = screen.getByRole('group', { name: /multiple_choice 问题/u })
    expect(group).toHaveAttribute('aria-required', 'true')
    expect(within(group).getAllByRole('checkbox')[0]).toBeRequired()
    rerender(<DynamicQuestion question={base('multiple_choice')} value={['b']} onChange={() => undefined} />)
    expect(within(screen.getByRole('group', { name: /multiple_choice 问题/u })).getAllByRole('checkbox')[0]).not.toBeRequired()
  })
})
