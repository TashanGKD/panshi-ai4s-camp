import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REGISTRATION_FORM, type MyApplicationResponse } from '@panshi/contracts'
import { RegistrationPage } from '../src/pages/RegistrationPage'

const api = vi.hoisted(() => ({
  getMine: vi.fn(), saveDraft: vi.fn(), submit: vi.fn(), upload: vi.fn(), removeFile: vi.fn(), logout: vi.fn(),
}))

vi.mock('../src/api/application-client', () => ({
  applicationClient: api,
  ApplicationApiError: class ApplicationApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message) }
  },
}))

const application: MyApplicationResponse['data']['application'] = {
  id: '10000000-0000-4000-8000-000000000001', status: 'draft', revision: 0, locked: false,
  formVersionId: '30000000-0000-4000-8000-000000000001', formVersion: 1, form: DEFAULT_REGISTRATION_FORM,
  profile: { name: '张三', phone: '+8613800138000', email: '', organization: '', department: '', identityType: '', educationStage: '', majorResearchDirection: '' },
  answers: {}, attachments: [], unlinkedAttachments: [], retiredAnswerIds: [], submittedAt: null, updatedAt: '2026-08-15T00:00:00.000Z',
}

const response = (value = application): MyApplicationResponse => ({
  apiVersion: 'v1', data: { application: value, timeline: [], supplementRequest: null, accessibleResources: [] },
})

const renderPage = () => {
  const router = createMemoryRouter([
    { path: '/application', element: <RegistrationPage /> },
    { path: '/account', element: <h2>目标页面</h2> },
  ], { initialEntries: ['/application'] })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getMine.mockResolvedValue(response())
  api.saveDraft.mockResolvedValue(response({ ...application, revision: 1, profile: { ...application.profile, name: '李四' } }))
})

describe('registration route navigation guard', () => {
  it('keeps a dirty applicant on the page when cancelled and leaves only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const router = renderPage()
    fireEvent.change(await screen.findByLabelText('姓名'), { target: { value: '李四' } })

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)

    void router.navigate('/account')
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(router.state.location.pathname).toBe('/application')

    confirm.mockReturnValue(true)
    void router.navigate('/account')
    await screen.findByRole('heading', { name: '目标页面' })
    expect(router.state.location.pathname).toBe('/account')
  })

  it('blocks while a save is pending and stops blocking after the save succeeds', async () => {
    let resolveSave: ((value: MyApplicationResponse) => void) | undefined
    api.saveDraft.mockImplementation(() => new Promise<MyApplicationResponse>((resolve) => { resolveSave = resolve }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const router = renderPage()
    fireEvent.change(await screen.findByLabelText('姓名'), { target: { value: '李四' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(screen.getByRole('button', { name: '处理中' })).toBeDisabled()

    void router.navigate('/account')
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(router.state.location.pathname).toBe('/application')

    resolveSave?.(response({ ...application, revision: 1, profile: { ...application.profile, name: '李四' } }))
    await screen.findByText('草稿已保存')
    confirm.mockClear()
    await router.navigate('/account')
    await screen.findByRole('heading', { name: '目标页面' })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not queue a second attachment upload while the first upload is pending', async () => {
    let resolveUpload: ((value: { data: { file: { id: string, originalName: string, mimeType: string, sizeBytes: number } } }) => void) | undefined
    api.upload.mockImplementationOnce(() => new Promise((resolve) => { resolveUpload = resolve }))
      .mockResolvedValue({ data: { file: { id: '50000000-0000-4000-8000-000000000002', originalName: 'duplicate.pdf', mimeType: 'application/pdf', sizeBytes: 20 } } })
    const router = renderPage()
    const input = await screen.findByLabelText(/个人简历/u)
    const first = new File(['first'], 'first.pdf', { type: 'application/pdf' })
    const duplicate = new File(['duplicate'], 'duplicate.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [first] } })
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
    fireEvent.change(input, { target: { files: [duplicate] } })
    expect(api.upload).toHaveBeenCalledTimes(1)

    resolveUpload?.({ data: { file: { id: '50000000-0000-4000-8000-000000000001', originalName: 'first.pdf', mimeType: 'application/pdf', sizeBytes: 10 } } })
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 75))
    expect(api.upload).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/application')
  })

  it('blocks duplicate submit requests and ignores a late response after confirmed navigation', async () => {
    let resolveSubmit: ((value: unknown) => void) | undefined
    api.submit.mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(true)
    const router = renderPage()
    await screen.findByLabelText('姓名')
    fireEvent.click(screen.getByRole('button', { name: '正式提交' }))
    fireEvent.click(screen.getByRole('button', { name: '处理中' }))
    expect(api.submit).toHaveBeenCalledTimes(1)

    void router.navigate('/account')
    await screen.findByRole('heading', { name: '目标页面' })
    resolveSubmit?.({ apiVersion: 'v1', data: {} })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(api.getMine).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/account')
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('shows the current slot error after submit and keeps the migrated attachment replaceable', async () => {
    const slot = DEFAULT_REGISTRATION_FORM.attachments[0]!
    api.getMine.mockResolvedValue(response({
      ...application,
      attachments: [{
        id: '50000000-0000-4000-8000-000000000001', slotId: slot.id, originalName: 'resume.pdf',
        mimeType: 'application/pdf', sizeBytes: 900_000, downloadUrl: '/api/v1/files/50000000-0000-4000-8000-000000000001/download',
      }],
    }))
    const { ApplicationApiError } = await import('../src/api/application-client')
    api.submit.mockRejectedValue(new ApplicationApiError(422, 'APPLICATION_ATTACHMENT_INVALID', '附件不符合当前报名表要求', {
      fields: [{ path: `attachments.${slot.id}`, message: '文件大小超过当前限制（最大 100000 字节）' }],
    }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '正式提交' }))
    expect(await screen.findByText('文件大小超过当前限制（最大 100000 字节）')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: '删除并替换' })).toBeEnabled()
    expect(api.removeFile).not.toHaveBeenCalled()
  })
})
