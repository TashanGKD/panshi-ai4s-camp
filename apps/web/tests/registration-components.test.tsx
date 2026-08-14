import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RegistrationDynamicQuestion } from '@panshi/contracts'
import { CoreFields } from '../src/features/registration/CoreFields'
import { DynamicQuestion } from '../src/features/registration/DynamicQuestion'

const base = (type: RegistrationDynamicQuestion['type']): RegistrationDynamicQuestion => {
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
  it.each(['short_text', 'long_text', 'single_choice', 'multiple_choice'] as const)('renders %s as a labeled field', (type) => {
    render(<DynamicQuestion question={base(type)} value={type === 'multiple_choice' ? [] : ''} onChange={() => undefined} />)
    expect(screen.getByText(`${type} 问题`)).toBeInTheDocument()
    expect(screen.getByText('说明文字')).toBeInTheDocument()
    expect(screen.getByText('必填')).toBeInTheDocument()
  })

  it('renders core fields independently and keeps the caller-provided phone read-only', () => {
    render(<CoreFields values={{}} phone="+8613800138000" onChange={() => undefined} />)
    expect(screen.getByLabelText('手机号')).toHaveValue('+8613800138000')
    expect(screen.getByLabelText('手机号')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('姓名')).toBeInTheDocument()
    expect(screen.getByLabelText('专业及研究方向')).toBeInTheDocument()
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
