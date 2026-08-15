import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient, AdminSystemHealthResponse } from '../src/api/admin-client'
import { SystemStatusPage } from '../src/pages/SystemStatusPage'

afterEach(cleanup)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const health = (status: 'healthy' | 'degraded' = 'healthy'): AdminSystemHealthResponse => ({
  apiVersion: 'v1',
  data: {
    status,
    checkedAt: '2026-08-15T02:03:04.000Z',
    version: '6c444d0',
    database: { connected: status === 'healthy' },
    uploads: { writable: true, freeBytes: 11_534_336 },
    backup: { available: status === 'healthy', lastSuccessfulAt: status === 'healthy' ? '2026-08-15T01:02:03.000Z' : null },
  },
})

const renderPage = (getSystemHealth: AdminClient['getSystemHealth']) => render(
  <MemoryRouter><SystemStatusPage client={{ getSystemHealth } as AdminClient} /></MemoryRouter>,
)

describe('administrator system status page', () => {
  it('shows a clear healthy status, sanitized capacities, timestamps, and version', async () => {
    renderPage(async () => health())

    expect(screen.getByRole('status')).toHaveTextContent('正在检查系统状态')
    expect(await screen.findByRole('heading', { name: '系统状态' })).toBeInTheDocument()
    expect(screen.getByText('运行正常')).toBeInTheDocument()
    expect(screen.getByText('数据库连接正常')).toBeInTheDocument()
    expect(screen.getByText('上传目录可写')).toBeInTheDocument()
    expect(screen.getByText(/可用空间/u)).toHaveTextContent('11 MiB')
    expect(screen.getByText('6c444d0')).toBeInTheDocument()
    expect(screen.getByText('最近备份成功')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/postgres|password|\/secret|uploads\//iu)
  })

  it('shows degraded checks and supports manual refresh', async () => {
    const getSystemHealth = vi.fn()
      .mockResolvedValueOnce(health('degraded'))
      .mockResolvedValueOnce(health('healthy'))
    renderPage(getSystemHealth)

    expect(await screen.findByText('需要关注')).toBeInTheDocument()
    expect(screen.getByText('数据库连接异常')).toBeInTheDocument()
    expect(screen.getByText('尚无成功备份')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '手动刷新' }))

    expect(await screen.findByText('运行正常')).toBeInTheDocument()
    expect(getSystemHealth).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale response that resolves after a newer refresh', async () => {
    const first = deferred<AdminSystemHealthResponse>()
    const second = deferred<AdminSystemHealthResponse>()
    const getSystemHealth = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    renderPage(getSystemHealth)

    fireEvent.click(screen.getByRole('button', { name: '手动刷新' }))
    second.resolve(health('degraded'))
    expect(await screen.findByText('需要关注')).toBeInTheDocument()
    first.resolve(health('healthy'))

    await waitFor(() => expect(screen.queryByText('运行正常')).not.toBeInTheDocument())
    expect(screen.getByText('需要关注')).toBeInTheDocument()
  })

  it('shows a safe retry state when loading fails', async () => {
    const getSystemHealth = vi.fn(async () => { throw new Error('postgres://secret@internal/path') })
    renderPage(getSystemHealth)

    expect(await screen.findByRole('alert')).toHaveTextContent('系统状态暂时无法加载')
    expect(document.body.textContent).not.toMatch(/postgres|secret|internal|path/iu)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(getSystemHealth).toHaveBeenCalledTimes(2))
  })
})
