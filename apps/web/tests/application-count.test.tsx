import '@testing-library/jest-dom/vitest'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationCount } from '../src/components/ApplicationCount'

describe('ApplicationCount', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); vi.useRealTimers(); vi.restoreAllMocks() })

  it('loads once and refreshes every 60 seconds only while visible', async () => {
    const load = vi.fn().mockResolvedValue({ visible: true as const, submittedCount: 12, updatedAt: '2026-08-15T12:00:00.000Z' })
    render(<ApplicationCount load={load} />)
    await act(async () => Promise.resolve())
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve() })
    expect(load).toHaveBeenCalledTimes(2)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => { vi.advanceTimersByTime(120_000); await Promise.resolve() })
    expect(load).toHaveBeenCalledTimes(2)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve() })
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('ignores stale responses and aborts on unmount', async () => {
    const pending: Array<(value: { visible: true, submittedCount: number, updatedAt: string }) => void> = []
    const load = vi.fn((signal: AbortSignal) => { void signal; return new Promise<{ visible: true, submittedCount: number, updatedAt: string }>((resolve) => pending.push(resolve)) })
    const view = render(<ApplicationCount load={load} />)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    pending[1]?.({ visible: true, submittedCount: 20, updatedAt: '2026-08-15T12:01:00.000Z' })
    await act(async () => Promise.resolve())
    pending[0]?.({ visible: true, submittedCount: 10, updatedAt: '2026-08-15T12:00:00.000Z' })
    await act(async () => Promise.resolve())
    expect(screen.getByText('20')).toBeInTheDocument()
    view.unmount()
    expect(load.mock.calls.at(-1)?.[0].aborted).toBe(true)
  })

  it('keeps polling while the switch is false and automatically renders after it becomes true', async () => {
    const load = vi.fn().mockResolvedValueOnce({ visible: false as const }).mockResolvedValueOnce({ visible: true as const, submittedCount: 15, updatedAt: '2026-08-15T12:01:00.000Z' })
    render(<ApplicationCount load={load} />)
    await act(async () => Promise.resolve())
    expect(screen.queryByLabelText('报名人数')).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve() })
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByText('15')).toBeInTheDocument()
  })

  it('keeps polling after a true response and hides immediately when the switch becomes false', async () => {
    const load = vi.fn().mockResolvedValueOnce({ visible: true as const, submittedCount: 8, updatedAt: '2026-08-15T12:00:00.000Z' }).mockResolvedValueOnce({ visible: false as const })
    render(<ApplicationCount load={load} />)
    await act(async () => Promise.resolve())
    expect(screen.getByText('8')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve() })
    expect(screen.queryByLabelText('报名人数')).not.toBeInTheDocument()
  })

  it('clears a stale count after an error and keeps retrying a previously visible counter', async () => {
    const load = vi.fn().mockResolvedValueOnce({ visible: true as const, submittedCount: 8, updatedAt: '2026-08-15T12:00:00.000Z' }).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ visible: true as const, submittedCount: 9, updatedAt: '2026-08-15T12:02:00.000Z' })
    render(<ApplicationCount load={load} />); await act(async () => Promise.resolve())
    expect(screen.getByText('8')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve() })
    expect(screen.queryByText('8')).not.toBeInTheDocument(); expect(screen.getByText('报名人数暂时无法获取')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve() })
    expect(screen.getByText('9')).toBeInTheDocument()
  })
})
