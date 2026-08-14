import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REGISTRATION_FORM } from '@panshi/contracts'
import type { AdminClient } from '../src/api/admin-client'
import { RegistrationFormPage } from '../src/pages/RegistrationFormPage'

afterEach(cleanup)

describe('RegistrationFormPage', () => {
  it('shows fixed fields, structured question controls, attachment controls, and a preview without JSON textarea', async () => {
    const client = {
      getRegistrationFormDraft: async () => ({ apiVersion: 'v1' as const, data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
      getRegistrationFormHistory: async () => ({ apiVersion: 'v1' as const, data: { publishedVersion: null, versions: [] } }),
    } as Pick<AdminClient, 'getRegistrationFormDraft' | 'getRegistrationFormHistory'>
    render(<MemoryRouter><RegistrationFormPage client={client as AdminClient} /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: '表单配置' })).toBeInTheDocument()
    expect(screen.getByText('固定字段')).toBeInTheDocument()
    expect(screen.getByText('个人简历／补充材料')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新增问题' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /JSON/u })).not.toBeInTheDocument()
  })

  it('edits a structured question, saves before publishing, and keeps editor ids stable', async () => {
    const saveDraft = vi.fn(async (form: typeof DEFAULT_REGISTRATION_FORM) => ({ apiVersion: 'v1' as const, data: { form, revision: 1, baseVersion: null, publishedVersionId: null } }))
    const publish = vi.fn(async () => ({ apiVersion: 'v1' as const, data: { formVersionId: '00000000-0000-4000-8000-000000000020', revision: 1, version: 1 } }))
    const client = {
      getRegistrationFormDraft: async () => ({ apiVersion: 'v1' as const, data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
      getRegistrationFormHistory: async () => ({ apiVersion: 'v1' as const, data: { publishedVersion: null, versions: [] } }),
      saveRegistrationFormDraft: saveDraft,
      publishRegistrationForm: publish,
    } as unknown as AdminClient
    render(<MemoryRouter><RegistrationFormPage client={client} /></MemoryRouter>)
    await screen.findByRole('heading', { name: '表单配置' })
    fireEvent.click(screen.getByRole('button', { name: '新增问题' }))
    const label = screen.getByLabelText('问题 1 题目')
    const idBeforeSave = label.getAttribute('id')
    expect(screen.getByRole('button', { name: '发布当前草稿' })).toBeDisabled()
    fireEvent.change(label, { target: { value: '研究方向' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('问题 1 题目')).toHaveAttribute('id', idBeforeSave)
    fireEvent.click(screen.getByRole('button', { name: '发布当前草稿' }))
    await waitFor(() => expect(publish).toHaveBeenCalledOnce())
  })
})
