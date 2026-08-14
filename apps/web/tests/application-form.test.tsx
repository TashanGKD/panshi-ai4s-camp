import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_REGISTRATION_FORM, type MyApplicationResponse, type RegistrationForm } from '@panshi/contracts'
import { ApplicationForm } from '../src/features/registration/ApplicationForm'

const q = '20000000-0000-4000-8000-000000000001'
const slot = '20000000-0000-4000-8000-000000000002'
const form: RegistrationForm = { ...DEFAULT_REGISTRATION_FORM, questions: [{ id: q, type: 'short_text', label: '研究问题', helpText: '', required: true, order: 0, active: true, validation: { minLength: 2, maxLength: 20 } }], attachments: [{ id: slot, label: '简历', helpText: 'PDF', required: true, order: 0, active: true, allowedExtensions: ['pdf'], maxSizeBytes: 1000 }] }
const application = { id: '10000000-0000-4000-8000-000000000001', status: 'draft', revision: 0, locked: false, formVersionId: '30000000-0000-4000-8000-000000000001', formVersion: 1, form, profile: { name: '张三', phone: '+8613800138000', email: '', organization: '', department: '', identityType: '', educationStage: '', majorResearchDirection: '' }, answers: {}, attachments: [], retiredAnswerIds: [], submittedAt: null, updatedAt: '2026-08-15T00:00:00.000Z' } satisfies MyApplicationResponse['data']['application']

describe('ApplicationForm', () => {
  it('keeps phone read-only and emits dynamic answers without interpreting HTML', () => {
    const change = vi.fn()
    render(<ApplicationForm application={application} draft={{ profile: { name: '张三', email: '', organization: '', department: '', identityType: '', educationStage: '', majorResearchDirection: '' }, answers: {}, attachments: [] }} disabled={false} errors={{}} onChange={change} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByLabelText('手机号')).toHaveAttribute('readonly')
    fireEvent.change(screen.getByLabelText(/研究问题/u), { target: { value: '<img src=x onerror=alert(1)>' } })
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ answers: { [q]: '<img src=x onerror=alert(1)>' } }))
    expect(document.querySelector('img')).toBeNull()
  })
  it('renders submitted applications as disabled and shows field errors', () => {
    render(<ApplicationForm application={{ ...application, status: 'submitted', locked: true }} draft={{ profile: { name: '张三', email: '', organization: '', department: '', identityType: '', educationStage: '', majorResearchDirection: '' }, answers: {}, attachments: [] }} disabled errors={{ [`answers.${q}`]: '此项为必填项' }} onChange={vi.fn()} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByLabelText(/研究问题/u)).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('此项为必填项')
  })
})
