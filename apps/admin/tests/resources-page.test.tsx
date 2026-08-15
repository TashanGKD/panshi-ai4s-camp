import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError, type AdminClient } from '../src/api/admin-client'
import { ResourcesPage } from '../src/pages/ResourcesPage'

const draft = {
  id: '20000000-0000-4000-8000-000000000003', key: 'draft', title: '未发布资料', description: null,
  fileId: '30000000-0000-4000-8000-000000000003', accessScope: 'public' as const, sortOrder: 0, active: false, revision: 0,
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const client = (previewResource: (id: string) => Promise<{ blob: Blob, filename: string }>, overrides: Partial<AdminClient> = {}) => ({
  listResources: async () => ({ data: { resources: [draft] } }), previewResource,
  updateResource: async () => ({ data: { resource: { ...draft, revision: 1 } } }),
  createResource: async () => ({ data: { resource: draft } }),
  publishResource: async () => ({ data: { resource: { ...draft, active: true, revision: 1 } } }),
  ...overrides,
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

  it('uses the revision returned by save for the next publish', async () => {
    const saved = { ...draft, title: '保存后的资料', revision: 1 }
    const updateResource = vi.fn(async () => ({ data: { resource: saved } }))
    const publishResource = vi.fn(async () => ({ data: { resource: { ...saved, active: true, revision: 2 } } }))
    render(<ResourcesPage client={client(async () => ({ blob: new Blob(), filename: 'x.pdf' }), { updateResource, publishResource })} />)

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '保存后的资料' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改并转为未发布' }))
    await screen.findByText('保存后的资料')
    fireEvent.click(screen.getByRole('button', { name: '发布' }))

    await waitFor(() => expect(publishResource).toHaveBeenCalledWith(draft.id, true, 1))
    expect(updateResource).toHaveBeenCalledWith(draft.id, expect.objectContaining({ title: '保存后的资料' }), 0)
  })

  it.each([
    ['保存', '保存修改并转为未发布'],
    ['发布', '发布'],
  ])('reloads the latest resource after a stale %s conflict', async (_label, buttonName) => {
    const latest = { ...draft, title: '另一管理员的新版本', revision: 4 }
    const listResources = vi.fn()
      .mockResolvedValueOnce({ data: { resources: [draft] } })
      .mockResolvedValueOnce({ data: { resources: [latest] } })
    const conflict = new AdminApiError(409, '资料已被其他管理员修改', 'RESOURCE_REVISION_CONFLICT')
    const updateResource = vi.fn(async () => { throw conflict })
    const publishResource = vi.fn(async () => { throw conflict })
    render(<ResourcesPage client={client(async () => ({ blob: new Blob(), filename: 'x.pdf' }), { listResources, updateResource, publishResource })} />)

    if (buttonName === '保存修改并转为未发布') fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.click(await screen.findByRole('button', { name: buttonName }))

    expect(await screen.findByRole('status')).toHaveTextContent('资料已被其他管理员修改，已刷新最新状态')
    expect(await screen.findByText('另一管理员的新版本')).toBeInTheDocument()
    expect(listResources).toHaveBeenCalledTimes(2)
  })

  it('reloads after a stale unpublish conflict and prevents duplicate pending mutations', async () => {
    const published = { ...draft, active: true, revision: 2 }
    const latest = { ...published, active: false, title: '已由另一管理员下线', revision: 3 }
    const listResources = vi.fn()
      .mockResolvedValueOnce({ data: { resources: [published] } })
      .mockResolvedValueOnce({ data: { resources: [latest] } })
    const publishResource = vi.fn(async () => { throw new AdminApiError(409, '冲突', 'RESOURCE_REVISION_CONFLICT') })
    render(<ResourcesPage client={client(async () => ({ blob: new Blob(), filename: 'x.pdf' }), { listResources, publishResource })} />)

    const button = await screen.findByRole('button', { name: '下线' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await screen.findByRole('status')).toHaveTextContent('已刷新最新状态')
    expect(await screen.findByText('已由另一管理员下线')).toBeInTheDocument()
    expect(publishResource).toHaveBeenCalledOnce()
  })

  it('does not let a late list response overwrite a newer client load', async () => {
    const oldLoad = deferred<{ data: { resources: typeof draft[] } }>()
    const latest = { ...draft, title: '新客户端资料', revision: 5 }
    const firstClient = client(async () => ({ blob: new Blob(), filename: 'x.pdf' }), { listResources: () => oldLoad.promise })
    const secondClient = client(async () => ({ blob: new Blob(), filename: 'x.pdf' }), { listResources: async () => ({ data: { resources: [latest] } }) })
    const view = render(<ResourcesPage client={firstClient} />)

    view.rerender(<ResourcesPage client={secondClient} />)
    expect(await screen.findByText('新客户端资料')).toBeInTheDocument()
    oldLoad.resolve({ data: { resources: [draft] } })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('新客户端资料')).toBeInTheDocument()
    expect(screen.queryByText('未发布资料')).not.toBeInTheDocument()
  })
})
