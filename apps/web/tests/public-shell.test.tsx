import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { App } from '../src/app/App'
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
    expect(screen.getByLabelText('活动信息')).toHaveTextContent('2026-08-23 至 2026-08-27')
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

  it('offers a first-focus skip link that moves focus to home main content', () => {
    const { container } = render(<MemoryRouter><HomePage fixture={fixture} /></MemoryRouter>)
    const skipLink = screen.getByRole('link', { name: '跳至主要内容' })
    const main = screen.getByRole('main')

    expect(container.querySelector('a')).toBe(skipLink)
    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(main).toHaveAttribute('id', 'main-content')
    fireEvent.click(skipLink)
    expect(main).toHaveFocus()
  })

  it('offers the same skip target on placeholder routes', () => {
    const { container } = render(<MemoryRouter initialEntries={['/schedule']}><App /></MemoryRouter>)
    const skipLink = screen.getByRole('link', { name: '跳至主要内容' })
    const main = screen.getByRole('main')

    expect(container.querySelector('a')).toBe(skipLink)
    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(main).toHaveAttribute('id', 'main-content')
    fireEvent.click(skipLink)
    expect(main).toHaveFocus()
  })

  it('does not render the legacy or online-course shell', () => {
    const { container } = render(<MemoryRouter><HomePage fixture={fixture} /></MemoryRouter>)
    const pageText = container.textContent ?? ''
    expect(pageText).not.toContain('返回会议')
    expect(pageText).not.toContain('在线课程')
    expect(pageText).not.toContain('他山学科交叉')
    expect(container.querySelector('.header, .footer, .conf-banner-back')).not.toBeInTheDocument()
  })

  it('renders supplied fixture content instead of importing a second home content source', () => {
    const suppliedFixture = {
      ...fixture,
      title: '测试活动标题',
      dates: '测试活动日期',
      intro: ['测试活动简介'],
      contact: '测试联系方式',
    }
    render(<MemoryRouter><HomePage fixture={suppliedFixture} /></MemoryRouter>)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('测试活动标题')
    expect(screen.getByRole('main')).toHaveTextContent('测试活动简介')
    expect(screen.getByRole('complementary')).toHaveTextContent('测试活动日期')
    expect(screen.getByRole('complementary')).toHaveTextContent('测试联系方式')
    expect(screen.queryByText(fixture.title)).not.toBeInTheDocument()
  })
})
