import { EventBanner, EventNavigation, InfoCard } from '@panshi/ui'
import type { PublicSiteResponse } from '@panshi/contracts'
import type { ReactNode } from 'react'
import { SkipLink } from './SkipLink'
import { ImportantDatesContent } from '../renderers/ContentModuleRenderer'

export function PublicShell({ children, site, sidebar = false }: {
  children: ReactNode
  site: PublicSiteResponse['data']
  sidebar?: boolean
}) {
  const allNavigation = {
    home: { label: '首页', to: '/' }, schedule: { label: '实训日程', to: '/schedule' }, register: { label: '在线注册', to: '/application' },
    travel: { label: '住宿交通', to: '/travel' }, contacts: { label: '联系我们', to: '/contact' }, resources: { label: '相关资料', to: '/resources' }, account: { label: '个人中心', to: '/account' },
  } as const
  const navigationItems = site.visibleNavigation.map((key) => allNavigation[key])
  const content = <main id="main-content" tabIndex={-1}>{children}</main>

  return <div className="public-shell">
    <SkipLink />
    <EventBanner
      dates={site.basic.dates.label}
      series={site.display.series}
      tagline={site.basic.tagline}
      title={site.basic.title}
      venue={site.basic.venue}
    />
    <EventNavigation items={navigationItems} />
    {sidebar ? <div className="event-container public-layout" data-testid="desktop-content-sidebar">
      {content}
      <aside className="public-sidebar" aria-label="活动补充信息">
        {site.importantDates.items.length > 0 ? <InfoCard title="重要日期">
          <ImportantDatesContent importantDates={site.importantDates} />
        </InfoCard> : null}
      </aside>
    </div> : <div className="event-container public-page">{content}</div>}
    <footer className="event-footer"><div className="event-container">{site.display.footer}</div></footer>
  </div>
}
