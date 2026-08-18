import { ContentSection } from '@panshi/ui'
import type { PublicSiteResponse } from '@panshi/contracts'
import { Link } from 'react-router-dom'
import { RichText } from '../components/RichText'
import { ApplicationCount } from '../components/ApplicationCount'
import { OrganizationGroups } from '../components/OrganizationGroups'

export const navigationItems = [
  { label: '首页', to: '/' }, { label: '实训日程', to: '/schedule' }, { label: '在线注册', to: '/application' },
  { label: '交通住宿', to: '/travel' }, { label: '联系我们', to: '/contact' }, { label: '相关资料', to: '/resources' },
  { label: '个人中心', to: '/account' },
] as const

export function HomePage({ site }: { site: PublicSiteResponse['data'] }) {
  const sections = {
    intro: <ContentSection key="intro" title="一、实训营简介">{site.basic.intro.length > 0 ? site.basic.intro.map((paragraph) => <RichText as="p" key={paragraph} html={paragraph} />) : <p>活动简介尚未发布</p>}</ContentSection>,
    target: site.basic.target ? <ContentSection key="target" title="面向对象"><p>{site.basic.target}</p></ContentSection> : null,
    scale: site.basic.scale ? <ContentSection key="scale" title="实训规模与形式"><p>{site.basic.scale}</p></ContentSection> : null,
    features: site.features.items.length ? <ContentSection key="features" title="二、实训营特色"><div className="feature-list">{site.features.items.map((item) => <article key={item.title}><h3>{item.title}</h3><RichText as="p" html={item.description} /></article>)}</div></ContentSection> : null,
    eventDetails: site.basic.eventDetails?.length ? <ContentSection key="eventDetails" title="三、举办时间、地点与规模">{site.basic.eventDetails.map((paragraph) => <RichText as="p" key={paragraph} html={paragraph} />)}</ContentSection> : null,
    scheduleOverview: site.scheduleOverview.length ? <ContentSection key="scheduleOverview" title="四、日程安排"><ol className="schedule-overview">{site.scheduleOverview.map((day, index) => <li key={day.date}>
      <span className="schedule-overview__marker" aria-hidden="true">{String(index).padStart(2, '0')}</span>
      <div><time dateTime={day.date}>{day.label}</time><strong>{day.theme}</strong></div>
    </li>)}</ol><p className="schedule-overview__link"><Link to="/schedule">查看完整实训日程</Link></p></ContentSection> : null,
    guests: site.guests.length ? <ContentSection key="guests" title="五、特邀嘉宾"><div className="guest-list">{site.guests.map((guest) => <article className="guest-profile" key={guest.id}>
      {guest.image ? <img src={guest.image.src} alt={guest.image.alt} /> : <div className="guest-profile__placeholder" aria-hidden="true">{guest.name.slice(0, 1)}</div>}
      <div><header className="guest-profile__identity"><h3>{guest.name}</h3><p>{guest.title}</p><p>{guest.affiliation}</p></header><p className="guest-profile__bio">{guest.bio}</p>
        {guest.profileUrl ? <p className="guest-profile__source"><a href={guest.profileUrl} target="_blank" rel="noreferrer">查看公开简介</a></p> : null}
      </div>
    </article>)}</div></ContentSection> : null,
    organizations: site.organizations.items.length ? <ContentSection key="organizations" title="六、组织单位"><OrganizationGroups organizations={site.organizations} /></ContentSection> : null,
    registrationAndAccommodation: site.basic.registrationAndAccommodation?.length ? <ContentSection key="registrationAndAccommodation" title="七、注册与食宿">
      {site.basic.registrationAndAccommodation.map((paragraph) => <RichText as="p" key={paragraph} html={paragraph} />)}
      {site.basic.signature ? <div className="event-signature"><p>{site.basic.signature.organization}</p><p>{site.basic.signature.date}</p></div> : null}
    </ContentSection> : null,
    registrationCta: <ContentSection key="registrationCta" title="报名参加"><p className="registration-cta-wrap"><Link className="registration-cta" to={site.registrationCta.to}>{site.registrationCta.label}</Link></p></ContentSection>,
    registrationCount: <ApplicationCount key="registrationCount" />,
  }
  return <div className="home-page">{site.homeSectionOrder.map((key) => sections[key])}</div>
}
