import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient } from '../src/api/admin-client'
import { CheckInPage } from '../src/pages/CheckInPage'

afterEach(cleanup)
const base = { credentialId: '10000000-0000-4000-8000-000000000001', applicationId: '20000000-0000-4000-8000-000000000001', name: '郑博元', phone: '+8618811132625', organization: '中国科学院大学', department: '中国科学院物理研究所', identityType: '博士研究生', applicationStatus: 'admitted' as const, checkInState: 'not_checked_in' as const, revision: 0, firstCheckedInAt: null, firstCheckedInBy: null, revokedAt: null, revokeReason: null }

describe('admin check-in', () => {
  it('requires lookup and an explicit confirmation before checking in', async () => {
    const lookupCheckIn = vi.fn(async () => ({ apiVersion: 'v1' as const, data: base }))
    const confirmCheckIn = vi.fn(async () => ({ apiVersion: 'v1' as const, data: { ...base, checkInState: 'checked_in' as const, revision: 1, firstCheckedInAt: '2026-09-04T01:00:00.000Z', firstCheckedInBy: '管理员', duplicate: false } }))
    render(<CheckInPage client={{ lookupCheckIn, confirmCheckIn, revokeCheckIn: vi.fn() } as unknown as AdminClient} />)
    fireEvent.change(screen.getByLabelText('也可粘贴或输入报到码'), { target: { value: 'credential-code-value' } })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText('郑博元')).toBeVisible()
    expect(confirmCheckIn).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认报到' }))
    await waitFor(() => expect(confirmCheckIn).toHaveBeenCalledWith(base.credentialId, 0))
    expect(await screen.findByText('已报到')).toBeVisible()
  })
})
