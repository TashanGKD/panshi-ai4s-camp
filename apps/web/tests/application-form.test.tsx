import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_REGISTRATION_FORM, type MyApplicationResponse, type RegistrationForm } from '@panshi/contracts'
import { ApplicationForm } from '../src/features/registration/ApplicationForm'

const q = '20000000-0000-4000-8000-000000000001'
const slot = '20000000-0000-4000-8000-000000000002'
const form: RegistrationForm = { ...DEFAULT_REGISTRATION_FORM, questions: [{ id: q, type: 'short_text', label: '研究问题', helpText: '', required: true, order: 0, active: true, validation: { minLength: 2, maxLength: 20 } }], attachments: [{ id: slot, label: '简历', helpText: 'PDF', required: true, order: 0, active: true, allowedExtensions: ['pdf'], maxSizeBytes: 1000 }] }
const profile = { name: '张三', phone: '+8613800138000', email: '', organization: '', department: '', identityType: '', educationStage: '', majorResearchDirection: '', major: '', researchInterest: '', researchDirection: '', postdocStation: '', disciplineField: '', supervisor: '', jobPosition: '', professionalTitleLevel: '', specificTitle: '', identityDescription: '' }
const draftProfile = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'phone')) as Omit<typeof profile, 'phone'>
const application = { id: '10000000-0000-4000-8000-000000000001', status: 'draft', revision: 0, locked: false, formVersionId: '30000000-0000-4000-8000-000000000001', formVersion: 1, form, profile, answers: {}, attachments: [], unlinkedAttachments: [], retiredAnswerIds: [], submittedAt: null, updatedAt: '2026-08-15T00:00:00.000Z' } satisfies MyApplicationResponse['data']['application']

describe('ApplicationForm', () => {
  it('keeps phone read-only and emits dynamic answers without interpreting HTML', () => {
    const change = vi.fn()
    render(<ApplicationForm application={application} draft={{ profile: draftProfile, answers: {}, attachments: [] }} disabled={false} errors={{}} onChange={change} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByLabelText('手机号')).toHaveAttribute('readonly')
    fireEvent.change(screen.getByLabelText(/研究问题/u), { target: { value: '<img src=x onerror=alert(1)>' } })
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ answers: { [q]: '<img src=x onerror=alert(1)>' } }))
    expect(document.querySelector('img')).toBeNull()
  })
  it('renders submitted applications as disabled and shows field errors', () => {
    render(<ApplicationForm application={{ ...application, status: 'submitted', locked: true }} draft={{ profile: draftProfile, answers: {}, attachments: [] }} disabled errors={{ [`answers.${q}`]: '此项为必填项' }} onChange={vi.fn()} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByLabelText(/研究问题/u)).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('此项为必填项')
  })
  it('shows an unlinked legacy attachment with download and explicit deletion controls', () => {
    const remove = vi.fn()
    render(<ApplicationForm application={{ ...application, unlinkedAttachments: [{ id: '40000000-0000-4000-8000-000000000001', originalName: '旧简历.pdf', mimeType: 'application/pdf', sizeBytes: 10, downloadUrl: '/api/v1/files/40000000-0000-4000-8000-000000000001/download' }] }} draft={{ profile: draftProfile, answers: {}, attachments: [] }} disabled={false} errors={{}} onChange={vi.fn()} onUpload={vi.fn()} onRemove={vi.fn()} onRemoveUnlinked={remove} />)
    expect(screen.getByRole('link', { name: '旧简历.pdf' })).toHaveAttribute('href', '/api/v1/files/40000000-0000-4000-8000-000000000001/download')
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(remove).toHaveBeenCalledWith('40000000-0000-4000-8000-000000000001')
  })

  it('reveals the problem pool only for open practice and reveals the custom input only after choosing other', () => {
    const willingness = '20000000-0000-4000-8000-000000000011'
    const problems = '20000000-0000-4000-8000-000000000012'
    const custom = '20000000-0000-4000-8000-000000000013'
    const conditionalForm = {
      ...DEFAULT_REGISTRATION_FORM,
      questions: [
        { id: willingness, type: 'multiple_choice', label: '参与意愿', helpText: '', required: true, order: 0, active: true, validation: {}, options: [
          { id: '21000000-0000-4000-8000-000000000001', value: 'open-practice', label: '开放实践' },
          { id: '21000000-0000-4000-8000-000000000002', value: 'not-yet', label: '暂不确定' },
        ] },
        { id: problems, type: 'multiple_choice', label: '问题池', helpText: '', required: true, order: 1, active: true, validation: { minSelections: 1, maxSelections: 3 }, visibleWhen: { questionId: willingness, includes: 'open-practice' }, options: [
          { id: '21000000-0000-4000-8000-000000000003', value: 'problem-1', label: '问题一' },
          { id: '21000000-0000-4000-8000-000000000004', value: 'other-problem', label: '其他问题' },
        ] },
        { id: custom, type: 'long_text', label: '请填写自己的问题', helpText: '', required: true, order: 2, active: true, validation: {}, visibleWhen: { questionId: problems, includes: 'other-problem' } },
      ],
    } as RegistrationForm
    const conditionalApplication = { ...application, form: conditionalForm }
    const { rerender } = render(<ApplicationForm application={conditionalApplication} draft={{ profile: draftProfile, answers: {}, attachments: [] }} disabled={false} errors={{}} onChange={vi.fn()} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.queryByText('问题池')).not.toBeInTheDocument()

    rerender(<ApplicationForm application={conditionalApplication} draft={{ profile: draftProfile, answers: { [willingness]: ['open-practice'] }, attachments: [] }} disabled={false} errors={{}} onChange={vi.fn()} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('问题池')).toBeInTheDocument()
    expect(screen.queryByLabelText('请填写自己的问题')).not.toBeInTheDocument()

    rerender(<ApplicationForm application={conditionalApplication} draft={{ profile: draftProfile, answers: { [willingness]: ['open-practice'], [problems]: ['other-problem'] }, attachments: [] }} disabled={false} errors={{}} onChange={vi.fn()} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: /请填写自己的问题/u })).toBeInTheDocument()
  })
})
