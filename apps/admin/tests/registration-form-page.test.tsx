import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REGISTRATION_FORM } from '@panshi/contracts'
import type { AdminClient } from '../src/api/admin-client'
import { AdminApiError } from '../src/api/admin-client'
import { RegistrationFormPage } from '../src/pages/RegistrationFormPage'

afterEach(cleanup)

describe('RegistrationFormPage', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve
      reject = promiseReject
    })
    return { promise, resolve, reject }
  }

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

  it('configures text limits, choice options and attachment formats without replacing stable ids', async () => {
    const saveDraft = vi.fn(async (form: typeof DEFAULT_REGISTRATION_FORM) => ({ apiVersion: 'v1' as const, data: { form, revision: 1, baseVersion: null, publishedVersionId: null } }))
    const client = {
      getRegistrationFormDraft: async () => ({ apiVersion: 'v1' as const, data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
      getRegistrationFormHistory: async () => ({ apiVersion: 'v1' as const, data: { publishedVersion: null, versions: [] } }),
      saveRegistrationFormDraft: saveDraft,
    } as unknown as AdminClient
    render(<MemoryRouter><RegistrationFormPage client={client} /></MemoryRouter>)
    await screen.findByRole('heading', { name: '表单配置' })
    fireEvent.click(screen.getByRole('button', { name: '新增问题' }))
    fireEvent.change(screen.getByLabelText('问题 1 最少字数'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('问题 1 最多字数'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1))
    expect(saveDraft.mock.calls[0]![0].questions[0]?.validation).toEqual({ minLength: 3, maxLength: 80 })
    fireEvent.change(screen.getByLabelText('问题 1 类型'), { target: { value: 'single_choice' } })
    const firstOption = screen.getByLabelText('问题 1 选项 1 标签')
    const firstOptionId = firstOption.getAttribute('data-option-id')
    fireEvent.click(screen.getByRole('button', { name: '问题 1 新增选项' }))
    expect(screen.getByLabelText('问题 1 选项 2 标签')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '问题 1 选项 2 上移' }))
    fireEvent.change(screen.getByLabelText('问题 1 类型'), { target: { value: 'multiple_choice' } })
    expect(screen.getAllByLabelText(/问题 1 选项 \d 标签/u).some((input) => input.getAttribute('data-option-id') === firstOptionId)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '问题 1 选项 2 删除' }))
    fireEvent.click(screen.getByLabelText('附件 1 允许 DOCX'))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2))
    const saved = saveDraft.mock.calls[1]![0]
    expect(saved.questions[0]?.validation).toEqual({})
    expect(saved.questions[0]?.type).toBe('multiple_choice')
    expect(saved.questions[0]?.options).toHaveLength(1)
    expect(saved.attachments[0]?.allowedExtensions).toEqual(['pdf'])
  })

  it('previews active questions and attachments with learner-facing semantics', async () => {
    const form = {
      ...DEFAULT_REGISTRATION_FORM,
      questions: [
        { id: '11111111-1111-4111-8111-111111111111', type: 'short_text' as const, label: '单行题', helpText: '单行说明', required: true, order: 0, active: true, validation: { minLength: 2, maxLength: 20 } },
        { id: '22222222-2222-4222-8222-222222222222', type: 'long_text' as const, label: '多行题', helpText: '多行说明', required: false, order: 1, active: true, validation: {} },
        { id: '33333333-3333-4333-8333-333333333333', type: 'single_choice' as const, label: '单选题', helpText: '单选说明', required: true, order: 2, active: true, validation: {}, options: [{ id: '44444444-4444-4444-8444-444444444444', value: 'a', label: '选项甲' }] },
        { id: '55555555-5555-4555-8555-555555555555', type: 'multiple_choice' as const, label: '多选题', helpText: '多选说明', required: false, order: 3, active: true, validation: {}, options: [{ id: '66666666-6666-4666-8666-666666666666', value: 'b', label: '选项乙' }] },
        { id: '77777777-7777-4777-8777-777777777777', type: 'short_text' as const, label: '停用题', helpText: '', required: false, order: 4, active: false, validation: {} },
      ],
    }
    const client = {
      getRegistrationFormDraft: async () => ({ apiVersion: 'v1' as const, data: { form, revision: 0, baseVersion: null, publishedVersionId: null } }),
      getRegistrationFormHistory: async () => ({ apiVersion: 'v1' as const, data: { publishedVersion: null, versions: [] } }),
    } as unknown as AdminClient
    render(<MemoryRouter><RegistrationFormPage client={client} /></MemoryRouter>)
    const preview = await screen.findByRole('region', { name: '预览' })
    expect(within(preview).getByRole('textbox', { name: /单行题/u })).toHaveAttribute('minlength', '2')
    expect(within(preview).getByRole('textbox', { name: /单行题/u })).toHaveAttribute('maxlength', '20')
    expect(within(preview).getByRole('textbox', { name: /多行题/u }).tagName).toBe('TEXTAREA')
    expect(within(preview).getByRole('radio', { name: '选项甲' })).toBeDisabled()
    expect(within(preview).getByRole('checkbox', { name: '选项乙' })).toBeDisabled()
    expect(within(preview).getByText(/单行说明/u)).toBeInTheDocument()
    expect(within(preview).getByText(/个人简历／补充材料/u)).toBeInTheDocument()
    expect(within(preview).queryByText('停用题')).not.toBeInTheDocument()
  })

  it('maps nested 422 errors and renders a concrete summary fallback', async () => {
    const client = {
      getRegistrationFormDraft: async () => ({ apiVersion: 'v1' as const, data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
      getRegistrationFormHistory: async () => ({ apiVersion: 'v1' as const, data: { publishedVersion: null, versions: [] } }),
      saveRegistrationFormDraft: async () => { throw new AdminApiError(422, '报名表未通过校验', 'REGISTRATION_FORM_VALIDATION_FAILED', { fields: [
        { path: 'questions.0.options.0.label', code: 'INVALID_FIELD', message: '选项标签不能为空' },
        { path: 'attachments.0.allowedExtensions', code: 'INVALID_FIELD', message: '至少选择一种格式' },
        { path: 'questions.0.id', code: 'INVALID_FIELD', message: '题目标识重复' },
      ] }) },
    } as unknown as AdminClient
    render(<MemoryRouter><RegistrationFormPage client={client} /></MemoryRouter>)
    await screen.findByRole('heading', { name: '表单配置' })
    fireEvent.click(screen.getByRole('button', { name: '新增问题' }))
    fireEvent.change(screen.getByLabelText('问题 1 类型'), { target: { value: 'single_choice' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('选项标签不能为空')
    expect(alert).toHaveTextContent('至少选择一种格式')
    expect(alert).toHaveTextContent('题目标识重复')
    expect(screen.getByLabelText('问题 1 选项 1 标签').parentElement).toHaveTextContent('选项标签不能为空')
  })

  it('does not let an older client load overwrite a newer successful load', async () => {
    const oldDraft = deferred<Awaited<ReturnType<AdminClient['getRegistrationFormDraft']>>>()
    const oldHistory = deferred<Awaited<ReturnType<AdminClient['getRegistrationFormHistory']>>>()
    const newForm = { ...DEFAULT_REGISTRATION_FORM, attachments: [{ ...DEFAULT_REGISTRATION_FORM.attachments[0]!, label: '新附件' }] }
    const oldForm = { ...DEFAULT_REGISTRATION_FORM, attachments: [{ ...DEFAULT_REGISTRATION_FORM.attachments[0]!, label: '旧附件' }] }
    const response = (form: typeof DEFAULT_REGISTRATION_FORM) => ({ apiVersion: 'v1' as const, data: { form, revision: 0, baseVersion: null, publishedVersionId: null } })
    const history = { apiVersion: 'v1' as const, data: { publishedVersion: null, versions: [] } }
    const oldClient = {
      getRegistrationFormDraft: () => oldDraft.promise,
      getRegistrationFormHistory: () => oldHistory.promise,
    } as unknown as AdminClient
    const newClient = {
      getRegistrationFormDraft: async () => response(newForm),
      getRegistrationFormHistory: async () => history,
    } as unknown as AdminClient
    const view = render(<MemoryRouter><RegistrationFormPage client={oldClient} /></MemoryRouter>)

    view.rerender(<MemoryRouter><RegistrationFormPage client={newClient} /></MemoryRouter>)
    expect(await screen.findByText('新附件')).toBeInTheDocument()

    oldDraft.resolve(response(oldForm))
    oldHistory.resolve(history)
    await waitFor(() => expect(screen.getAllByText('新附件').length).toBeGreaterThan(0))
    expect(screen.queryByText('旧附件')).not.toBeInTheDocument()
  })

  it('keeps edits made while a save request is in flight', async () => {
    const pendingSave = deferred<Awaited<ReturnType<AdminClient['saveRegistrationFormDraft']>>>()
    const save = vi.fn((
      _form: Parameters<AdminClient['saveRegistrationFormDraft']>[0],
      _expectedRevision: number,
    ) => {
      void _form
      void _expectedRevision
      return pendingSave.promise
    })
    const client = {
      getRegistrationFormDraft: async () => ({ apiVersion: 'v1' as const, data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
      getRegistrationFormHistory: async () => ({ apiVersion: 'v1' as const, data: { publishedVersion: null, versions: [] } }),
      saveRegistrationFormDraft: save,
    } as unknown as AdminClient
    render(<MemoryRouter><RegistrationFormPage client={client} /></MemoryRouter>)
    await screen.findByRole('heading', { name: '表单配置' })
    fireEvent.click(screen.getByRole('button', { name: '新增问题' }))
    fireEvent.change(screen.getByLabelText('问题 1 题目'), { target: { value: '已发送快照' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    const submittedForm = save.mock.calls[0]![0]

    fireEvent.change(screen.getByLabelText('问题 1 题目'), { target: { value: '保存期间的新编辑' } })
    pendingSave.resolve({ apiVersion: 'v1', data: { form: submittedForm, revision: 1, baseVersion: null, publishedVersionId: null } })

    await waitFor(() => expect(screen.getByText('草稿修订 1')).toBeInTheDocument())
    expect(screen.getByLabelText('问题 1 题目')).toHaveValue('保存期间的新编辑')
    expect(screen.getByText('有未保存修改，请先保存')).toBeInTheDocument()
  })

  it('locks a same-frame double publish to one request', async () => {
    const publishDeferred = deferred<Awaited<ReturnType<AdminClient['publishRegistrationForm']>>>()
    const publish = vi.fn(() => publishDeferred.promise)
    const client = {
      getRegistrationFormDraft: async () => ({ apiVersion: 'v1' as const, data: { form: DEFAULT_REGISTRATION_FORM, revision: 0, baseVersion: null, publishedVersionId: null } }),
      getRegistrationFormHistory: async () => ({ apiVersion: 'v1' as const, data: { publishedVersion: null, versions: [] } }),
      publishRegistrationForm: publish,
    } as unknown as AdminClient
    render(<MemoryRouter><RegistrationFormPage client={client} /></MemoryRouter>)
    await screen.findByRole('heading', { name: '表单配置' })

    const publishButton = screen.getByRole('button', { name: '发布当前草稿' })
    fireEvent.click(publishButton)
    fireEvent.click(publishButton)
    expect(publish).toHaveBeenCalledOnce()

    publishDeferred.resolve({ apiVersion: 'v1', data: { formVersionId: '00000000-0000-4000-8000-000000000020', revision: 0, version: 1 } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('报名表已发布'))
  })
})
