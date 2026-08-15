import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApp } from '../src/app/AdminApp'

afterEach(cleanup)
const administrator = { id: '10000000-0000-4000-8000-000000000001', displayName: '主管理员', phone: '+8613800138000', disabledAt: null, createdAt: '2026-08-15T00:00:00.000Z', isCurrent: true }
const secondAdministrator = { ...administrator, id: '10000000-0000-4000-8000-000000000002', displayName: '第二管理员', phone: '+8613900139000', isCurrent: false }
const auditItem = { id: '20000000-0000-4000-8000-000000000001', actor: { id: administrator.id, displayName: administrator.displayName }, action: 'admin.created', entityType: 'user', entityId: secondAdministrator.id, metadata: { result: 'success', password: 'must-not-render', before: { revision: 1, token: 'nested-secret' } }, createdAt: '2026-08-15T00:00:00.000Z' }
const baseClient = () => ({
  getSummary: vi.fn(async () => ({ apiVersion: 'v1', data: { applications: { total: 0, pendingReview: 0, byStatus: { draft: 0, submitted: 0, reviewing: 0, needs_supplement: 0, admitted: 0, waitlisted: 0, rejected: 0 } }, upcomingDates: [], unpublishedDrafts: [], recentOperations: [] } })),
  listAdministrators: vi.fn(async (signal?: AbortSignal) => { void signal; return { data: { administrators: [administrator, secondAdministrator] } } }),
  createAdministrator: vi.fn(async () => ({ data: { administrator: secondAdministrator } })),
  disableAdministrator: vi.fn(async () => ({ data: { administrator: { ...secondAdministrator, disabledAt: '2026-08-15T01:00:00.000Z' } } })),
  resetAdministratorPassword: vi.fn(async () => ({ data: { administrator: secondAdministrator } })),
  listAuditLogs: vi.fn(async (query: URLSearchParams, signal?: AbortSignal) => { void query; void signal; return { data: { items: [auditItem], total: 21, page: 1, pageSize: 20 } } }),
  getAuditLog: vi.fn(async (id: string, signal?: AbortSignal) => { void id; void signal; return { data: { item: auditItem } } }),
})

describe('administrator and audit pages', () => {
  it('requires reauthentication, clears passwords, prevents self-disable, and suppresses duplicate actions', async () => {
    const client = baseClient()
    let resolveCreate: (() => void) | undefined
    client.createAdministrator = vi.fn(() => new Promise((resolve) => { resolveCreate = () => resolve({ data: { administrator: secondAdministrator } }) }))
    render(<MemoryRouter initialEntries={['/administrators']}><AdminApp client={client as never} publicWebBaseUrl="" /></MemoryRouter>)
    expect(await screen.findByText(/主管理员/u)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '禁用' })[0]).toBeDisabled()
    fireEvent.change(screen.getByLabelText('管理员名称'), { target: { value: '新管理员' } })
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13700137000' } })
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'NewAdmin!2026' } })
    fireEvent.change(screen.getByLabelText('当前管理员密码'), { target: { value: 'Current!2026' } })
    fireEvent.click(screen.getByRole('button', { name: '新增管理员' }))
    fireEvent.click(screen.getByRole('button', { name: '正在新增' }))
    expect(client.createAdministrator).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('当前管理员密码')).toHaveValue('')
    resolveCreate?.()
    await waitFor(() => expect(screen.getByText('管理员已新增')).toBeInTheDocument())
  })

  it('uses an explicit confirmation dialog for disable and reset without retaining passwords', async () => {
    const client = baseClient()
    render(<MemoryRouter initialEntries={['/administrators']}><AdminApp client={client as never} publicWebBaseUrl="" /></MemoryRouter>)
    await screen.findByText('第二管理员')
    fireEvent.click(screen.getAllByRole('button', { name: '禁用' })[1]!)
    expect(screen.getByRole('dialog', { name: '禁用管理员' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('再次输入当前密码'), { target: { value: 'Current!2026' } })
    fireEvent.click(screen.getByRole('button', { name: '确认禁用' }))
    await waitFor(() => expect(client.disableAdministrator).toHaveBeenCalledWith(secondAdministrator.id, { currentPassword: 'Current!2026' }))
    expect(screen.queryByDisplayValue('Current!2026')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '重置密码' })[1]!)
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Replacement!2026' } })
    fireEvent.change(screen.getByLabelText('再次输入当前密码'), { target: { value: 'Current!2026' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))
    await waitFor(() => expect(client.resetAdministratorPassword).toHaveBeenCalledWith(secondAdministrator.id, { currentPassword: 'Current!2026', newPassword: 'Replacement!2026' }))
    expect(screen.queryByDisplayValue(/Current|Replacement/u)).not.toBeInTheDocument()
  })

  it('ignores an older administrator-list response after the client changes', async () => {
    let releaseOld: ((value: { data: { administrators: typeof administrator[] } }) => void) | undefined
    const oldClient = baseClient(); oldClient.listAdministrators = vi.fn((signal?: AbortSignal) => { void signal; return new Promise<{ data: { administrators: typeof administrator[] } }>((resolve) => { releaseOld = resolve }) })
    const newClient = baseClient(); newClient.listAdministrators = vi.fn(async () => ({ data: { administrators: [{ ...secondAdministrator, displayName: '新客户端管理员' }] } }))
    const view = render(<MemoryRouter initialEntries={['/administrators']}><AdminApp client={oldClient as never} publicWebBaseUrl="" /></MemoryRouter>)
    view.rerender(<MemoryRouter initialEntries={['/administrators']}><AdminApp client={newClient as never} publicWebBaseUrl="" /></MemoryRouter>)
    expect(await screen.findByText('新客户端管理员')).toBeInTheDocument()
    releaseOld?.({ data: { administrators: [{ ...administrator, displayName: '过期管理员' }] } })
    await Promise.resolve()
    expect(screen.queryByText('过期管理员')).not.toBeInTheDocument()
  })

  it('filters, paginates and opens a read-only sanitized audit detail', async () => {
    const client = baseClient()
    render(<MemoryRouter initialEntries={['/audit-logs']}><AdminApp client={client as never} publicWebBaseUrl="" /></MemoryRouter>)
    expect(await screen.findByText('admin.created')).toBeInTheDocument()
    expect(screen.queryByText('must-not-render')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('nested-secret')
    fireEvent.change(screen.getByLabelText('动作'), { target: { value: 'admin.created' } })
    fireEvent.change(screen.getByLabelText('对象编号'), { target: { value: secondAdministrator.id } })
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    await waitFor(() => expect(client.listAuditLogs).toHaveBeenLastCalledWith(expect.any(URLSearchParams), expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect([...(client.listAuditLogs.mock.calls.at(-1)?.[0] ?? new URLSearchParams()).entries()]).toContainEqual(['page', '2']))
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    expect(await screen.findByRole('dialog', { name: '操作日志详情' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除|修改/u })).not.toBeInTheDocument()
    expect(screen.queryByText('must-not-render')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('nested-secret')
  })
})
