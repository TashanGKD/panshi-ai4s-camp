import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentEditor } from '../src/features/content/ContentEditor'
import { VersionHistory } from '../src/features/content/VersionHistory'
import { resolvePublicWebBaseUrl } from '../src/api/admin-client'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const draft = {
  apiVersion: 'v1' as const,
  data: { key: 'basic' as const, revision: 2, publishedVersion: 1, payload: { title: '草稿标题' } },
}

describe('minimal content publishing components', () => {
  it('saves JSON with the loaded expected revision and reports malformed input locally', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<ContentEditor draft={draft} publicWebBaseUrl="https://camp.example" onSave={onSave} onPublish={async () => undefined} />)
    const editor = screen.getByLabelText('内容 JSON')
    fireEvent.change(editor, { target: { value: '{ invalid' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入有效的 JSON')
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.change(editor, { target: { value: '{"title":"新草稿"}' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: '新草稿' }, 2))
  })

  it('opens the configured public preview route without query tokens', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<ContentEditor draft={draft} publicWebBaseUrl="https://camp.example/base" onSave={async () => undefined} onPublish={async () => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '预览草稿' }))
    expect(open).toHaveBeenCalledWith('https://camp.example/base/preview/basic', '_blank', 'noopener,noreferrer')
    expect(open.mock.calls[0]?.[0]).not.toMatch(/[?&](token|previewToken)=/u)
  })

  it('publishes the currently loaded revision', async () => {
    const onPublish = vi.fn(async () => undefined)
    render(<ContentEditor draft={draft} publicWebBaseUrl="" onSave={async () => undefined} onPublish={onPublish} />)
    fireEvent.click(screen.getByRole('button', { name: '发布当前草稿' }))
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(2))
  })

  it('renders immutable history and requests rollback by historical version', async () => {
    const onRollback = vi.fn(async () => undefined)
    render(<VersionHistory publishedVersion={2} versions={[
      { version: 2, payload: { title: '第二版' }, createdBy: 'admin-2', createdAt: '2026-08-14T02:00:00.000Z' },
      { version: 1, payload: { title: '第一版' }, createdBy: 'admin-1', createdAt: '2026-08-14T01:00:00.000Z' },
    ]} onRollback={onRollback} />)
    expect(screen.getByText('版本 2（当前）')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '回退到版本 1' }))
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith(1))
  })

  it('disables every rollback during a pending request and prevents duplicate versions', async () => {
    let resolveRollback!: () => void
    const onRollback = vi.fn(() => new Promise<void>((resolve) => { resolveRollback = resolve }))
    render(<VersionHistory publishedVersion={3} versions={[
      { version: 3, payload: {}, createdBy: 'a', createdAt: '2026-08-14T03:00:00.000Z' },
      { version: 2, payload: {}, createdBy: 'a', createdAt: '2026-08-14T02:00:00.000Z' },
      { version: 1, payload: {}, createdBy: 'a', createdAt: '2026-08-14T01:00:00.000Z' },
    ]} onRollback={onRollback} />)

    fireEvent.click(screen.getByRole('button', { name: '回退到版本 2' }))
    expect(await screen.findByRole('status')).toHaveTextContent('正在回退到版本 2')
    const buttons = screen.getAllByRole('button', { name: /回退到版本/u })
    expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '回退到版本 1' }))
    expect(onRollback).toHaveBeenCalledTimes(1)

    resolveRollback()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(buttons.every((button) => !button.hasAttribute('disabled'))).toBe(true)
  })

  it('catches rollback failures, shows an error, and re-enables actions', async () => {
    const onRollback = vi.fn(async () => { throw new Error('network detail') })
    render(<VersionHistory publishedVersion={2} versions={[
      { version: 2, payload: {}, createdBy: 'a', createdAt: '2026-08-14T02:00:00.000Z' },
      { version: 1, payload: {}, createdBy: 'a', createdAt: '2026-08-14T01:00:00.000Z' },
    ]} onRollback={onRollback} />)

    const button = screen.getByRole('button', { name: '回退到版本 1' })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('版本回退失败，请重试')
    expect(button).toBeEnabled()
    expect(screen.queryByText('network detail')).not.toBeInTheDocument()
  })

  it.each([
    ['http://camp.example', false, false],
    ['http://localhost:5173', true, false],
    ['http://127.0.0.1:5173', true, false],
    ['https://camp.example/path/', true, true],
    ['https://user:secret@camp.example', false, false],
  ])('validates public Web base %s', (value, developmentAllowed, productionAllowed) => {
    const dev = () => resolvePublicWebBaseUrl(value, { production: false })
    const prod = () => resolvePublicWebBaseUrl(value, { production: true })
    if (developmentAllowed) expect(dev()).toBe(value.replace(/\/$/u, ''))
    else expect(dev).toThrow('Invalid VITE_PUBLIC_WEB_BASE_URL')
    if (productionAllowed) expect(prod()).toBe(value.replace(/\/$/u, ''))
    else expect(prod).toThrow('Invalid VITE_PUBLIC_WEB_BASE_URL')
  })
})
