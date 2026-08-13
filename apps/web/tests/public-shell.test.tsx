import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { HomePage } from '../src/pages/HomePage'
import { homeFixture as fixture } from '../src/data/homeFixture'

describe('public event shell', () => {
  it('renders the event banner, navigation, and shared sidebar', () => {
    render(
      <MemoryRouter>
        <HomePage fixture={fixture} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1, name: /磐石.*科学智能/ })).toBeVisible()
    expect(screen.getByRole('navigation')).toHaveTextContent('实训日程')
    expect(screen.getByRole('complementary')).toHaveTextContent('重要日期')
  })

  it('provides the exact seven event routes and marks home current', () => {
    render(<MemoryRouter><HomePage fixture={fixture} /></MemoryRouter>)
    const links = within(screen.getByRole('navigation')).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['首页', '实训日程', '在线注册', '住宿交通', '联系我们', '相关资料', '个人中心'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/schedule', '/register', '/travel', '/contact', '/resources', '/account'])
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links.slice(1).every((link) => !link.hasAttribute('aria-current'))).toBe(true)
  })

  it('uses one h1 and semantic content, sidebar, and footer regions', () => {
    const { container } = render(<MemoryRouter><HomePage fixture={fixture} /></MemoryRouter>)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('main')).toBeVisible()
    expect(screen.getByRole('complementary')).toHaveTextContent('联系方式待公布')
    expect(screen.getByRole('contentinfo')).toBeVisible()
    expect(container.querySelector('main')?.nextElementSibling?.tagName).toBe('ASIDE')
  })

  it('does not render the legacy or online-course shell', () => {
    const { container } = render(<MemoryRouter><HomePage fixture={fixture} /></MemoryRouter>)
    const pageText = container.textContent ?? ''
    expect(pageText).not.toContain('返回会议')
    expect(pageText).not.toContain('在线课程')
    expect(pageText).not.toContain('他山学科交叉')
    expect(container.querySelector('.header, .footer, .conf-banner-back')).not.toBeInTheDocument()
  })

  it('keeps fixture leaf strings unique as a replaceable single source', () => {
    const collect = (value: unknown): string[] => {
      if (typeof value === 'string') return [value]
      if (Array.isArray(value)) return value.flatMap(collect)
      if (value && typeof value === 'object') return Object.values(value).flatMap(collect)
      return []
    }
    const values = collect(fixture)
    expect(new Set(values).size).toBe(values.length)
  })
})
