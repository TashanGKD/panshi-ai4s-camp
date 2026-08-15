import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_REGISTRATION_FORM } from '@panshi/contracts'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminApplicationDetail, AdminClient } from '../src/api/admin-client'
import { ApplicationReviewPage } from '../src/pages/ApplicationReviewPage'

afterEach(cleanup)

const firstId = '30000000-0000-4000-8000-000000000001'
const secondId = '30000000-0000-4000-8000-000000000002'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const detail = (id: string, name: string, revision: number, internalReviewNote: string): { data: AdminApplicationDetail } => ({
  data: {
    application: {
      id,
      revision,
      status: 'submitted',
      name,
      phone: '+8613800138000',
      organization: '中国科学院物理研究所',
      identityType: '研究生',
      educationStage: '博士',
      submittedAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      coreFields: { name },
      answers: {},
      form: DEFAULT_REGISTRATION_FORM,
      internalReviewNote,
    },
    versions: [],
    history: [],
    attachments: [],
  },
})

const client = (overrides: Partial<AdminClient>): AdminClient => ({
  getApplication: async () => detail(firstId, '甲', 1, ''),
  transitionApplication: async (id: string) => ({ data: { id, revision: 2, status: 'reviewing' } }),
  ...overrides,
} as unknown as AdminClient)

const renderPage = (api: AdminClient) => {
  const router = createMemoryRouter([
    { path: '/applications/:id', element: <ApplicationReviewPage client={api} /> },
  ], { initialEntries: [`/applications/${firstId}`] })
  render(<RouterProvider router={router} />)
  return router
}

describe('application review detail isolation', () => {
  it('clears the old detail and form state immediately when the route id changes', async () => {
    const first = deferred<{ data: AdminApplicationDetail }>()
    const second = deferred<{ data: AdminApplicationDetail }>()
    const signals: AbortSignal[] = []
    const getApplication = vi.fn((id: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal)
      return id === firstId ? first.promise : second.promise
    })
    const router = renderPage(client({ getApplication }))

    first.resolve(detail(firstId, '甲申请人', 1, '甲内部备注'))
    await screen.findByRole('heading', { name: '甲申请人的报名' })
    await act(() => router.navigate(`/applications/${secondId}`))

    expect(screen.queryByText('甲内部备注')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认更新状态' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载报名详情')
    expect(signals[0]?.aborted).toBe(true)

    second.resolve(detail(secondId, '乙申请人', 7, '乙内部备注'))
    await screen.findByRole('heading', { name: '乙申请人的报名' })
    expect(screen.getByDisplayValue('乙内部备注')).toBeInTheDocument()
  })

  it.each(['resolve', 'reject'] as const)('ignores an older load that returns after the new route via %s', async (outcome) => {
    const first = deferred<{ data: AdminApplicationDetail }>()
    const getApplication = vi.fn((id: string) => id === firstId
      ? first.promise
      : Promise.resolve(detail(secondId, '乙申请人', 7, '乙内部备注')))
    const router = renderPage(client({ getApplication }))

    await act(() => router.navigate(`/applications/${secondId}`))
    await screen.findByRole('heading', { name: '乙申请人的报名' })
    await act(async () => {
      if (outcome === 'resolve') first.resolve(detail(firstId, '甲申请人', 1, '甲内部备注'))
      else first.reject(new Error('甲详情晚到失败'))
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: '乙申请人的报名' })).toBeInTheDocument()
    expect(screen.queryByText('甲申请人')).not.toBeInTheDocument()
    expect(screen.queryByText('甲详情晚到失败')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['resolve', 'reject'] as const)('keeps a new-page transition pending when the old transition returns late via %s', async (outcome) => {
    const firstTransition = deferred<{ data: { id: string, revision: number, status: string } }>()
    const secondTransition = deferred<{ data: { id: string, revision: number, status: string } }>()
    const transitionApplication = vi.fn((id: string) => id === firstId ? firstTransition.promise : secondTransition.promise)
    const getApplication = vi.fn(async (id: string) => id === firstId
      ? detail(firstId, '甲申请人', 3, '甲内部备注')
      : detail(secondId, '乙申请人', 9, '乙内部备注'))
    const router = renderPage(client({ getApplication, transitionApplication }))

    await screen.findByRole('heading', { name: '甲申请人的报名' })
    fireEvent.click(screen.getByRole('button', { name: '确认更新状态' }))
    expect(transitionApplication).toHaveBeenNthCalledWith(1, firstId, expect.objectContaining({ expectedRevision: 3 }))

    await act(() => router.navigate(`/applications/${secondId}`))
    await screen.findByRole('heading', { name: '乙申请人的报名' })
    fireEvent.click(screen.getByRole('button', { name: '确认更新状态' }))
    expect(transitionApplication).toHaveBeenNthCalledWith(2, secondId, expect.objectContaining({ expectedRevision: 9 }))
    expect(screen.getByRole('button', { name: '提交中' })).toBeDisabled()

    await act(async () => {
      if (outcome === 'resolve') firstTransition.resolve({ data: { id: firstId, revision: 4, status: 'reviewing' } })
      else firstTransition.reject(new Error('甲状态更新晚到失败'))
      await Promise.resolve()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '乙申请人的报名' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交中' })).toBeDisabled()
    expect(getApplication).toHaveBeenCalledTimes(2)

    secondTransition.resolve({ data: { id: secondId, revision: 10, status: 'reviewing' } })
    await waitFor(() => expect(getApplication).toHaveBeenCalledTimes(3))
  })
})
