import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminContentPreviewResponse, ContentModuleKey, JsonObject, PublicSiteResponse } from '@panshi/contracts'
import { PreviewPage } from '../src/pages/PreviewPage'
import { ScheduleContent } from '../src/pages/SchedulePage'
import { ContentModuleRenderer } from '../src/renderers/ContentModuleRenderer'
import { PreviewAccessError, createPublicClient } from '../src/api/public-client'
import { App } from '../src/app/App'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const site: PublicSiteResponse['data'] = {
  contentVersion: 'site:1',
  basic: {
    title: '正式标题', dates: { start: '2026-08-23', end: '2026-08-27', label: '正式日期' },
    venue: '正式地点', intro: ['正式简介'],
  },
  importantDates: { items: [] },
  contacts: { items: [] },
  display: { series: '磐石实训营', footer: '正式页脚' },
  features: { items: [] }, organizations: { items: [] }, scheduleOverview: [],
  homeSectionOrder: ['intro', 'target', 'scale', 'features', 'scheduleOverview', 'organizations', 'registrationCta', 'registrationCount'],
  visibleNavigation: ['home', 'schedule', 'register', 'travel', 'contacts', 'resources', 'account'],
  registrationCta: { label: '在线注册', to: '/application' },
}

const preview = (key: ContentModuleKey, payload: JsonObject): AdminContentPreviewResponse => ({
  apiVersion: 'v1', data: { key, revision: 3, payload },
})

describe('protected public Web draft preview', () => {
  it('renders schedule preview through the same production ScheduleContent component', async () => {
    const schedule = {
      speakers: [{ id: 'speaker-a', name: '张老师' }],
      days: [{
        date: '2026-08-23', label: '第一天', theme: '预览主题',
        sessions: [{ title: '预览课程', timeRange: { start: '09:00', end: '10:30' }, speakerIds: ['speaker-a'] }],
      }],
    }
    const client = { getDraftPreview: vi.fn(async () => preview('schedule', schedule)) }
    const { container } = render(<MemoryRouter><PreviewPage site={site} moduleKey="schedule" client={client} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '预览课程' })).toBeVisible()
    expect(screen.getByText('09:00–10:30')).toBeVisible()
    expect(screen.getByText('张老师')).toBeVisible()

    const production = render(<ScheduleContent schedule={schedule} />)
    expect(production.container.querySelector('.schedule-list')?.textContent).toBe(
      container.querySelector('.schedule-list')?.textContent,
    )
  })

  it.each([
    ['basic', { ...site.basic, title: '草稿基本信息' }, '草稿基本信息'],
    ['importantDates', { items: [{ label: '报名开放', value: '2026-08-01' }] }, '报名开放'],
    ['contacts', { items: [{ label: '咨询', value: '张老师' }] }, '张老师'],
    ['travel', { sections: [{ title: '到达方式', body: '乘坐地铁' }] }, '乘坐地铁'],
    ['features', { items: [{ title: '特色一', description: '真实科研问题' }] }, '真实科研问题'],
    ['organizations', { items: [{ role: '主办方', name: '他山协会' }] }, '他山协会'],
    ['display', { series: '草稿系列', footer: '草稿页脚' }, '草稿展示设置'],
  ] as const)('renders %s with its canonical public module renderer', async (key, payload, expected) => {
    render(<MemoryRouter><PreviewPage site={site} moduleKey={key} client={{ getDraftPreview: async () => preview(key, payload) }} /></MemoryRouter>)
    const matches = await screen.findAllByText(expected)
    const previewContent = matches.find((element) => element.closest('main')) ?? (key === 'basic' ? matches[0] : undefined)
    expect(previewContent).toBeVisible()
  })

  it.each([401, 403] as const)('shows a login/forbidden state for preview status %i without exposing draft', async (status) => {
    render(<MemoryRouter><PreviewPage site={site} moduleKey="basic" client={{
      getDraftPreview: async () => { throw new PreviewAccessError(status) },
    }} /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 401 ? '请先登录管理后台' : '无权预览该草稿')
    expect(screen.queryByText('草稿基本信息')).not.toBeInTheDocument()
  })

  it('shows a controlled state for an invalid draft instead of leaking schema internals', async () => {
    render(<MemoryRouter><PreviewPage site={site} moduleKey="basic" client={{
      getDraftPreview: async () => preview('basic', { secret: 'invalid-draft-marker' }),
    }} /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('草稿内容格式不完整')
    expect(document.body.textContent).not.toMatch(/Zod|invalid-draft-marker|unrecognized_keys/u)
  })

  it('fetches the protected preview API with admin cookies and no public token', async () => {
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return new Response(JSON.stringify(preview('basic', site.basic)), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await createPublicClient('https://api.example').getDraftPreview('basic')
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/api/v1/admin/content/basic/preview', expect.objectContaining({
      credentials: 'include',
    }))
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('token')
  })

  it('mounts the public Web route at /preview/:module', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('/api/v1/public/site') ? { apiVersion: 'v1', data: site } : preview('basic', { ...site.basic, title: '路由草稿标题' })
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    render(<MemoryRouter initialEntries={['/preview/basic']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 1, name: '路由草稿标题' })).toBeVisible()
  })
})

describe('canonical content module renderer', () => {
  it('labels unsupported nonvisual states clearly', () => {
    render(<ContentModuleRenderer moduleKey="display" payload={site.display} />)
    expect(screen.getByText('草稿展示设置')).toBeVisible()
    expect(screen.getByText(/通过页面横幅和页脚查看/u)).toBeVisible()
  })
})
