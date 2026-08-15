import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminApplicationListItem, AdminClient } from '../src/api/admin-client'
import { ApplicationsPage } from '../src/pages/ApplicationsPage'

afterEach(cleanup)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const item = (id: string, name: string): AdminApplicationListItem => ({
  id,
  revision: 2,
  status: 'submitted',
  name,
  phone: '+8613800138000',
  organization: '中国科学院物理研究所',
  identityType: '研究生',
  educationStage: '博士',
  submittedAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
})

const firstId = '30000000-0000-4000-8000-000000000001'
const secondId = '30000000-0000-4000-8000-000000000002'
const response = (items: AdminApplicationListItem[]) => ({ data: { items, total: items.length, page: 1, pageSize: 20 } })

const client = (overrides: Partial<AdminClient>): AdminClient => ({
  listApplications: async () => response([]),
  bulkTransitionApplications: async () => ({ data: { results: [] } }),
  exportApplications: async () => new Blob(),
  ...overrides,
} as unknown as AdminClient)

const renderPage = (api: AdminClient) => render(<MemoryRouter><ApplicationsPage client={api} /></MemoryRouter>)

describe('applications review list', () => {
  it('keeps per-application bulk results and retries only failed applications after an exact-count confirmation', async () => {
    const bulk = vi.fn()
      .mockResolvedValueOnce({ data: { results: [
        { applicationId: firstId, success: true, status: 'reviewing' },
        { applicationId: secondId, success: false, code: 'INVALID_STATUS_TRANSITION', message: '当前状态不允许该操作' },
      ] } })
      .mockResolvedValueOnce({ data: { results: [{ applicationId: secondId, success: true, status: 'reviewing' }] } })
    renderPage(client({
      listApplications: async () => response([item(firstId, '张三'), item(secondId, '李四')]),
      bulkTransitionApplications: bulk,
    }))

    await screen.findByText('张三')
    fireEvent.click(screen.getByLabelText('选择 张三'))
    fireEvent.click(screen.getByLabelText('选择 李四'))
    fireEvent.change(screen.getByLabelText('批量目标状态'), { target: { value: 'reviewing' } })
    fireEvent.click(screen.getByRole('button', { name: '批量调整（2）' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('已选择的 2 份报名')
    fireEvent.click(screen.getByLabelText('我已核对人数和目标状态'))
    fireEvent.click(screen.getByRole('button', { name: '确认处理 2 份' }))

    const results = await screen.findByRole('region', { name: '批量处理结果' })
    expect(results).toHaveTextContent(firstId)
    expect(results).toHaveTextContent(secondId)
    expect(results).toHaveTextContent('成功')
    expect(results).toHaveTextContent('失败')
    expect(results).toHaveTextContent('INVALID_STATUS_TRANSITION')
    expect(results).toHaveTextContent('当前状态不允许该操作')
    expect(screen.getByLabelText('选择 张三')).not.toBeChecked()
    expect(screen.getByLabelText('选择 李四')).toBeChecked()

    fireEvent.click(within(results).getByRole('button', { name: '重试失败项（1）' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('已选择的 1 份报名')
    fireEvent.click(screen.getByLabelText('我已核对人数和目标状态'))
    fireEvent.click(screen.getByRole('button', { name: '确认处理 1 份' }))
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith({ applicationIds: [secondId], targetStatus: 'reviewing' }))
  })

  it('ignores an older successful response and its finally block after a newer filter load', async () => {
    const old = deferred<ReturnType<typeof response>>()
    const signals: AbortSignal[] = []
    const list = vi.fn((query: URLSearchParams, signal?: AbortSignal) => {
      if (signal) signals.push(signal)
      return query.get('search') === '新' ? Promise.resolve(response([item(secondId, '新结果')])) : old.promise
    })
    renderPage(client({ listApplications: list }))

    fireEvent.change(screen.getByPlaceholderText('姓名、手机号或单位'), { target: { value: '新' } })
    await screen.findByText('新结果')
    fireEvent.click(screen.getByLabelText('选择 新结果'))
    old.resolve(response([item(firstId, '旧结果')]))

    await waitFor(() => expect(screen.queryByText('旧结果')).not.toBeInTheDocument())
    expect(screen.getByText('新结果')).toBeInTheDocument()
    expect(screen.getByLabelText('选择 新结果')).toBeChecked()
    expect(screen.queryByText('正在加载报名')).not.toBeInTheDocument()
    expect(signals[0]?.aborted).toBe(true)
  })

  it('ignores an older rejected response after a newer filter load succeeds', async () => {
    const old = deferred<ReturnType<typeof response>>()
    const list = vi.fn((query: URLSearchParams) => query.get('search') === '新'
      ? Promise.resolve(response([item(secondId, '新结果')]))
      : old.promise)
    renderPage(client({ listApplications: list }))

    fireEvent.change(screen.getByPlaceholderText('姓名、手机号或单位'), { target: { value: '新' } })
    await screen.findByText('新结果')
    old.reject(new Error('旧请求失败'))

    await waitFor(() => expect(screen.queryByText('旧请求失败')).not.toBeInTheDocument())
    expect(screen.getByText('新结果')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
