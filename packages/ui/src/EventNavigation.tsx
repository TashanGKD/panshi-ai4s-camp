import { NavLink } from 'react-router-dom'

export interface EventNavigationItem { label: string; to: string }

export function EventNavigation({ items }: { items: readonly EventNavigationItem[] }) {
  return <nav className="event-navigation" aria-label="实训营主导航">
    <div className="event-container event-navigation__inner">
      {items.map((item) => <NavLink className="event-navigation__link" end={item.to === '/'} key={item.to} to={item.to}>{item.label}</NavLink>)}
    </div>
  </nav>
}
