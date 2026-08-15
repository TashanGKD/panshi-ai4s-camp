import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError, type AdminClient } from '../src/api/admin-client'
import { ResourcesPage } from '../src/pages/ResourcesPage'

const draft = {
  id: '20000000-0000-4000-8000-000000000003', key: 'draft', title: '未发布资料', description: null,
  fileId: '30000000-0000-4000-8000-000000000003', accessScope: 'public' as const, sortOrder: 0, active: false,
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const client = (previewResource: (id: string) => Promise<{ blob: Blob, filename: string }>) => ({
  listResources: async () => ({ data: { resources: [draft] } }), previewResource,
}) as unknown as AdminClient

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ResourcesPage preview', () => {
  it('previews an unpublished file through the protected client with a pending state', async () => {
    const pending = deferred<{ blob: Blob, filename: string }>()
    const previewResource = vi.fn(() => pending.promise)
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    const open = vi.spyOn(window, 'open').mockReturnValue(window)
    render(<ResourcesPage client={client(previewResource)} />)

    const button = await screen.findByRole('button', { name: '预览文件' })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在准备预览')
    pending.resolve({ blob: new Blob(['pdf'], { type: 'application/pdf' }), filename: '未发布资料.pdf' })

    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:preview', '_blank', 'noopener,noreferrer'))
    expect(objectUrl).toHaveBeenCalledOnce()
    expect(previewResource).toHaveBeenCalledWith(draft.id)
  })

  it('shows a clear invalid-file message when preview returns 404', async () => {
    render(<ResourcesPage client={client(async () => { throw new AdminApiError(404, '资料不存在或不可访问') })} />)
    fireEvent.click(await screen.findByRole('button', { name: '预览文件' }))
    expect(await screen.findByRole('status')).toHaveTextContent('资料文件已失效或下线，请刷新列表后重试')
  })
})
