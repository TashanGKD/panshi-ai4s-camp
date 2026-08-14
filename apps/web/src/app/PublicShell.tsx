import { EventBanner, EventNavigation, InfoCard } from '@panshi/ui'
import type { PublicSiteResponse } from '@panshi/contracts'
import type { ReactNode } from 'react'
import { SkipLink } from './SkipLink'
import { navigationItems } from '../pages/HomePage'
import { ImportantDatesContent } from '../renderers/ContentModuleRenderer'
import { ContactList } from '../pages/ContactPage'

export function PublicShell({ children, site, sidebar = false }: {
  children: ReactNode
  site: PublicSiteResponse['data']
  sidebar?: boolean
}) {
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
        {site.contacts.items.length > 0 ? <InfoCard title="联系我们">
          <ContactList contacts={site.contacts} />
        </InfoCard> : null}
      </aside>
    </div> : <div className="event-container public-page">{content}</div>}
    <footer className="event-footer"><div className="event-container">{site.display.footer}</div></footer>
  </div>
}
