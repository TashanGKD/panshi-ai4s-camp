import { createRoot } from 'react-dom/client'
import { CalendarDays, MapPin } from 'lucide-react'
import { MemoryRouter } from 'react-router-dom'
import { ContentSection, EventBanner, EventNavigation, InfoCard } from '@panshi/ui'
import '@panshi/ui/tokens.css'
import '../../apps/web/src/styles/public.css'
import './source-reference.css'

const title = '磐石·科学智能（AI for Science）实训营'
const tagline = '面向科研实践的五日科学智能集中实训'
const dates = '2026-08-23 至 2026-08-27'
const venue = '中国科学院物理研究所'
const items = [
  { label: '首页', to: '/' }, { label: '实训日程', to: '/schedule' }, { label: '在线注册', to: '/register' },
  { label: '住宿交通', to: '/travel' }, { label: '联系我们', to: '/contact' }, { label: '相关资料', to: '/resources' },
  { label: '个人中心', to: '/account' },
] as const

function SourceReference() {
  return <div className="comparison-column source-reference">
    <header className="source-banner" data-testid="source-banner"><div className="source-container"><p className="source-series">磐石科学智能实训营</p><h1 className="source-title">{title}</h1><p className="source-tagline">{tagline}</p><div className="source-meta"><span><CalendarDays aria-hidden="true" size={14} />{dates}</span><span><MapPin aria-hidden="true" size={14} />{venue}</span></div></div></header>
    <nav className="source-nav" data-testid="source-navigation"><div className="source-container source-nav-inner">{items.map((item) => <a className={item.to === '/' ? 'on' : ''} key={item.to}>{item.label}</a>)}</div></nav>
    <section className="source-container source-section"><h2 data-testid="source-section-heading">实训营简介</h2></section>
    <div className="source-container"><article className="source-card" data-testid="source-compact-card"><h3>问题导向</h3><p>从真实科研问题出发，理解科学智能方法的适用边界。</p></article></div>
  </div>
}

function MigratedReference() {
  return <div className="comparison-column migrated-reference">
    <EventBanner dates={dates} tagline={tagline} title={title} venue={venue} />
    <div data-testid="migrated-navigation"><EventNavigation items={items} /></div>
    <div className="event-container" data-testid="migrated-section-heading"><ContentSection title="实训营简介"><span /></ContentSection></div>
    <div className="event-container" data-testid="migrated-compact-card"><InfoCard as="article" headingLevel={3} title="问题导向" variant="compact"><p>从真实科研问题出发，理解科学智能方法的适用边界。</p></InfoCard></div>
  </div>
}

function App() {
  const mode = new URL(globalThis.location.href).searchParams.get('mode')
  return <MemoryRouter><main className="comparison-grid">{mode === 'source' ? <SourceReference /> : <MigratedReference />}</main></MemoryRouter>
}

createRoot(document.getElementById('root')!).render(<App />)
