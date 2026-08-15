import { ContentSection } from '@panshi/ui'
import type { PublicSiteResponse } from '@panshi/contracts'
import { Link } from 'react-router-dom'
import { RichText } from '../components/RichText'
import { ApplicationCount } from '../components/ApplicationCount'

export const navigationItems = [
  { label: '首页', to: '/' }, { label: '实训日程', to: '/schedule' }, { label: '在线注册', to: '/application' },
  { label: '住宿交通', to: '/travel' }, { label: '联系我们', to: '/contact' }, { label: '相关资料', to: '/resources' },
  { label: '个人中心', to: '/account' },
] as const

export function HomePage({ site }: { site: PublicSiteResponse['data'] }) {
  const sections = {
    intro: <ContentSection key="intro" title="实训营简介">{site.basic.intro.length > 0 ? site.basic.intro.map((paragraph) => <RichText as="p" key={paragraph} html={paragraph} />) : <p>活动简介尚未发布</p>}</ContentSection>,
    target: site.basic.target ? <ContentSection key="target" title="面向对象"><p>{site.basic.target}</p></ContentSection> : null,
    scale: site.basic.scale ? <ContentSection key="scale" title="实训规模与形式"><p>{site.basic.scale}</p></ContentSection> : null,
    features: site.features.items.length ? <ContentSection key="features" title="实训特色"><div className="feature-list">{site.features.items.map((item) => <article key={item.title}><h3>{item.title}</h3><RichText as="p" html={item.description} /></article>)}</div></ContentSection> : null,
    scheduleOverview: site.scheduleOverview.length ? <ContentSection key="scheduleOverview" title="五日实训概览"><ol className="schedule-overview">{site.scheduleOverview.map((day) => <li key={day.date}><time dateTime={day.date}>{day.label}</time><strong>{day.theme}</strong></li>)}</ol><p><Link to="/schedule">查看完整实训日程</Link></p></ContentSection> : null,
    organizations: site.organizations.items.length ? <ContentSection key="organizations" title="组织单位"><dl className="organization-list">{site.organizations.items.map((item) => <div key={`${item.role}:${item.name}`}><dt>{item.role}</dt><dd>{item.name}</dd></div>)}</dl></ContentSection> : null,
    registrationCta: <ContentSection key="registrationCta" title="报名参加"><p><Link className="registration-cta" to={site.registrationCta.to}>{site.registrationCta.label}</Link></p></ContentSection>,
    registrationCount: <ApplicationCount key="registrationCount" />,
  }
  return <>{site.homeSectionOrder.map((key) => sections[key])}</>
}
