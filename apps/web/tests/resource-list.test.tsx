import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceList } from '../src/features/resources/ResourceList'

afterEach(() => vi.restoreAllMocks())

describe('ResourceList', () => {
  const response = { apiVersion: 'v1' as const, data: { resources: [{ id: '10000000-0000-4000-8000-000000000001', key: 'guide', title: '学员手册', description: '报名说明', accessScope: 'authenticated' as const, sortOrder: 0, downloadUrl: '/api/v1/resources/10000000-0000-4000-8000-000000000001/download' }] } }

  it('renders only server-authorized metadata and downloads through the protected client', async () => {
    const download = vi.fn().mockResolvedValue({ blob: new Blob(['pdf']), filename: '学员手册.pdf' })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<ResourceList load={vi.fn().mockResolvedValue(response)} download={download} />)
    fireEvent.click(await screen.findByRole('link', { name: '下载' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(response.data.resources[0]!.downloadUrl))
    expect(click).toHaveBeenCalled()
  })

  it('shows a clear session-or-withdrawal message instead of a stale download', async () => {
    render(<ResourceList load={vi.fn().mockResolvedValue(response)} download={vi.fn().mockRejectedValue(new Error('RESOURCE_NOT_AVAILABLE'))} />)
    fireEvent.click(await screen.findByRole('link', { name: '下载' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('登录状态可能已过期')
  })
})
