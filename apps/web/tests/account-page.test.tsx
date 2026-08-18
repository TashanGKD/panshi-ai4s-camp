import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountPage } from '../src/pages/AccountPage'
import { applicationClient } from '../src/api/application-client'

vi.mock('../src/api/application-client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/application-client')>('../src/api/application-client')
  return { ...actual, applicationClient: { getMine: vi.fn(), getInstitutions: vi.fn(), getCheckIn: vi.fn(), logout: vi.fn() } }
})
vi.mock('../src/api/auth-client', () => ({ changeStudentPassword: vi.fn(), logoutStudent: vi.fn() }))

afterEach(() => { cleanup(); vi.clearAllMocks() })
const profile = { name: '郑博元', phone: '+8618811132625', email: '', organization: '中国科学院大学', department: '中国科学院物理研究所', identityType: '博士研究生', educationStage: '博士研究生', majorResearchDirection: '凝聚态物理', major: '物理学', researchInterest: '', researchDirection: '凝聚态物理', postdocStation: '', disciplineField: '', supervisor: '', jobPosition: '', professionalTitleLevel: '', specificTitle: '', identityDescription: '' }
const response = (status: 'submitted' | 'admitted' = 'submitted') => ({ apiVersion: 'v1', data: { application: { id: '20000000-0000-4000-8000-000000000001', revision: 2, status, locked: true, formVersionId: '30000000-0000-4000-8000-000000000001', formVersion: 1, form: { version: 1, title: '报名表', description: '', sections: [], questions: [], attachments: [] }, profile, answers: {}, attachments: [], unlinkedAttachments: [], retiredAnswerIds: [], submittedAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' }, timeline: [{ status: 'submitted', createdAt: '2026-08-18T00:00:00.000Z', publicReason: null }], supplementRequest: null, accessibleResources: [] } })
const directory = { apiVersion: 'v1', data: { version: 'test', sources: [{ label: 'a', href: 'https://a.example', asOf: '2026-08-18' }, { label: 'b', href: 'https://b.example', asOf: '2026-08-18' }], universities: [{ name: '中国科学院大学', province: '北京', level: '本科' }], ucasTrainingUnits: [{ name: '中国科学院物理研究所', type: 'institute' }] } }

describe('student account center', () => {
  it('renders one-row profile fields and gates the QR code until admission', async () => {
    vi.mocked(applicationClient.getMine).mockResolvedValue(response() as never)
    vi.mocked(applicationClient.getInstitutions).mockResolvedValue(directory as never)
    vi.mocked(applicationClient.getCheckIn).mockResolvedValue({ apiVersion: 'v1', data: { availability: 'unavailable', reason: '未录取' } })
    render(<MemoryRouter><AccountPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '个人信息' })).toBeVisible()
    const name = screen.getByText('姓名').closest('div')
    expect(name).toHaveTextContent('姓名郑博元')
    fireEvent.click(screen.getByRole('button', { name: '报到二维码' }))
    expect(screen.getByText('暂未开放报到码')).toBeVisible()
  })

  it('uses the application form as the only profile editing entry', async () => {
    vi.mocked(applicationClient.getMine).mockResolvedValue(response() as never)
    vi.mocked(applicationClient.getInstitutions).mockResolvedValue(directory as never)
    vi.mocked(applicationClient.getCheckIn).mockResolvedValue({ apiVersion: 'v1', data: { availability: 'unavailable', reason: '未录取' } })
    render(<MemoryRouter><AccountPage /></MemoryRouter>)
    await screen.findByRole('heading', { name: '个人信息' })
    expect(screen.queryByRole('button', { name: '编辑信息' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新提交报名信息' })).toHaveAttribute('href', '/application')
    expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument()
  })

  it('shows an admitted learner QR code', async () => {
    vi.mocked(applicationClient.getMine).mockResolvedValue(response('admitted') as never)
    vi.mocked(applicationClient.getInstitutions).mockResolvedValue(directory as never)
    vi.mocked(applicationClient.getCheckIn).mockResolvedValue({ apiVersion: 'v1', data: { availability: 'available', qrPayload: 'a'.repeat(40), displayCode: 'ABCD1234', checkedInAt: null } })
    render(<MemoryRouter><AccountPage /></MemoryRouter>)
    await screen.findByRole('heading', { name: '个人信息' })
    fireEvent.click(screen.getByRole('button', { name: '报到二维码' }))
    await waitFor(() => expect(screen.getByText('ABCD1234')).toBeVisible())
  })
})
