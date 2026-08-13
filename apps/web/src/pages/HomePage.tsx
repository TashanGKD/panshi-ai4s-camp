import { ContentSection, EventBanner, EventNavigation, InfoCard } from '@panshi/ui'
import '@panshi/ui/tokens.css'
import type { HomeFixture } from '../data/homeFixture'
import '../styles/public.css'

export const navigationItems = [
  { label: '首页', to: '/' }, { label: '实训日程', to: '/schedule' }, { label: '在线注册', to: '/register' },
  { label: '住宿交通', to: '/travel' }, { label: '联系我们', to: '/contact' }, { label: '相关资料', to: '/resources' },
  { label: '个人中心', to: '/account' },
] as const

export function HomePage({ fixture }: { fixture: HomeFixture }) {
  return <div className="public-shell">
    <EventBanner {...fixture} />
    <EventNavigation items={navigationItems} />
    <div className="event-container public-layout" data-testid="desktop-content-sidebar">
      <main id="main-content">
        <ContentSection title="实训营简介">{fixture.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</ContentSection>
        <ContentSection title="面向对象"><p>{fixture.target}</p></ContentSection>
        <ContentSection title="实训特点"><div className="feature-list">{fixture.features.map((feature) => <InfoCard as="article" headingLevel={3} key={feature.title} title={feature.title} variant="compact"><p>{feature.description}</p></InfoCard>)}</div></ContentSection>
        <ContentSection title="五日概览"><ol className="overview-list">{fixture.overview.map((day) => <li key={day}>{day}</li>)}</ol></ContentSection>
        <ContentSection title="组织信息"><dl className="organization-list">{fixture.organizations.map((item) => <div key={item.role}><dt>{item.role}</dt><dd>{item.name}</dd></div>)}</dl></ContentSection>
      </main>
      <aside className="public-sidebar" aria-label="活动补充信息">
        <InfoCard title="重要日期"><dl className="date-list">{fixture.importantDates.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}<div><dt>实训时间</dt><dd>{fixture.dates}</dd></div></dl></InfoCard>
        <InfoCard title="联系我们"><p className="contact-copy">{fixture.contact}</p></InfoCard>
      </aside>
    </div>
    <footer className="event-footer"><div className="event-container">磐石·科学智能（AI for Science）实训营</div></footer>
  </div>
}
