import { CalendarDays, MapPin } from 'lucide-react'

export interface EventBannerProps { title: string; dates: string; venue: string; series?: string; tagline?: string }

export function EventBanner({ title, dates, venue, series = '磐石科学智能实训营', tagline }: EventBannerProps) {
  return <header className="event-banner" data-testid="event-banner">
    <div className="event-container">
      <p className="event-banner__series">{series}</p>
      <h1 className="event-banner__title">{title}</h1>
      {tagline ? <p className="event-banner__tagline">{tagline}</p> : null}
      <div className="event-banner__meta" aria-label="活动信息">
        <span><CalendarDays aria-hidden="true" size={14} />{dates}</span>
        <span><MapPin aria-hidden="true" size={14} />{venue}</span>
      </div>
    </div>
  </header>
}
